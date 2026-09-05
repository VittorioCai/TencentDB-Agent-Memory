#!/usr/bin/env bash
# Put the proxy into evaluation mode, or take it back out.
#
# Evaluation mode changes exactly two things, and both are off by default:
#
#   1. The injector's candidate-set audit trail (TDAI_CANDIDATE_LOG).
#   2. A second published port for the mainline scenario (SCENARIO_PORT).
#
# They live in one script because each is applied by recreating the container.
# Two scripts doing that independently would silently undo each other: the
# second would rebuild the run arguments from a container the first had already
# changed, and whichever ran last would win.
#
# Why this exists: `skill-injector.ts` logs `hits=<count>`. A count can support
# "something was recalled" but never "this asset was recalled", and an
# attribution record that cannot name the asset is not evidence. The patched
# injector appends one JSONL line per listing call carrying skill_id + version
# per hit *and* the rendered block — the input and the output of the narrowing
# step, which is the only way `recalled` and `selected` can be told apart.
#
# The proxy image runs TypeScript directly through tsx, so the patched source
# is bind-mounted over the image's copy rather than rebuilt. Verified before
# use: the image's `skill-injector.ts` is byte-identical to this branch's
# committed version, so the mount changes exactly the patch and nothing else.
#
# Off by default. This is evaluation instrumentation living in a production
# code path, so it is gated on an environment variable, appends rather than
# rewrites, and never fails a request when the write fails.
#
## The scenario port
#
# The mainline pair distinguishes two assets by the address they document. The
# "right" one cannot document `127.0.0.1:8096`: that exact URL is already in the
# injected `<skill_tools>` block of every session, so a model would write it
# having read nothing. It documents an arbitrary port instead, and that port has
# to actually reach the bridge for the acceptance check to be able to pass.
#
# Verified before choosing it: the proxy does not route on the Host header — a
# request carrying `Host: 127.0.0.1:47318` gets the same response as the default
# — so publishing a second port needs no application change.
#
# Usage:
#   bash evaluation/eval-proxy.sh enable
#   bash evaluation/eval-proxy.sh status
#   bash evaluation/eval-proxy.sh disable   # back to the stock configuration
#
# `enable` and `disable` both recreate the container (an env var cannot be
# added to a running one). The proxy holds no state that matters here: its
# session store is rebuilt on the next request.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONTAINER="${CONTAINER:-tdai-proxy}"
PATCHED_SRC="$REPO_ROOT/MemoryProxy/src/injection/injectors/skill-injector.ts"
IN_IMAGE_SRC="/app/src/injection/injectors/skill-injector.ts"
# The second patched file: the bridge, with read-op visibility (get /
# get-by-name / files/read honour the same whitelist as search). Without it a
# consumer can find another agent's team-shared skill through search and then
# get 40401 reading it by name — which is what blocked the cross-user mainline.
BRIDGE_SRC="$REPO_ROOT/MemoryProxy/src/skill/skill-bridge.ts"
IN_IMAGE_BRIDGE="/app/src/skill/skill-bridge.ts"
LOG_DIR="$REPO_ROOT/evaluation/provenance/artifacts"
LOG_NAME="candidate-log.jsonl"
# Kept in step with the address in evaluation/tasks/bridge-addr/assets/right.md;
# `status` checks the two still agree.
SCENARIO_PORT="${SCENARIO_PORT:-47318}"
RIGHT_ASSET="$REPO_ROOT/evaluation/tasks/bridge-addr/assets/right.md"

die() { echo "[error] $*" >&2; exit 1; }
ok()  { echo "[ok] $*"; }

command -v docker >/dev/null || die "docker not found"
docker inspect "$CONTAINER" >/dev/null 2>&1 || die "container $CONTAINER is not present"

# Reconstruct the run arguments from the container itself rather than
# duplicating start-proxy.sh, so this cannot drift away from how the proxy is
# actually deployed.
read_config() { docker inspect "$CONTAINER" --format "$1"; }

IMAGE="$(read_config '{{.Config.Image}}')"
NETWORK="$(read_config '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}')"
NETWORK="$(echo "$NETWORK" | awk 'NF' | head -1)"
ALIAS="$(read_config '{{range $k, $v := .NetworkSettings.Networks}}{{range $v.Aliases}}{{.}}{{"\n"}}{{end}}{{end}}' | awk 'NF' | head -1)"
# A published port appears once per address family, so the raw template
# concatenates "8096" twice. Split and take the first distinct value.
PORT="$(read_config '{{range $p, $c := .NetworkSettings.Ports}}{{range $c}}{{.HostPort}}{{"\n"}}{{end}}{{end}}' | awk 'NF' | head -1)"
CONFIG_FILE="$(read_config '{{range .Mounts}}{{if eq .Destination "/data/config.yaml"}}{{.Source}}{{end}}{{end}}')"

[[ -n "$IMAGE" && -n "$NETWORK" && -n "$PORT" && -n "$CONFIG_FILE" ]] \
  || die "could not read the current run configuration from $CONTAINER"

recreate() {
  local -a extra=("$@")
  docker rm -f "$CONTAINER" >/dev/null
  docker run -d --name "$CONTAINER" \
    --network "$NETWORK" \
    ${ALIAS:+--network-alias "$ALIAS"} \
    --add-host=host.docker.internal:host-gateway \
    -p "${PORT}:8096" \
    -v "$CONFIG_FILE:/data/config.yaml:ro" \
    "${extra[@]}" \
    "$IMAGE" >/dev/null

  for _ in $(seq 1 45); do
    case "$(docker inspect "$CONTAINER" --format '{{.State.Health.Status}}' 2>/dev/null || echo none)" in
      healthy) return 0 ;;
      none)    docker inspect "$CONTAINER" --format '{{.State.Running}}' | grep -q true && return 0 ;;
    esac
    sleep 2
  done
  die "container did not become healthy; see: docker logs $CONTAINER"
}

case "${1:-status}" in
  enable)
    [[ -f "$PATCHED_SRC" ]] || die "patched injector not found: $PATCHED_SRC"
    grep -q "TDAI_CANDIDATE_LOG" "$PATCHED_SRC" \
      || die "$PATCHED_SRC carries no candidate-log patch — nothing to enable"

    # The mount only holds if the rest of the file matches what the image ships.
    docker cp "$CONTAINER:$IN_IMAGE_SRC" /tmp/tdai-injector-in-image.ts 2>/dev/null || true
    if [[ -f /tmp/tdai-injector-in-image.ts ]] \
       && ! grep -q "TDAI_CANDIDATE_LOG" /tmp/tdai-injector-in-image.ts; then
      if ! git -C "$REPO_ROOT" show "HEAD:MemoryProxy/src/injection/injectors/skill-injector.ts" \
           | diff -q - /tmp/tdai-injector-in-image.ts >/dev/null; then
        echo "[warn] the image's injector differs from HEAD by more than this patch;"
        echo "[warn] mounting one file over it could mix two versions. Inspect before proceeding:"
        echo "       docker cp $CONTAINER:$IN_IMAGE_SRC /tmp/img.ts && diff /tmp/img.ts $PATCHED_SRC"
        die "refusing to enable"
      fi
    fi

    # Same parity guard for the bridge: mounting one file over the image's copy
    # is only safe if the image's copy is what this branch started from.
    [[ -f "$BRIDGE_SRC" ]] || die "patched bridge not found: $BRIDGE_SRC"
    grep -q "READ_VISIBILITY_OPS" "$BRIDGE_SRC" \
      || die "$BRIDGE_SRC carries no read-visibility patch — nothing to enable"
    docker cp "$CONTAINER:$IN_IMAGE_BRIDGE" /tmp/tdai-bridge-in-image.ts 2>/dev/null || true
    if [[ -f /tmp/tdai-bridge-in-image.ts ]] \
       && ! grep -q "READ_VISIBILITY_OPS" /tmp/tdai-bridge-in-image.ts; then
      if ! git -C "$REPO_ROOT" show "HEAD:MemoryProxy/src/skill/skill-bridge.ts" \
           | diff -q - /tmp/tdai-bridge-in-image.ts >/dev/null; then
        echo "[warn] the image's skill-bridge.ts differs from HEAD by more than this patch;"
        echo "       docker cp $CONTAINER:$IN_IMAGE_BRIDGE /tmp/img.ts && diff /tmp/img.ts $BRIDGE_SRC"
        die "refusing to enable"
      fi
    fi

    if [[ -f "$RIGHT_ASSET" ]] && ! grep -q ":$SCENARIO_PORT" "$RIGHT_ASSET"; then
      die "right.md does not document port $SCENARIO_PORT — publishing it would make the scenario unreachable"
    fi

    mkdir -p "$LOG_DIR"
    recreate \
      -p "${SCENARIO_PORT}:8096" \
      -v "$PATCHED_SRC:$IN_IMAGE_SRC:ro" \
      -v "$BRIDGE_SRC:$IN_IMAGE_BRIDGE:ro" \
      -v "$LOG_DIR:/data/eval" \
      -e "TDAI_CANDIDATE_LOG=/data/eval/$LOG_NAME"
    ok "candidate log on → $LOG_DIR/$LOG_NAME"
    ok "read-visibility bridge mounted → get-by-name resolves across visible team skills"
    ok "scenario port $SCENARIO_PORT published → the right-address asset is reachable"
    echo "     Start a fresh session: the listing runs once at session init, and its"
    echo "     block is cached for the rest of the session, so an in-flight session"
    echo "     writes nothing."
    ;;

  disable)
    recreate
    ok "evaluation mode off: no candidate log, no scenario port, stock image source"
    ;;

  status)
    if docker inspect "$CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -q TDAI_CANDIDATE_LOG; then
      echo "  candidate log: ON"
      if [[ -f "$LOG_DIR/$LOG_NAME" ]]; then
        echo "  entries: $(wc -l < "$LOG_DIR/$LOG_NAME" | tr -d ' ')  ($LOG_DIR/$LOG_NAME)"
        python3 - "$LOG_DIR/$LOG_NAME" <<'PY'
import json, sys
for line in open(sys.argv[1], encoding="utf-8"):
    line = line.strip()
    if not line:
        continue
    e = json.loads(line)
    hits = e.get("hits") or []
    names = ", ".join(h.get("name", "?") for h in hits) or "(none)"
    print(f"    {e.get('timestamp','')}  {e.get('trigger','')}  mode={e.get('mode')}  "
          f"agent={e.get('agent_id','')}  hits={len(hits)}: {names}")
PY
      else
        echo "  entries: 0 (no listing call has run since it was enabled)"
      fi
    else
      echo "  candidate log: OFF"
    fi

    if docker inspect "$CONTAINER" --format '{{range .Mounts}}{{.Destination}}{{"\n"}}{{end}}' | grep -qx "$IN_IMAGE_BRIDGE"; then
      echo "  read-visibility bridge: MOUNTED (get-by-name resolves across visible team skills)"
    else
      echo "  read-visibility bridge: not mounted — a consumer reading another agent's skill by name gets 40401"
    fi

    if docker inspect "$CONTAINER" --format '{{range $p, $c := .NetworkSettings.Ports}}{{range $c}}{{.HostPort}}{{"\n"}}{{end}}{{end}}' \
         | awk 'NF' | grep -qx "$SCENARIO_PORT"; then
      code="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${SCENARIO_PORT}/" --max-time 5 || echo "unreachable")"
      echo "  scenario port $SCENARIO_PORT: PUBLISHED (responds $code)"
    else
      echo "  scenario port $SCENARIO_PORT: not published — the right-address asset would fail"
    fi

    if [[ -f "$RIGHT_ASSET" ]]; then
      grep -q ":$SCENARIO_PORT" "$RIGHT_ASSET" \
        && echo "  right.md documents :$SCENARIO_PORT — script and asset agree" \
        || echo "  [warn] right.md does not document :$SCENARIO_PORT — they have drifted apart"
    fi
    ;;

  *) die "usage: $0 [enable|disable|status]" ;;
esac
