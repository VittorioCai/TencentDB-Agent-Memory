#!/usr/bin/env bash
# Put memory-core into evaluation mode, or take it back out.
#
# Evaluation mode mounts this branch's `MemoryCore/src/metadata` over the
# image's copy. That directory carries the admission gate (asset outcomes,
# the decision, the candidate pool — commit 98cbe25): the product's own
# `/v3/meta/asset/outcome/*` and `/v3/meta/asset/gate/*` routes, and the
# permission rule that hides a `candidate` from plain members. Nothing else
# in the image changes.
#
# Like the proxy image, the core image runs TypeScript directly (`node
# --import tsx src/gateway/server.ts`), so a bind mount is a deployment.
# Verified before use, every time: the image's `src/metadata` must be
# byte-identical to a committed version of this branch's directory from
# before the gate landed. If it is not, the mount would mix two versions,
# and the script refuses.
#
# The SQLite schema gains `meta_asset_outcomes` on the next start
# (`CREATE TABLE IF NOT EXISTS`); the data volume is kept, so nothing is lost
# and `disable` leaves the extra table in place, unused.
#
# Usage:
#   bash evaluation/eval-core.sh enable
#   bash evaluation/eval-core.sh status
#   bash evaluation/eval-core.sh disable   # back to the stock image source
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONTAINER="${CONTAINER:-tdai-memory-core}"
PATCHED_DIR="$REPO_ROOT/MemoryCore/src/metadata"
IN_IMAGE_DIR="/app/src/metadata"
MARKER_FILE="service/asset-gate.ts"

die() { echo "[error] $*" >&2; exit 1; }
ok()  { echo "[ok] $*"; }

command -v docker >/dev/null || die "docker not found"
docker inspect "$CONTAINER" >/dev/null 2>&1 || die "container $CONTAINER is not present"

read_config() { docker inspect "$CONTAINER" --format "$1"; }
IMAGE="$(read_config '{{.Config.Image}}')"
NETWORK="$(read_config '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' | awk 'NF' | head -1)"
ALIAS="$(read_config '{{range $k, $v := .NetworkSettings.Networks}}{{range $v.Aliases}}{{.}}{{"\n"}}{{end}}{{end}}' | awk 'NF' | head -1)"
PORT="$(read_config '{{range $p, $c := .NetworkSettings.Ports}}{{range $c}}{{.HostPort}}{{"\n"}}{{end}}{{end}}' | awk 'NF' | head -1)"
# The two stock mounts: the data volume and the gateway config file.
DATA_VOLUME="$(read_config '{{range .Mounts}}{{if eq .Destination "/data/tdai-memory"}}{{.Name}}{{end}}{{end}}')"
CONFIG_FILE="$(read_config '{{range .Mounts}}{{if eq .Destination "/data/config/tdai-gateway.yaml"}}{{.Source}}{{end}}{{end}}')"
# Docker Desktop reports host paths under /host_mnt; strip it for `docker run`.
CONFIG_FILE="${CONFIG_FILE#/host_mnt}"
# The container's own TDAI_* / NODE_OPTIONS environment, replayed verbatim
# (a while-read loop, not mapfile: the system bash on macOS is 3.2).
ENV_ARGS=()
while IFS= read -r line; do
  [[ -n "$line" ]] && ENV_ARGS+=(-e "$line")
done < <(read_config '{{range .Config.Env}}{{.}}{{"\n"}}{{end}}' | grep -E '^(TDAI_|NODE_OPTIONS=)')

[[ -n "$IMAGE" && -n "$NETWORK" && -n "$PORT" && -n "$DATA_VOLUME" && -n "$CONFIG_FILE" ]] \
  || die "could not read the current run configuration from $CONTAINER"

recreate() {
  local -a extra=("$@")
  docker rm -f "$CONTAINER" >/dev/null
  docker run -d --name "$CONTAINER" \
    --network "$NETWORK" \
    ${ALIAS:+--network-alias "$ALIAS"} \
    -p "${PORT}:8420" \
    -v "$DATA_VOLUME:/data/tdai-memory" \
    -v "$CONFIG_FILE:/data/config/tdai-gateway.yaml:ro" \
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

# The image's directory must equal a committed pre-gate version of ours.
image_dir_matches_prepatch() {
  local tmp; tmp="$(mktemp -d)"
  if ! docker cp "$CONTAINER:$IN_IMAGE_DIR" "$tmp/image" 2>/dev/null; then rm -rf "$tmp"; return 0; fi
  if [[ -f "$tmp/image/$MARKER_FILE" ]]; then rm -rf "$tmp"; return 0; fi   # already ours (mounted)
  local c
  for c in $(git -C "$REPO_ROOT" log --format=%H -- MemoryCore/src/metadata); do
    rm -rf "$tmp/branch"; mkdir -p "$tmp/branch"
    git -C "$REPO_ROOT" archive "$c" MemoryCore/src/metadata 2>/dev/null | tar -x -C "$tmp/branch" || continue
    if diff -rq "$tmp/image" "$tmp/branch/MemoryCore/src/metadata" >/dev/null 2>&1; then
      rm -rf "$tmp"; return 0
    fi
  done
  echo "[warn] the image's src/metadata matches no committed version of this branch's directory."
  echo "[warn] mounting ours over it could clobber changes that live only in the image."
  echo "[warn] inspect: docker cp $CONTAINER:$IN_IMAGE_DIR /tmp/img-meta && diff -rq /tmp/img-meta $PATCHED_DIR"
  rm -rf "$tmp"; return 1
}

mounted_now() {
  read_config '{{range .Mounts}}{{if eq .Destination "'"$IN_IMAGE_DIR"'"}}{{.Source}}{{end}}{{end}}'
}

case "${1:-status}" in
  enable)
    [[ -f "$PATCHED_DIR/$MARKER_FILE" ]] || die "gate source not found: $PATCHED_DIR/$MARKER_FILE"
    image_dir_matches_prepatch || die "refusing to enable"
    if [[ -n "$(git -C "$REPO_ROOT" status --porcelain -- MemoryCore/src/metadata)" ]]; then
      echo "[warn] MemoryCore/src/metadata has uncommitted changes; they would go live with the mount:"
      git -C "$REPO_ROOT" status --short -- MemoryCore/src/metadata
      die "commit or stash them first — a run must be traceable to a commit"
    fi
    recreate -v "$PATCHED_DIR:$IN_IMAGE_DIR:ro"
    # Prove the routes are there: an unauthenticated call to a gate route must
    # be refused for auth, not 404'd as an unknown path.
    code="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:${PORT}/v3/meta/asset/gate/get" \
      -H 'content-type: application/json' -H 'x-tdai-service-id: default' -d '{"asset_id":"x"}' || true)"
    [[ "$code" != "404" ]] || die "gate route answered 404 after enable; the mount did not take"
    ok "gate mounted → /v3/meta/asset/outcome/{append,list}, /v3/meta/asset/gate/{evaluate,get} live (HTTP $code without a key)"
    ok "source commit: $(git -C "$REPO_ROOT" log -1 --format=%h -- MemoryCore/src/metadata)"
    ;;
  disable)
    recreate
    ok "evaluation mode off: stock image source for src/metadata"
    ;;
  status)
    src="$(mounted_now)"
    if [[ -n "$src" ]]; then
      echo "gate:   mounted from ${src#/host_mnt}"
      echo "commit: $(git -C "$REPO_ROOT" log -1 --format='%h %s' -- MemoryCore/src/metadata)"
      [[ -z "$(git -C "$REPO_ROOT" status --porcelain -- MemoryCore/src/metadata)" ]] && echo "tree:   clean" || echo "tree:   UNCOMMITTED CHANGES in MemoryCore/src/metadata"
    else
      echo "gate:   not mounted (stock image source)"
    fi
    echo "image:  $IMAGE  port: $PORT  network: $NETWORK${ALIAS:+ alias: $ALIAS}"
    ;;
  *) die "usage: $0 enable|disable|status" ;;
esac
