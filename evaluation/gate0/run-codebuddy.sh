#!/usr/bin/env bash
# Launch the CodeBuddy CLI with team asset binding.
#
# The CLI does not render the `ask_followup_question` session-init form (that is
# an IDE-plugin capability), so binding goes through the proxy's headerAutoSelect
# instead: x-team-id / x-agent-id / x-task-id carry the team/agent/task binding
# directly, skipping the form and going straight to asset injection.
#
# Usage:
#   ./run-codebuddy.sh                    # interactive
#   ./run-codebuddy.sh "review this repo" # single prompt, then exit (-p)
#   BINDING_FILE=other.env ./run-codebuddy.sh
#
# Binding values default to codebuddy-binding.env alongside this script and can
# be overridden by environment variables:
#   TEAM_ID / AGENT_ID / TASK_ID / CB_MODEL

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINDING_FILE="${BINDING_FILE:-$SCRIPT_DIR/codebuddy-binding.env}"

if [[ -t 1 ]]; then
  C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YLW=$'\033[33m'; C_BLU=$'\033[34m'; C_RST=$'\033[0m'
else
  C_RED=""; C_GRN=""; C_YLW=""; C_BLU=""; C_RST=""
fi
info() { echo "${C_BLU}[$(date +%H:%M:%S)]${C_RST} $*"; }
ok()   { echo "${C_GRN}[ok]${C_RST} $*"; }
warn() { echo "${C_YLW}[warn]${C_RST} $*" >&2; }
die()  { echo "${C_RED}[error]${C_RST} $*" >&2; exit 1; }

# ── Load binding config ─────────────────────────────────────
if [[ -f "$BINDING_FILE" ]]; then
  set -a; # shellcheck disable=SC1090
  source "$BINDING_FILE"; set +a
else
  warn "$BINDING_FILE not found; using environment variables only"
fi

CB_MODEL="${CB_MODEL:-custom-local:deepseek-v4-flash}"
PROXY_URL="${PROXY_URL:-http://127.0.0.1:8096}"

missing=()
[[ -z "${TEAM_ID:-}"  ]] && missing+=("TEAM_ID")
[[ -z "${AGENT_ID:-}" ]] && missing+=("AGENT_ID")
[[ -z "${TASK_ID:-}"  ]] && missing+=("TASK_ID")
if (( ${#missing[@]} > 0 )); then
  die "missing binding parameters: ${missing[*]}
  set them in $BINDING_FILE or pass them as environment variables"
fi

# ── Preflight ───────────────────────────────────────────────
command -v codebuddy >/dev/null 2>&1 || die "codebuddy is not installed (brew install codebuddy)"

if ! curl -sf -o /dev/null --max-time 5 "$PROXY_URL/health"; then
  die "proxy unreachable: $PROXY_URL
  start it first: cd deploy/global-images && bash ./start-proxy.sh"
fi

if [[ ! -f "$HOME/.codebuddy/models.json" ]]; then
  die "~/.codebuddy/models.json is missing, so CodeBuddy cannot find the custom model."
fi

info "model $CB_MODEL"
info "binding team=$TEAM_ID agent=$AGENT_ID task=$TASK_ID"

# ── Assemble the command ────────────────────────────────────
#
# Argument order is critical. `-H, --header <headers...>` is a commander
# variadic option and swallows every following non-option token. A prompt placed
# after -H is consumed as one more header value; CodeBuddy then sees
# hasPrompt=false and exits silently with no error at all. The prompt must
# therefore come before every -H.
#
HEADERS=(
  -H "x-team-id: $TEAM_ID"
  -H "x-agent-id: $AGENT_ID"
  -H "x-task-id: $TASK_ID"
)

# The interactive TUI does not forward `-H` headers (verified: the proxy's
# identity log lists no such custom headers), and the `headers` field in
# models.json is not honoured either. Interactive mode therefore relies on the
# proxy's `sessionInit.debugForceIdentity`: set PROXY_FORCE_TEAM_ID /
# PROXY_FORCE_AGENT_ID / PROXY_FORCE_TASK_ID in .env and restart the proxy.
# Without that, interactive mode stalls on the session-init form.
#
# In `-p` mode the `-H` headers ARE forwarded — and debugForceIdentity still
# wins over them. Verified from the proxy's own session-init log on a real run:
# headers carried the old gate0 binding, the log read "DEBUG bypass — force
# identity team=… agent=…" and initialized the forced identity. So the headers
# below are a fallback for a proxy with no forced identity, nothing more. The
# resolved identity is always the proxy log's `→ initialized` line, never the
# request headers; run-once.sh records that line per run.
#
# `-y` (--dangerously-skip-permissions): a `-p` run has nobody to approve tool
# calls, so without it every Bash call is denied and the model — correctly —
# reports that it could not carry out the task. That produced a whole run
# whose only content was permission errors. The flag is the non-interactive
# equivalent of the approval a person gives in the TUI; this harness runs a
# task the operator wrote, against local endpoints, so that is the intent.

if (( $# > 0 )); then
  ok "single-prompt mode (permissions bypassed: no one is present to approve)"
  exec codebuddy -p -y --model "$CB_MODEL" "$*" "${HEADERS[@]}"
fi

if ! grep -q "debugForceIdentity" "$SCRIPT_DIR/../../deploy/global-images/.proxy-config/config.yaml" 2>/dev/null; then
  warn "proxy has no debugForceIdentity configured; interactive mode may stall"
  warn "on the session-init form. Set PROXY_FORCE_TEAM_ID / PROXY_FORCE_AGENT_ID /"
  warn "PROXY_FORCE_TASK_ID in deploy/global-images/.env and rerun start-proxy.sh."
fi

ok "interactive mode — binding comes from the proxy's debugForceIdentity; no form"
exec codebuddy --model "$CB_MODEL" "${HEADERS[@]}"
