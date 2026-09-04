#!/usr/bin/env bash
# Export the proxy's own tool_call_logs from ClickHouse so verify-capture.mjs can
# cross-check against them.
#
# Why this step exists: a capture only shows the curl echo inside the model's
# stdout, and that echo contains both the request and the response. All three
# historical false positives came from running a regex over that text. By
# contrast tool_call_logs is written by the proxy itself, carries
# upstream_status / reject_reason, never passes through the model, and therefore
# cannot misreport — it is the authoritative record that an asset was fetched.
#
# Usage:
#   ./export-tool-call-logs.sh                       # last 24 hours
#   SINCE="2 HOUR" ./export-tool-call-logs.sh        # custom window
#   SESSION_KEY=codebuddy:conv-abc ./export-tool-call-logs.sh
#   OUT=/tmp/rows.jsonl ./export-tool-call-logs.sh
#
# Then:
#   node evaluation/gate0/verify-capture.mjs \
#     evaluation/gate0/artifacts/gate0-upstream-capture.jsonl \
#     evaluation/gate0/artifacts/tool-call-logs.jsonl

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [[ -t 1 ]]; then
  C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YLW=$'\033[33m'; C_BLU=$'\033[34m'; C_RST=$'\033[0m'
else
  C_RED=""; C_GRN=""; C_YLW=""; C_BLU=""; C_RST=""
fi
info() { echo "${C_BLU}[$(date +%H:%M:%S)]${C_RST} $*"; }
ok()   { echo "${C_GRN}[ok]${C_RST} $*"; }
warn() { echo "${C_YLW}[warn]${C_RST} $*" >&2; }
die()  { echo "${C_RED}[error]${C_RST} $*" >&2; exit 1; }

# ── Connection ──────────────────────────────────────────────
# PROXY_CLICKHOUSE_URL in .env is a container network alias
# (http://clickhouse:8123) that the host cannot resolve, so only its database
# name and credentials are reused here; the address defaults to the mapped port.
ENV_FILE="$REPO_ROOT/deploy/global-images/.env"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  CH_DB_DEFAULT="$(grep -E '^PROXY_CLICKHOUSE_DB=' "$ENV_FILE" | tail -1 | cut -d= -f2-)"
  CH_USER_DEFAULT="$(grep -E '^PROXY_CLICKHOUSE_USER=' "$ENV_FILE" | tail -1 | cut -d= -f2-)"
  CH_PASSWORD_DEFAULT="$(grep -E '^PROXY_CLICKHOUSE_PASSWORD=' "$ENV_FILE" | tail -1 | cut -d= -f2-)"
fi

CH_URL="${CLICKHOUSE_URL:-http://127.0.0.1:8123}"
CH_DB="${CLICKHOUSE_DB:-${CH_DB_DEFAULT:-context_proxy}}"
CH_USER="${CLICKHOUSE_USER:-${CH_USER_DEFAULT:-default}}"
CH_PASSWORD="${CLICKHOUSE_PASSWORD:-${CH_PASSWORD_DEFAULT:-}}"

OUT="${OUT:-$SCRIPT_DIR/artifacts/tool-call-logs.jsonl}"
SINCE="${SINCE:-24 HOUR}"
SESSION_KEY="${SESSION_KEY:-}"

# The window is interpolated into SQL, so its format is constrained to keep
# arbitrary strings out of the query.
if [[ ! "$SINCE" =~ ^[0-9]+\ (MINUTE|HOUR|DAY)$ ]]; then
  die "SINCE must look like '<number> MINUTE|HOUR|DAY', got: $SINCE"
fi

# ── Query ───────────────────────────────────────────────────
WHERE="timestamp >= now() - INTERVAL $SINCE"
if [[ -n "$SESSION_KEY" ]]; then
  # Escape single quotes so a quote inside a session key cannot truncate the string
  ESCAPED="${SESSION_KEY//\'/\'\'}"
  WHERE="$WHERE AND session_key = '$ESCAPED'"
fi

read -r -d '' QUERY <<SQL || true
SELECT timestamp, session_key, turn_seq, space_id, user_id, team_id, agent_id,
       agent_source, kind, bridge_source, initiated_tool, executed_endpoint,
       upstream_status, elapsed_ms, reject_reason, source_tag
FROM $CH_DB.tool_call_logs
WHERE $WHERE
ORDER BY timestamp
FORMAT JSONEachRow
SQL

# Credentials reach curl over stdin (-K -) rather than as command-line
# arguments, which would expose them in ps output. Secrets are injected through
# environment variables only: never committed, never logged.
#
# --fail-with-body matters: without it a ClickHouse error (bad auth, missing
# table, malformed SQL) returns HTTP 4xx/5xx with an error body while curl still
# exits 0. That error text would be written into the .jsonl as if it were the
# result; verify-capture cannot parse it, skips the lines, and the run ends up
# reporting "0 rows" — indistinguishable from telemetry being switched off, when
# in fact the query simply failed.
run_query() {
  printf 'user = "%s:%s"\n' "$CH_USER" "$CH_PASSWORD" \
    | curl -sS --fail-with-body -K - --max-time 30 "$CH_URL/" --data-binary "$1"
}

info "ClickHouse $CH_URL  db=$CH_DB  window=last $SINCE"
[[ -n "$SESSION_KEY" ]] && info "session_key=$SESSION_KEY"

PROBE="$(run_query "SELECT 1" 2>&1)" || die "ClickHouse unreachable or auth failed: $CH_URL
  ${PROBE:-(no response)}
  is the container running?  docker ps --filter name=clickhouse
  credentials come from:    PROXY_CLICKHOUSE_USER / _PASSWORD in $ENV_FILE"

# Write to a temp file first, so a failed query cannot overwrite the last good export.
mkdir -p "$(dirname "$OUT")"
TMP="$(mktemp -t gate0-tool-call-logs)"
trap 'rm -f "$TMP"' EXIT

if ! run_query "$QUERY" > "$TMP" 2>&1; then
  die "query failed; $OUT left untouched:
  $(head -c 400 "$TMP")"
fi
mv "$TMP" "$OUT"

ROWS="$(wc -l < "$OUT" | tr -d ' ')"
if [[ "$ROWS" == "0" ]]; then
  warn "0 rows in this window. Telemetry is off by default: check that"
  warn "PROXY_CLICKHOUSE_URL is set in .env and that start-proxy.sh has been"
  warn "restarted (its startup log should confirm telemetry is enabled)."
  warn "A column existing in the schema does not mean it holds any values."
else
  ok "$ROWS row(s) -> $OUT"
  info "distribution:"
  run_query "SELECT kind, bridge_source, count() AS n, countIf(upstream_status BETWEEN 200 AND 299) AS ok_2xx
             FROM $CH_DB.tool_call_logs WHERE $WHERE
             GROUP BY kind, bridge_source ORDER BY kind FORMAT PrettyCompact"
fi
