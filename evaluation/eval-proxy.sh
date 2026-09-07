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
# Third and fourth patched files (commit cd2f9b0): one write switch for the
# skill prompt, the tool catalogue and the bridge gate. Under
# allowLlmWrite=false the <available_skills> header no longer orders the model
# to patch/create, the catalogue no longer offers skill_extract, and the
# bridge refuses extract. The injector factory passes the switch through.
TOOLS_SRC="$REPO_ROOT/MemoryProxy/src/injection/injectors/skill-tools-injector.ts"
IN_IMAGE_TOOLS="/app/src/injection/injectors/skill-tools-injector.ts"
FACTORY_SRC="$REPO_ROOT/MemoryProxy/src/injection/index.ts"
IN_IMAGE_FACTORY="/app/src/injection/index.ts"
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

# Is it safe to mount our patched file over the image's copy?
#
# Safe means the image's copy is a version this repo's history knows — so our
# HEAD file is a forward move, not a clobber of newer work that only exists in
# the image. The check is therefore: does the image file match the committed
# blob of that path at ANY commit? If yes, allow.
#
# This replaces an earlier rule that compared against HEAD (which refuses once
# the patch is committed, since HEAD then contains it) and then against "the
# newest unpatched commit" (correct in principle but order-sensitive and, in
# practice, refused a stock image it should have allowed). "Matches any
# historical version" is strictly simpler and cannot misfire that way.
#
# On refusal it prints what it compared, so a future refusal is diagnosable
# without another round trip.
#   $1 in-image path   $2 repo-relative path   $3 marker string
image_matches_prepatch() {
  local inimage="$1" path="$2" marker="$3"
  local tmp; tmp="$(mktemp)"
  if ! docker cp "$CONTAINER:$inimage" "$tmp" 2>/dev/null; then
    rm -f "$tmp"; return 0   # nothing in the image to clobber
  fi
  if grep -q "$marker" "$tmp"; then rm -f "$tmp"; return 0; fi  # already our patched file (mounted)

  local c
  for c in $(git -C "$REPO_ROOT" log --format=%H -- "$path"); do
    if git -C "$REPO_ROOT" show "$c:$path" 2>/dev/null | diff -q - "$tmp" >/dev/null 2>&1; then
      rm -f "$tmp"; return 0
    fi
  done

  echo "[warn] the image's $path matches no committed version of that file."
  echo "[warn] mounting our copy could clobber changes that live only in the image."
  echo "[warn] image sha256: $(shasum -a 256 "$tmp" | cut -c1-16)  ($(wc -l < "$tmp" | tr -d ' ') lines)"
  echo "[warn] inspect: docker cp $CONTAINER:$inimage /tmp/img.ts && git -C $REPO_ROOT diff --no-index /tmp/img.ts $REPO_ROOT/$path"
  rm -f "$tmp"; return 1
}

case "${1:-status}" in
  enable)
    [[ -f "$PATCHED_SRC" ]] || die "patched injector not found: $PATCHED_SRC"
    grep -q "TDAI_CANDIDATE_LOG" "$PATCHED_SRC" \
      || die "$PATCHED_SRC carries no candidate-log patch — nothing to enable"

    # The mount only holds if the rest of the file matches what the image ships.
    image_matches_prepatch "$IN_IMAGE_SRC" "MemoryProxy/src/injection/injectors/skill-injector.ts" "TDAI_CANDIDATE_LOG" || {
      echo "[warn] the image's injector is not the version this patch was made from;"
      echo "[warn] mounting one file over it could mix two versions. Inspect before proceeding:"
      echo "       docker cp $CONTAINER:$IN_IMAGE_SRC /tmp/img.ts && diff /tmp/img.ts $PATCHED_SRC"
      die "refusing to enable"
    }

    # Same parity guard for the bridge: mounting one file over the image's copy
    # is only safe if the image's copy is what this branch started from.
    [[ -f "$BRIDGE_SRC" ]] || die "patched bridge not found: $BRIDGE_SRC"
    grep -q "READ_VISIBILITY_OPS" "$BRIDGE_SRC" \
      || die "$BRIDGE_SRC carries no read-visibility patch — nothing to enable"
    image_matches_prepatch "$IN_IMAGE_BRIDGE" "MemoryProxy/src/skill/skill-bridge.ts" "READ_VISIBILITY_OPS" || {
      echo "[warn] the image's skill-bridge.ts is not the version this patch was made from;"
      echo "       docker cp $CONTAINER:$IN_IMAGE_BRIDGE /tmp/img.ts && diff /tmp/img.ts $BRIDGE_SRC"
      die "refusing to enable"
    }

    if [[ -f "$RIGHT_ASSET" ]] && ! grep -q ":$SCENARIO_PORT" "$RIGHT_ASSET"; then
      die "right.md does not document port $SCENARIO_PORT — publishing it would make the scenario unreachable"
    fi

    # The write-switch pair: same parity guard, same reason.
    [[ -f "$TOOLS_SRC" && -f "$FACTORY_SRC" ]] || die "write-switch sources not found: $TOOLS_SRC / $FACTORY_SRC"
    grep -q "extractTool" "$TOOLS_SRC" || die "$TOOLS_SRC carries no write-switch patch — nothing to enable"
    grep -q "allowLlmWrite })" "$FACTORY_SRC" || die "$FACTORY_SRC does not pass allowLlmWrite to SkillInjector — nothing to enable"
    image_matches_prepatch "$IN_IMAGE_TOOLS" "MemoryProxy/src/injection/injectors/skill-tools-injector.ts" "extractTool" \
      || die "refusing to enable (skill-tools-injector.ts)"
    image_matches_prepatch "$IN_IMAGE_FACTORY" "MemoryProxy/src/injection/index.ts" "allowLlmWrite })" \
      || die "refusing to enable (injection/index.ts)"

    mkdir -p "$LOG_DIR"
    recreate \
      -p "${SCENARIO_PORT}:8096" \
      -v "$PATCHED_SRC:$IN_IMAGE_SRC:ro" \
      -v "$BRIDGE_SRC:$IN_IMAGE_BRIDGE:ro" \
      -v "$TOOLS_SRC:$IN_IMAGE_TOOLS:ro" \
      -v "$FACTORY_SRC:$IN_IMAGE_FACTORY:ro" \
      -v "$LOG_DIR:/data/eval" \
      -e "TDAI_CANDIDATE_LOG=/data/eval/$LOG_NAME"
    ok "candidate log on → $LOG_DIR/$LOG_NAME"
    ok "read-visibility bridge mounted → get-by-name resolves across visible team skills"
    ok "write switch mounted → read-only sessions: no patch/create directive, no skill_extract, extract refused by the bridge"
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
      # A single-file bind mount follows the inode. Editing the file on the
      # host replaces the inode, and the container keeps the old bytes — a
      # restart does not help, only a recreate re-binds the path. Found the
      # hard way: the name-resolution fix sat on disk while the container ran
      # the previous whitelist logic. Compare bytes, not just the mount table.
      in_c="$(docker exec "$CONTAINER" sha256sum "$IN_IMAGE_BRIDGE" 2>/dev/null | cut -c1-16)"
      on_d="$(shasum -a 256 "$BRIDGE_SRC" 2>/dev/null | cut -c1-16)"
      if [[ -n "$in_c" && "$in_c" == "$on_d" ]]; then
        echo "  read-visibility bridge: MOUNTED and current ($in_c)"
      else
        echo "  read-visibility bridge: MOUNTED but STALE — container has $in_c, disk has $on_d."
        echo "                          The file was replaced after mounting; run 'enable' to re-bind (restart is not enough)."
      fi
      in_i="$(docker exec "$CONTAINER" sha256sum "$IN_IMAGE_SRC" 2>/dev/null | cut -c1-16)"
      on_i="$(shasum -a 256 "$PATCHED_SRC" 2>/dev/null | cut -c1-16)"
      [[ -n "$in_i" && "$in_i" == "$on_i" ]] \
        || echo "  candidate-log injector:  MOUNTED but STALE ($in_i vs $on_i) — run 'enable' to re-bind"
      # The write-switch pair: mounted and current, mounted but stale, or absent.
      for pair in "$IN_IMAGE_TOOLS|$TOOLS_SRC|skill-tools-injector" "$IN_IMAGE_FACTORY|$FACTORY_SRC|injection factory"; do
        in_p="${pair%%|*}"; rest="${pair#*|}"; on_p="${rest%%|*}"; label="${rest#*|}"
        if docker inspect "$CONTAINER" --format '{{range .Mounts}}{{.Destination}}{{"\n"}}{{end}}' | grep -qx "$in_p"; then
          in_h="$(docker exec "$CONTAINER" sha256sum "$in_p" 2>/dev/null | cut -c1-16)"
          on_h="$(shasum -a 256 "$on_p" 2>/dev/null | cut -c1-16)"
          [[ -n "$in_h" && "$in_h" == "$on_h" ]] \
            && echo "  write switch ($label): MOUNTED and current ($in_h)" \
            || echo "  write switch ($label): MOUNTED but STALE ($in_h vs $on_h) — run 'enable' to re-bind"
        else
          echo "  write switch ($label): not mounted — the prompt still orders patch/create and offers skill_extract under read-only"
        fi
      done
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
