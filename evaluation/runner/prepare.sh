#!/usr/bin/env bash
# Put the environment into a state where a run produces usable evidence.
#
# Three things have to be true, and two of them fail silently — the run finishes,
# the files are written, and what they contain is wrong or empty:
#
#   1. The probe must be running, and the proxy must route through it.
#      The proxy's upstream currently points straight at the model, so nothing
#      is captured at all. Where the probe sits also matters: between client and
#      proxy it recorded a system prompt with zero asset blocks while the proxy's
#      own log showed several injected on every turn. Both readings were honest.
#      Injection happens inside the proxy, so the probe goes above it.
#
#   2. `debugForceIdentity` overrides the request headers, and it is pinned to
#      the consumer agent. Switching the API key is not enough: the injector
#      lists skills for the *forced* agent, so an injector probe run as the
#      author would still see the consumer's empty block — and the result would
#      read as "the injector path produced nothing" when it was never asked.
#
#   3. The candidate log and the scenario port have to be on (eval-proxy.sh).
#
# Usage:
#   bash evaluation/runner/prepare.sh --identity b   # mainline, consumer
#   bash evaluation/runner/prepare.sh --identity a   # injector probe, author
#   bash evaluation/runner/prepare.sh --status
#   bash evaluation/runner/prepare.sh --teardown

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
EVAL="$REPO_ROOT/evaluation"
CONFIG="$REPO_ROOT/deploy/global-images/.proxy-config/config.yaml"
PROBE_LOG="$EVAL/gate0/artifacts/probe.log"
PROBE_PID="$EVAL/gate0/artifacts/probe.pid"
PROBE_OUT="$EVAL/gate0/artifacts/gate0-proxy-capture.jsonl"
PROBE_PORT="${PROBE_PORT:-18097}"
MODEL_UPSTREAM="${MODEL_UPSTREAM:-https://api.deepseek.com}"
PROBE_UPSTREAM="http://host.docker.internal:${PROBE_PORT}"

AUTHOR_AGENT="${AUTHOR_AGENT:-agt-5e4hna56j9}"
CONSUMER_AGENT="${CONSUMER_AGENT:-agt-5e0y4l8a7a}"
# Identity C: the second author (evaluation/tasks/identities.json).
AUTHOR_C_AGENT="${AUTHOR_C_AGENT:-agt-8ypy4vhft9}"

if [[ -t 1 ]]; then C_R=$'\033[31m'; C_G=$'\033[32m'; C_Y=$'\033[33m'; C_B=$'\033[34m'; C_0=$'\033[0m'
else C_R=""; C_G=""; C_Y=""; C_B=""; C_0=""; fi
info() { echo "${C_B}[$(date +%H:%M:%S)]${C_0} $*"; }
ok()   { echo "${C_G}[ok]${C_0} $*"; }
warn() { echo "${C_Y}[warn]${C_0} $*"; }
die()  { echo "${C_R}[error]${C_0} $*" >&2; exit 1; }

# Ask the process table, not just the pid file. A pid file can vanish or go
# stale while the probe is still running, and then this script would start a
# second one, fail on the port, and leave the environment looking prepared
# without being prepared. Recovers the pid file when it finds a live probe.
probe_running() {
  if [[ -f "$PROBE_PID" ]] && kill -0 "$(cat "$PROBE_PID")" 2>/dev/null; then return 0; fi
  local pid
  pid="$(pgrep -f "proxy-observability-probe" 2>/dev/null | head -1)"
  if [[ -n "$pid" ]]; then echo "$pid" > "$PROBE_PID"; return 0; fi
  rm -f "$PROBE_PID"
  return 1
}

# Every prerequisite, checked against the live environment rather than against
# what this script did earlier. The whole point is that a wrong answer here is
# invisible later.
verify_ready() {
  local want_agent="$1" bad=0
  probe_running || { echo "  ${C_R}probe not running${C_0}"; bad=1; }
  [[ "$(current_upstream)" == "$PROBE_UPSTREAM" ]] \
    || { echo "  ${C_R}proxy upstream is $(current_upstream), not the probe — nothing would be captured${C_0}"; bad=1; }
  [[ "$(current_agent)" == "$want_agent" ]] \
    || { echo "  ${C_R}forced agent is $(current_agent), expected $want_agent${C_0}"; bad=1; }
  [[ "$(docker inspect tdai-proxy --format '{{.State.Health.Status}}' 2>/dev/null)" == healthy ]] \
    || { echo "  ${C_R}proxy is not healthy${C_0}"; bad=1; }
  # "Ready" must imply the pool cannot move during the run.
  [[ "$(core_extraction_state)" == false ]] \
    || { echo "  ${C_R}core auto-extraction is $(core_extraction_state), not off — the pool could change mid-run${C_0}"; bad=1; }
  return "$bad"
}

set_yaml_upstream() {  # $1 = url
  python3 - "$CONFIG" "$1" <<'PY'
import re, sys
path, url = sys.argv[1], sys.argv[2]
text = open(path, encoding="utf-8").read()
# Only the first `upstream:` block's url — the memory-core and clickhouse
# sections have their own and must not be touched.
new, n = re.subn(r'(^upstream:\n(?:[ \t]+\w+:.*\n)*?[ \t]+url:[ \t]*)"[^"]*"',
                 lambda m: m.group(1) + f'"{url}"', text, count=1, flags=re.M)
if n != 1:
    sys.exit("could not rewrite the model upstream url")
open(path, "w", encoding="utf-8").write(new)
PY
}

set_forced_agent() {  # $1 = agent id
  python3 - "$CONFIG" "$1" <<'PY'
import re, sys
path, agent = sys.argv[1], sys.argv[2]
text = open(path, encoding="utf-8").read()
new, n = re.subn(r'(debugForceIdentity:\n(?:[ \t]+\w+:.*\n)*?[ \t]+agent_id:[ \t]*)"[^"]*"',
                 lambda m: m.group(1) + f'"{agent}"', text, count=1, flags=re.M)
if n != 1:
    sys.exit("could not rewrite debugForceIdentity.agent_id")
open(path, "w", encoding="utf-8").write(new)
PY
}

current_upstream() { python3 -c "
import re,sys
t=open('$CONFIG',encoding='utf-8').read()
m=re.search(r'^upstream:\n(?:[ \t]+\w+:.*\n)*?[ \t]+url:[ \t]*\"([^\"]*)\"',t,re.M)
print(m.group(1) if m else '?')"; }
current_agent() { python3 -c "
import re,sys
t=open('$CONFIG',encoding='utf-8').read()
m=re.search(r'debugForceIdentity:\n(?:[ \t]+\w+:.*\n)*?[ \t]+agent_id:[ \t]*\"([^\"]*)\"',t,re.M)
print(m.group(1) if m else '?')"; }

# ── the product's skill auto-extraction switch ───────────────────
# Off for the on/off comparison, by decision (see the run report). It has to be
# enforced here rather than remembered: the core config file is gitignored and
# start-memory-core.sh regenerates it on every start with `enabled: true`, so
# one redeploy would switch extraction back on and every later run would be
# against a moving pool. The state is read from the file the container mounts;
# writes are in place, because that mount is a single read-only file and a
# replaced inode leaves the container reading the old bytes.
CORE_CFG="$REPO_ROOT/deploy/global-images/.memory-core-config/tdai-gateway.yaml"

core_extraction_state() {  # prints true | false | unknown
  python3 - "$CORE_CFG" <<'PY' 2>/dev/null || echo unknown
import re, sys
s = open(sys.argv[1], encoding="utf-8").read()
m = re.search(r"^skill:\n(?:(?:  .*|)\n)*?  extraction:\n(?:(?:    .*|)\n)*?    enabled:\s*(true|false)", s, re.M)
print(m.group(1) if m else "unknown")
PY
}

set_core_extraction_off() {  # in-place, inode-preserving; then restart core and verify
  local before; before="$(stat -f %i "$CORE_CFG")"
  python3 - "$CORE_CFG" <<'PY' || return 1
import re, sys
p = sys.argv[1]; s = open(p, encoding="utf-8").read()
pat = re.compile(r"(^skill:\n(?:(?:  .*|)\n)*?  extraction:\n(?:(?:    .*|)\n)*?    enabled:\s*)true", re.M)
new, n = pat.subn(r"\1false", s, count=1)
if n != 1:
    sys.exit("skill.extraction.enabled: true not found exactly once")
fh = open(p, "r+", encoding="utf-8"); fh.write(new); fh.truncate(); fh.close()
PY
  [[ "$(stat -f %i "$CORE_CFG")" == "$before" ]] || { echo "  ${C_R}inode changed while writing $CORE_CFG — the container would keep the old bytes${C_0}"; return 1; }
  docker restart tdai-memory-core >/dev/null || return 1
  local _ st
  for _ in $(seq 1 45); do
    st="$(docker inspect tdai-memory-core --format '{{.State.Health.Status}}' 2>/dev/null)"
    [[ "$st" == healthy ]] && break; sleep 2
  done
  [[ "$st" == healthy ]] || { echo "  ${C_R}tdai-memory-core did not come back healthy${C_0}"; return 1; }
  docker exec tdai-memory-core sh -c 'grep -A1 "^  extraction:" /data/config/tdai-gateway.yaml | tail -1' | grep -q false
}

restart_proxy() {
  docker restart tdai-proxy >/dev/null || die "could not restart tdai-proxy"
  for _ in $(seq 1 45); do
    [[ "$(docker inspect tdai-proxy --format '{{.State.Health.Status}}' 2>/dev/null)" == healthy ]] && return 0
    sleep 2
  done
  die "proxy did not come back healthy; docker logs tdai-proxy"
}

case "${1:---status}" in
  --status)
    echo "  probe:            $(probe_running && echo "running (pid $(cat "$PROBE_PID"))" || echo "${C_R}not running${C_0}")"
    echo "  proxy upstream:   $(current_upstream)"
    up="$(current_upstream)"
    [[ "$up" == "$PROBE_UPSTREAM" ]] || echo "                    ${C_Y}not routed through the probe — nothing will be captured${C_0}"
    ag="$(current_agent)"
    case "$ag" in
      "$CONSUMER_AGENT") echo "  forced identity:  $ag  (consumer — mainline runs)" ;;
      "$AUTHOR_AGENT")   echo "  forced identity:  $ag  (author — injector probe)" ;;
      "$AUTHOR_C_AGENT") echo "  forced identity:  $ag  (second author C)" ;;
      *)                 echo "  forced identity:  $ag  ${C_Y}(neither evaluation agent)${C_0}" ;;
    esac
    # The product's auto-extraction switch, read from the core config the
    # container mounts. Off during the on/off comparison by decision.
    core_cfg="$REPO_ROOT/deploy/global-images/.memory-core-config/tdai-gateway.yaml"
    ext="$(python3 - "$core_cfg" <<'PY' 2>/dev/null || echo unknown
import re, sys
s = open(sys.argv[1], encoding="utf-8").read()
m = re.search(r"^skill:\n(?:(?:  .*|)\n)*?  extraction:\n(?:(?:    .*|)\n)*?    enabled:\s*(true|false)", s, re.M)
print(m.group(1) if m else "unknown")
PY
)"
    case "$ext" in
      false) echo "  core auto-extraction: OFF  (pool frozen for the comparison)" ;;
      true)  echo "  core auto-extraction: ON   ${C_Y}— the pool can change between runs${C_0}" ;;
      *)     echo "  core auto-extraction: ${C_Y}unknown (could not read $core_cfg)${C_0}" ;;
    esac
    bash "$EVAL/eval-proxy.sh" status
    bash "$EVAL/eval-core.sh" status
    ;;

  --teardown)
    if probe_running; then kill "$(cat "$PROBE_PID")" 2>/dev/null; rm -f "$PROBE_PID"; ok "probe stopped"; fi
    set_yaml_upstream "$MODEL_UPSTREAM"
    restart_proxy
    ok "upstream back to $MODEL_UPSTREAM"
    ;;

  --identity)
    case "${2:-}" in
      a) AGENT="$AUTHOR_AGENT";   WHO="author (injector probe)" ;;
      b) AGENT="$CONSUMER_AGENT"; WHO="consumer (mainline)" ;;
      c) AGENT="$AUTHOR_C_AGENT"; WHO="second author (history for the context-based assessment; extension pair)" ;;
      *) die "usage: $0 --identity a|b|c" ;;
    esac

    cp "$CONFIG" "$CONFIG.bak"

    # 1. the probe
    if probe_running; then
      info "probe already running (pid $(cat "$PROBE_PID"))"
    else
      mkdir -p "$(dirname "$PROBE_OUT")"
      info "starting probe on 0.0.0.0:$PROBE_PORT → $MODEL_UPSTREAM"
      # Bound to 0.0.0.0 so the container reaches it via host.docker.internal.
      # stdin closed and both streams redirected, so the probe does not hold the
      # calling terminal open — otherwise this script never returns.
      ( cd "$REPO_ROOT" && PROBE_HOST=0.0.0.0 PROBE_PORT="$PROBE_PORT" \
          PROBE_TARGET_URL="$MODEL_UPSTREAM" PROBE_OUTPUT_FILE="$PROBE_OUT" \
          nohup node evaluation/gate0/proxy-observability-probe.mjs \
            </dev/null >"$PROBE_LOG" 2>&1 & echo $! > "$PROBE_PID"; disown )
      sleep 2
      probe_running || { warn "probe did not stay up:"; tail -5 "$PROBE_LOG"; die "probe failed to start"; }
      ok "probe up (pid $(cat "$PROBE_PID")), capture → $PROBE_OUT"
    fi

    # 2. route the proxy through it, and force the right agent
    set_yaml_upstream "$PROBE_UPSTREAM"
    set_forced_agent "$AGENT"
    info "restarting proxy: upstream=$PROBE_UPSTREAM  agent=$AGENT"
    restart_proxy
    ok "proxy healthy, forced identity $AGENT — $WHO"

    # 2b. the pool must not move during the run
    case "$(core_extraction_state)" in
      false) ok "core auto-extraction already off" ;;
      true)
        info "core auto-extraction is ON (a redeploy regenerates the config with it on) — switching it off in place and restarting core"
        set_core_extraction_off && ok "core auto-extraction off; tdai-memory-core healthy and reads enabled: false" \
          || die "could not switch core auto-extraction off — refusing to prepare a run against a pool that can move"
        ;;
      *) die "cannot read $CORE_CFG — refusing to prepare without knowing whether the pool can move" ;;
    esac

    # 3. the api key CodeBuddy sends
    bash "$EVAL/tasks/bridge-addr/use-identity.sh" "$2" >/dev/null && ok "CodeBuddy key switched to identity $2"

    # The candidate log only fills at session init, so a session already open
    # writes nothing to it.
    : > "$EVAL/provenance/artifacts/candidate-log.jsonl"

    # Re-read the live environment. Reporting "ready" on the strength of having
    # issued the commands is the same mistake as a check that cannot run
    # reporting success.
    verify_ready "$AGENT" || die "preparation did not take — see the lines above; nothing was captured last time this state was reached"
    echo
    echo "  Ready. Start a ${C_B}fresh${C_0} CodeBuddy session — the skill listing runs once at"
    echo "  session init, so an already-open session records no candidates."
    echo "  Then: bash evaluation/runner/run-once.sh --label <name> --identity $2"
    ;;

  *) die "usage: $0 [--identity a|b|c | --status | --teardown]" ;;
esac
