#!/usr/bin/env bash
# Put this branch's Panel build into the running memory-hub container, or take
# it back out.
#
# The hub image serves a compiled server (`/app/panel/dist`) and a built web
# app (`/app/panel/web/dist`); it does not run TypeScript from source the way
# the proxy and core images do, so a source mount would change nothing. What
# is mounted instead is the branch's own build of both: `MemoryPanel/dist`
# (tsc) and `MemoryPanel/web/dist` (vite). What that adds, for the
# admission gate (2026-09-07):
#
#   - the meta proxy accepts asset/gate/{get,evaluate,review} and
#     asset/outcome/{append,list} (meta-actions.ts);
#   - the web app gains the review queue page (/#/review) for admins and
#     reviewers: candidates by priority, the kernel's decision and reasons,
#     the author assessment, admit / reject / re-evaluate.
#
# Guards, every time: the image's panel package must be the same name and
# version as the branch's; both builds must exist and be newer than every
# source file they were built from; the tree under MemoryPanel must be clean,
# so the build is traceable to a commit. A recreated container keeps the data
# volume and replays the container's own environment.
#
# Usage:
#   bash evaluation/eval-panel.sh enable
#   bash evaluation/eval-panel.sh status
#   bash evaluation/eval-panel.sh disable   # back to the image's own build
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONTAINER="${CONTAINER:-tdai-memory-hub}"
SERVER_DIST="$REPO_ROOT/MemoryPanel/dist"
WEB_DIST="$REPO_ROOT/MemoryPanel/web/dist"
IN_SERVER="/app/panel/dist"
IN_WEB="/app/panel/web/dist"

die() { echo "[error] $*" >&2; exit 1; }
ok()  { echo "[ok] $*"; }

command -v docker >/dev/null || die "docker not found"
docker inspect "$CONTAINER" >/dev/null 2>&1 || die "container $CONTAINER is not present"

read_config() { docker inspect "$CONTAINER" --format "$1"; }
IMAGE="$(read_config '{{.Config.Image}}')"
NETWORK="$(read_config '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' | awk 'NF' | head -1)"
ALIAS="$(read_config '{{range $k, $v := .NetworkSettings.Networks}}{{range $v.Aliases}}{{.}}{{"\n"}}{{end}}{{end}}' | awk 'NF' | head -1)"
DATA_VOLUME="$(read_config '{{range .Mounts}}{{if eq .Destination "/data/knowledge"}}{{.Name}}{{end}}{{end}}')"
# Published ports, as "host:container" pairs.
PORT_ARGS=()
while IFS= read -r line; do [[ -n "$line" ]] && PORT_ARGS+=(-p "$line"); done < <(read_config '{{range $p, $c := .HostConfig.PortBindings}}{{range $c}}{{.HostPort}}:{{$p}}{{"\n"}}{{end}}{{end}}' | sed 's#/tcp##' | awk 'NF' | sort -u)
# The container's own environment, minus what the image sets itself.
ENV_ARGS=()
while IFS= read -r line; do
  [[ -n "$line" ]] && ENV_ARGS+=(-e "$line")
done < <(read_config '{{range .Config.Env}}{{.}}{{"\n"}}{{end}}' | grep -v -E '^(PATH|NODE_VERSION|YARN_VERSION|NODE_ENV)=')
[[ -n "$IMAGE" && -n "$NETWORK" && -n "$DATA_VOLUME" && ${#PORT_ARGS[@]} -gt 0 ]] || die "could not read the current run configuration from $CONTAINER"

recreate() {
  local -a extra=("$@")
  docker rm -f "$CONTAINER" >/dev/null
  docker run -d --name "$CONTAINER" \
    --network "$NETWORK" ${ALIAS:+--network-alias "$ALIAS"} \
    --add-host=host.docker.internal:host-gateway \
    "${PORT_ARGS[@]}" \
    -v "$DATA_VOLUME:/data/knowledge" \
    "${ENV_ARGS[@]}" \
    "${extra[@]}" \
    "$IMAGE" >/dev/null
  for _ in $(seq 1 60); do
    case "$(docker inspect "$CONTAINER" --format '{{.State.Health.Status}}' 2>/dev/null || echo none)" in
      healthy) return 0 ;;
      none)    docker inspect "$CONTAINER" --format '{{.State.Running}}' | grep -q true && return 0 ;;
    esac
    sleep 2
  done
  die "container did not become healthy; see: docker logs $CONTAINER"
}

panel_port() { read_config '{{range $p, $c := .HostConfig.PortBindings}}{{if eq $p "8125/tcp"}}{{range $c}}{{.HostPort}}{{end}}{{end}}{{end}}'; }

newest_mtime() { find "$1" -type f -newer "$2" 2>/dev/null | head -1; }

case "${1:-status}" in
  enable)
    # Same package, same version, or the build would be for a different panel.
    img_pkg="$(docker exec "$CONTAINER" sh -c 'grep -E "\"(name|version)\"" /app/panel/package.json' 2>/dev/null | tr -d ' ,"' | tr '\n' ' ')"
    loc_pkg="$(grep -E '"(name|version)"' "$REPO_ROOT/MemoryPanel/package.json" | tr -d ' ,"' | tr '\n' ' ')"
    [[ "$img_pkg" == "$loc_pkg" ]] || die "image panel package ($img_pkg) differs from the branch's ($loc_pkg); refusing to mount a build for another panel"
    [[ -f "$SERVER_DIST/index.js" && -f "$WEB_DIST/index.html" ]] || die "build first: (cd MemoryPanel && npm run build) and (cd MemoryPanel/web && npm run build)"
    if [[ -n "$(git -C "$REPO_ROOT" status --porcelain -- MemoryPanel)" ]]; then
      echo "[warn] MemoryPanel has uncommitted changes; a build must be traceable to a commit:"
      git -C "$REPO_ROOT" status --short -- MemoryPanel | head
      die "commit them first"
    fi
    # The builds must postdate every source file they were built from.
    stale_s="$(find "$REPO_ROOT/MemoryPanel/src" -type f -newer "$SERVER_DIST/index.js" | head -1)"
    stale_w="$(find "$REPO_ROOT/MemoryPanel/web/src" -type f -newer "$WEB_DIST/index.html" | head -1)"
    [[ -z "$stale_s" ]] || die "server build is older than $stale_s — rebuild"
    [[ -z "$stale_w" ]] || die "web build is older than $stale_w — rebuild"
    grep -q "asset/gate/review" "$SERVER_DIST/panel/api/meta-actions.js" 2>/dev/null || grep -rq "asset/gate/review" "$SERVER_DIST" || die "server build does not carry the gate actions"
    grep -rq "review_queue" "$WEB_DIST/assets" || die "web build does not carry the review queue"
    recreate -v "$SERVER_DIST:$IN_SERVER:ro" -v "$WEB_DIST:$IN_WEB:ro"
    port="$(panel_port)"
    # The meta proxy must know the new action. Without the session headers
    # every action answers 400 (headers are checked first), so the probe
    # sends identity A's key when its file is present: a registered action
    # is forwarded to the kernel (200 envelope), an unknown one is 404
    # UNKNOWN_META_ACTION. Without a key file only the 400/404 distinction
    # is available and the check is weaker; it says so.
    key_file="$REPO_ROOT/deploy/global-images/.topic4-user-key"
    if [[ -f "$key_file" ]]; then
      code="$(printf 'header = "X-Tdai-User-Key: %s"\n' "$(tr -d '[:space:]' < "$key_file")" | curl -sS -K - -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:${port}/api/v1/meta/asset/gate/get" -H 'content-type: application/json' -H 'X-Tdai-Service-Id: default' -d '{"asset_id":"x"}' || echo 000)"
      [[ "$code" != "404" && "$code" != "000" ]] || die "asset/gate/get answered HTTP $code with a key after enable; the server build did not take"
    else
      code="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:${port}/api/v1/meta/asset/gate/get" -H 'content-type: application/json' -d '{"asset_id":"x"}' || echo 000)"
      [[ "$code" != "404" && "$code" != "000" ]] || die "asset/gate/get answered HTTP $code after enable; the server build did not take"
      echo "[warn] no key file at $key_file — only checked that the action is not 404 before the header check"
    fi
    grep -q "review_queue" <(curl -sS "http://127.0.0.1:${port}/" -L 2>/dev/null; for f in $(curl -sS "http://127.0.0.1:${port}/" -L 2>/dev/null | grep -oE 'assets/main-[A-Za-z0-9_-]+\.js' | head -1); do curl -sS "http://127.0.0.1:${port}/$f"; done) \
      || die "the served web bundle does not carry the review queue"
    ok "panel build mounted: server $(git -C "$REPO_ROOT" log -1 --format=%h -- MemoryPanel) → $IN_SERVER, web → $IN_WEB"
    ok "meta proxy forwards asset/gate/get (HTTP $code); review queue at http://127.0.0.1:${port}/#/review"
    ;;
  disable)
    recreate
    ok "evaluation mode off: the image's own panel build"
    ;;
  status)
    src="$(read_config '{{range .Mounts}}{{if eq .Destination "'"$IN_WEB"'"}}{{.Source}}{{end}}{{end}}')"
    if [[ -n "$src" ]]; then
      echo "panel:  branch build mounted from ${src#/host_mnt} (and $IN_SERVER)"
      echo "commit: $(git -C "$REPO_ROOT" log -1 --format='%h %s' -- MemoryPanel)"
      [[ -z "$(git -C "$REPO_ROOT" status --porcelain -- MemoryPanel)" ]] && echo "tree:   clean" || echo "tree:   UNCOMMITTED CHANGES under MemoryPanel"
    else
      echo "panel:  image build (review queue not deployed)"
    fi
    echo "image:  $IMAGE  panel port: $(panel_port)  network: $NETWORK${ALIAS:+ alias: $ALIAS}"
    ;;
  *) die "usage: $0 enable|disable|status" ;;
esac
