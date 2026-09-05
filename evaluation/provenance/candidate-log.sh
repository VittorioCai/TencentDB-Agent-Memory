#!/usr/bin/env bash
# Turn the injector's candidate-set audit trail on or off.
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
# Usage:
#   bash evaluation/provenance/candidate-log.sh enable
#   bash evaluation/provenance/candidate-log.sh status
#   bash evaluation/provenance/candidate-log.sh disable   # back to the stock image
#
# `enable` and `disable` both recreate the container (an env var cannot be
# added to a running one). The proxy holds no state that matters here: its
# session store is rebuilt on the next request.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONTAINER="${CONTAINER:-tdai-proxy}"
PATCHED_SRC="$REPO_ROOT/MemoryProxy/src/injection/injectors/skill-injector.ts"
IN_IMAGE_SRC="/app/src/injection/injectors/skill-injector.ts"
LOG_DIR="$REPO_ROOT/evaluation/provenance/artifacts"
LOG_NAME="candidate-log.jsonl"

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

    mkdir -p "$LOG_DIR"
    recreate \
      -v "$PATCHED_SRC:$IN_IMAGE_SRC:ro" \
      -v "$LOG_DIR:/data/eval" \
      -e "TDAI_CANDIDATE_LOG=/data/eval/$LOG_NAME"
    ok "candidate log on → $LOG_DIR/$LOG_NAME"
    echo "     Start a fresh session: the listing runs once at session init, and its"
    echo "     block is cached for the rest of the session, so an in-flight session"
    echo "     writes nothing."
    ;;

  disable)
    recreate
    ok "candidate log off; proxy back to the stock image"
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
    ;;

  *) die "usage: $0 [enable|disable|status]" ;;
esac
