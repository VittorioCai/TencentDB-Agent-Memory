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
# Since 2026-09-08 three gateway files are mounted beside the directory —
# `src/gateway/skill-handlers.ts`, `v2-schemas.ts`, `v2-router.ts` — because
# the gate now sits on the skill data plane too: every model read (get,
# get-by-name, files/read, list, search, listing) passes the asset registry,
# and only an admitted skill comes back on the model's path. The same
# parity rule applies per file: the image's copy must equal a committed
# version of ours.
#
# The SQLite schema gains `meta_asset_outcomes` on the next start
# (`CREATE TABLE IF NOT EXISTS`; the 2026-09-08 columns are added by an
# ALTER migration); the data volume is kept, so nothing is lost and
# `disable` leaves the extra table in place, unused.
#
# Usage:
#   bash evaluation/eval-core.sh enable
#   bash evaluation/eval-core.sh enable --accept-image <digest>
#   bash evaluation/eval-core.sh status
#   bash evaluation/eval-core.sh disable   # back to the stock image source
#
# --accept-image (2026-09-11, rule change agreed with the user; reasoning
# corrected 2026-09-12): the parity guard `image_dir_matches_prepatch`
# requires the image's src/metadata to equal a committed version of ours.
# After the containers were rebuilt it compared for the first time (it used
# to return early on our mounted marker file) and refused — correctly: the
# image is built from a NEWER upstream than this branch's base (9 metadata
# files carry the instance-upstream configuration, InstanceUpstreamConfig,
# routes /v3/meta/instance-upstream/* and /v3/meta/user/bind-external, which
# no commit of ours has), so the mount OVERWRITES those upstream additions at
# runtime. That is what every batch-4 and dev-loop run actually ran on
# (upstream-old + gate). With --accept-image <digest>, and only when the
# digest is the container's actual image, the guard is skipped as an
# explicit, printed exception: the overwrite is known, and what is
# overwritten is upstream functionality no evaluation path touches. The
# uncommitted-changes guard is untouched: what goes live must still be
# traceable to a commit. Without the option nothing changes.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONTAINER="${CONTAINER:-tdai-memory-core}"
PATCHED_DIR="$REPO_ROOT/MemoryCore/src/metadata"
IN_IMAGE_DIR="/app/src/metadata"
MARKER_FILE="service/asset-gate.ts"
# Gateway files mounted one by one (relative to MemoryCore/src and /app/src).
# Phase 2 (2026-09-08b) adds the versioning hook and its wiring:
# skill-versioning.ts fires onSkillVersioned, tdai-core.ts and server.ts
# hand it to the registry (syncSkillAssetVersion).
GATEWAY_FILES=(gateway/skill-handlers.ts gateway/v2-schemas.ts gateway/v2-router.ts gateway/server.ts core/tdai-core.ts core/skill/skill-versioning.ts)
GATEWAY_MARKER="admissionFilter"

die() { echo "[error] $*" >&2; exit 1; }
ok()  { echo "[ok] $*"; }

MODE="${1:-status}"; shift || true
ACCEPT_IMAGE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --accept-image) [[ -n "${2:-}" ]] || die "--accept-image needs a digest"; ACCEPT_IMAGE="$2"; shift 2 ;;
    *) die "unknown option: $1 (usage: $0 enable [--accept-image <digest>] | status | disable)" ;;
  esac
done

command -v docker >/dev/null || die "docker not found"
docker inspect "$CONTAINER" >/dev/null 2>&1 || die "container $CONTAINER is not present"

read_config() { docker inspect "$CONTAINER" --format "$1"; }
IMAGE="$(read_config '{{.Config.Image}}')"
IMAGE_ID="$(read_config '{{.Image}}')"                     # the image the container actually runs (content id)
REPO_DIGESTS="$(docker image inspect "$IMAGE_ID" --format '{{join .RepoDigests " "}}' 2>/dev/null || true)"
# A container that failed to start (2026-09-12: a mount that could not boot) has no
# NetworkSettings.Networks and no published ports; read the run configuration from
# HostConfig too, so `disable` still works as the restore path.
NETWORK_MODE="$(read_config '{{.HostConfig.NetworkMode}}')"
PORT_HC="$(read_config '{{range $p, $b := .HostConfig.PortBindings}}{{range $b}}{{.HostPort}}{{"\n"}}{{end}}{{end}}' | awk 'NF' | head -1)"
# A digest given with --accept-image must be the container's image: its id, or the digest part of one of its repo digests.
image_digest_matches() {  # $1 = digest
  local d="$1" r
  [[ "$d" == "$IMAGE_ID" ]] && return 0
  for r in $REPO_DIGESTS; do [[ "${r#*@}" == "$d" ]] && return 0; done
  return 1
}
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

[[ -n "$NETWORK" ]] || NETWORK="$NETWORK_MODE"
[[ -n "$PORT" ]] || PORT="$PORT_HC"
# the alias the running stack expects (the proxy reaches Core as memory-core); read when live, else the stack's convention
[[ -n "$ALIAS" ]] || ALIAS="${CORE_NETWORK_ALIAS:-memory-core}"
[[ -n "$IMAGE" && -n "$NETWORK" && -n "$PORT" && -n "$DATA_VOLUME" && -n "$CONFIG_FILE" ]] \
  || die "could not read the current run configuration from $CONTAINER (image=$IMAGE network=$NETWORK port=$PORT volume=$DATA_VOLUME config=$CONFIG_FILE)"

recreate() {
  # macOS ships bash 3.2: "${arr[@]}" of an EMPTY array trips `set -u`. On
  # 2026-09-12 that killed `disable` between `docker rm -f` and `docker run`,
  # leaving no container at all; the expansions below are the 3.2-safe form.
  local -a extra=("$@")
  docker rm -f "$CONTAINER" >/dev/null
  docker run -d --name "$CONTAINER" \
    --network "$NETWORK" \
    ${ALIAS:+--network-alias "$ALIAS"} \
    -p "${PORT}:8420" \
    -v "$DATA_VOLUME:/data/tdai-memory" \
    -v "$CONFIG_FILE:/data/config/tdai-gateway.yaml:ro" \
    ${ENV_ARGS[@]+"${ENV_ARGS[@]}"} \
    ${extra[@]+"${extra[@]}"} \
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

# --accept-image (2026-09-12, 方案 ①): the overwrite is measured, printed and
# recorded, never skipped silently. Per mounted file: how many lines the
# image's copy differs from what we mount, and from this branch's base (the
# upstream state the branch grew from). A file that exists only in the image
# under src/metadata would be HIDDEN by the directory mount — that is a real
# clobber and still refuses. The record goes to evaluation/gate/artifacts/
# core-mount-accept-<digest12>.json (§10: what changed, restore path), and
# batch-conditions.mjs freezes and checks it.
BRANCH_BASE="${BRANCH_BASE:-$(git -C "$REPO_ROOT" merge-base HEAD feat/server_team 2>/dev/null || echo 97f94654280b2932c35ba4806a491999ed244cc9)}"
ACCEPT_RECORD_DIR="$REPO_ROOT/evaluation/gate/artifacts"
diff_lines() { local n; n="$(diff "$1" "$2" 2>/dev/null | grep -c '^[<>]')" || true; echo "${n:-0}"; }
ACCEPT_ROWS=(); ACCEPT_ROUTES=""; ACCEPT_IMAGE_ONLY=""
accept_overwrite_report() {
  local tmp; tmp="$(mktemp -d)"
  docker cp "$CONTAINER:$IN_IMAGE_DIR" "$tmp/image" 2>/dev/null || { rm -rf "$tmp"; die "cannot read $IN_IMAGE_DIR from the container"; }
  mkdir -p "$tmp/base"
  git -C "$REPO_ROOT" archive "$BRANCH_BASE" MemoryCore/src 2>/dev/null | tar -x -C "$tmp/base" || { rm -rf "$tmp"; die "cannot archive the branch base $BRANCH_BASE"; }
  ACCEPT_IMAGE_ONLY="$(diff -rq "$tmp/image" "$PATCHED_DIR" 2>/dev/null | grep "^Only in $tmp/image" || true)"
  if [[ -n "$ACCEPT_IMAGE_ONLY" ]]; then
    echo "[error] files that exist only in the image under $IN_IMAGE_DIR would be hidden by the directory mount:" >&2
    echo "$ACCEPT_IMAGE_ONLY" >&2
    rm -rf "$tmp"; return 1
  fi
  echo "[info] overwrite by the mount (image vs mounted / image vs branch base $(printf %.7s "$BRANCH_BASE")), lines:"
  local f rel vo vb
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    rel="${f#$tmp/image/}"
    vo="$(diff_lines "$f" "$PATCHED_DIR/$rel")"; vb="$(diff_lines "$f" "$tmp/base/MemoryCore/src/metadata/$rel")"
    echo "       src/metadata/$rel: $vo / $vb"
    ACCEPT_ROWS+=("{\"path\":\"src/metadata/$rel\",\"image_vs_mounted_lines\":$vo,\"image_vs_base_lines\":$vb}")
  done < <(diff -rq "$tmp/image" "$PATCHED_DIR" 2>/dev/null | awk '/^Files /{print $2}')
  for rel in "${GATEWAY_FILES[@]}"; do
    docker cp "$CONTAINER:/app/src/$rel" "$tmp/gw.ts" 2>/dev/null || continue
    vo="$(diff_lines "$tmp/gw.ts" "$REPO_ROOT/MemoryCore/src/$rel")"; vb="$(diff_lines "$tmp/gw.ts" "$tmp/base/MemoryCore/src/$rel")"
    echo "       src/$rel: $vo / $vb"
    ACCEPT_ROWS+=("{\"path\":\"src/$rel\",\"image_vs_mounted_lines\":$vo,\"image_vs_base_lines\":$vb}")
  done
  # routes the image's router serves that the mounted router does not: the upstream features not in effect under the mount
  ACCEPT_ROUTES="$(comm -23 <(grep -oE '\$\{V3_PREFIX\}/[a-z0-9/_-]+' "$tmp/image/router/v3-meta-router.ts" 2>/dev/null | sort -u) <(grep -oE '\$\{V3_PREFIX\}/[a-z0-9/_-]+' "$PATCHED_DIR/router/v3-meta-router.ts" 2>/dev/null | sort -u) | sed 's#${V3_PREFIX}#/v3/meta#' | tr '\n' ' ')"
  echo "[info] routes in the image's v3-meta-router not served under the mount: ${ACCEPT_ROUTES:-none}"
  rm -rf "$tmp"; return 0
}
write_accept_record() {  # after a successful enable
  local digest12; digest12="$(printf %s "${IMAGE_ID#sha256:}" | cut -c1-12)"
  local out="$ACCEPT_RECORD_DIR/core-mount-accept-$digest12.json"
  local commit; commit="$(git -C "$REPO_ROOT" log -1 --format=%H -- MemoryCore/src/metadata MemoryCore/src/gateway MemoryCore/src/core)"
  local touches; touches="$(grep -rln -i -E 'instance-upstream|InstanceUpstream|bind-external|find-by-external' "$REPO_ROOT/evaluation" --include='*.mjs' --include='*.sh' --include='*.ts' 2>/dev/null | grep -v node_modules | wc -l | tr -d ' ')"
  local rows; rows="$(IFS=,; echo "${ACCEPT_ROWS[*]}")"
  python3 - "$out" "$IMAGE_ID" "$IMAGE" "$REPO_DIGESTS" "$(docker image inspect "$IMAGE_ID" --format '{{.Created}}' 2>/dev/null || true)" "$BRANCH_BASE" "$commit" "$rows" "$ACCEPT_ROUTES" "$touches" "$ACCEPT_IMAGE" <<'PY'
import json, sys, datetime
out, image_id, image_ref, repo, created, base, commit, rows, routes, touches, accepted = sys.argv[1:12]
rec = {
  "accepted_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
  "container": "tdai-memory-core", "image_ref": image_ref, "image_id": image_id, "accepted_digest": accepted,
  "repo_digests": repo.split(), "image_created": created or None,
  "branch_base": base, "mounted_commit": commit,
  "mounted_paths": ["src/metadata (directory)", "src/gateway/skill-handlers.ts", "src/gateway/v2-schemas.ts", "src/gateway/v2-router.ts", "src/gateway/server.ts", "src/core/tdai-core.ts", "src/core/skill/skill-versioning.ts"],
  "overwritten": json.loads("[" + rows + "]") if rows else [],
  "image_only_files_under_metadata": [],
  "routes_in_image_not_served_under_mount": routes.split(),
  "evaluation_references_those_routes": int(touches) > 0,
  "what_runs": "the image's other src files (upstream, newer than the branch base) plus these mounted files (branch base + gate): the same runtime every batch-4 and dev-loop run recorded on this image digest ran on",
  "restore": "bash evaluation/eval-core.sh disable   # back to the stock image source (the upstream features return)",
  "verify": "bash evaluation/eval-core.sh status",
}
json.dump(rec, open(out, "w"), indent=2, ensure_ascii=False); open(out, "a").write("\n")
print(f"[ok] record → {out}")
PY
}

# One gateway file: the image's copy must equal a committed version of ours
# (any commit in this branch's history of the file), unless it is already
# our mounted copy.
image_file_matches_committed() {  # rel path under src
  local rel="$1" tmp
  tmp="$(mktemp)"
  if ! docker cp "$CONTAINER:/app/src/$rel" "$tmp" 2>/dev/null; then rm -f "$tmp"; return 0; fi
  if grep -q "$GATEWAY_MARKER" "$tmp" 2>/dev/null && [[ "$rel" == "gateway/skill-handlers.ts" ]]; then rm -f "$tmp"; return 0; fi
  local c
  for c in $(git -C "$REPO_ROOT" log --format=%H -- "MemoryCore/src/$rel"); do
    if git -C "$REPO_ROOT" show "$c:MemoryCore/src/$rel" 2>/dev/null | diff -q - "$tmp" >/dev/null 2>&1; then rm -f "$tmp"; return 0; fi
  done
  echo "[warn] the image's src/$rel matches no committed version of this branch's file."
  echo "[warn] inspect: docker cp $CONTAINER:/app/src/$rel /tmp/img.ts && diff /tmp/img.ts $REPO_ROOT/MemoryCore/src/$rel"
  rm -f "$tmp"; return 1
}

gateway_mounted_now() {
  read_config '{{range .Mounts}}{{if eq .Destination "/app/src/gateway/skill-handlers.ts"}}{{.Source}}{{end}}{{end}}'
}

case "$MODE" in
  enable)
    [[ -f "$PATCHED_DIR/$MARKER_FILE" ]] || die "gate source not found: $PATCHED_DIR/$MARKER_FILE"
    if [[ -n "$ACCEPT_IMAGE" ]]; then
      image_digest_matches "$ACCEPT_IMAGE" \
        || die "--accept-image $ACCEPT_IMAGE is not the container's image (id $IMAGE_ID; repo digests: ${REPO_DIGESTS:-none}); nothing changed"
      echo "[ok] 已接受镜像 $ACCEPT_IMAGE(容器镜像 id $IMAGE_ID;repo digest: ${REPO_DIGESTS:-none}):目录守卫与逐文件守卫按显式例外跳过,覆盖按下面逐项打印并记录"
      accept_overwrite_report || die "refusing to enable: the directory mount would hide files that exist only in the image"
      echo "[ok] 明知覆盖:镜像比本分支基点新(上游实例上游配置等),挂载后这些文件的运行时为本分支版本(上游旧版 + 闸门);评测不经过被覆盖的路由"
    else
      image_dir_matches_prepatch || die "refusing to enable (once the overwrite has been read and accepted: enable --accept-image $IMAGE_ID)"
    fi
    if [[ -n "$(git -C "$REPO_ROOT" status --porcelain -- MemoryCore/src/metadata)" ]]; then
      echo "[warn] MemoryCore/src/metadata has uncommitted changes; they would go live with the mount:"
      git -C "$REPO_ROOT" status --short -- MemoryCore/src/metadata
      die "commit or stash them first — a run must be traceable to a commit"
    fi
    # The gateway files: same guards, per file.
    MOUNT_ARGS=(-v "$PATCHED_DIR:$IN_IMAGE_DIR:ro")
    for rel in "${GATEWAY_FILES[@]}"; do
      [[ -f "$REPO_ROOT/MemoryCore/src/$rel" ]] || die "gateway source not found: MemoryCore/src/$rel"
      if [[ -z "$ACCEPT_IMAGE" ]]; then image_file_matches_committed "$rel" || die "refusing to enable"; fi
      if [[ -n "$(git -C "$REPO_ROOT" status --porcelain -- "MemoryCore/src/$rel")" ]]; then
        die "MemoryCore/src/$rel has uncommitted changes; commit or stash them first — a run must be traceable to a commit"
      fi
      MOUNT_ARGS+=(-v "$REPO_ROOT/MemoryCore/src/$rel:/app/src/$rel:ro")
    done
    grep -q "$GATEWAY_MARKER" "$REPO_ROOT/MemoryCore/src/gateway/skill-handlers.ts" || die "skill-handlers.ts does not carry the admission filter"
    recreate "${MOUNT_ARGS[@]}"
    # Prove the routes are there: an unauthenticated call to a gate route must
    # be refused for auth, not 404'd as an unknown path.
    code="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:${PORT}/v3/meta/asset/gate/get" \
      -H 'content-type: application/json' -H 'x-tdai-service-id: default' -d '{"asset_id":"x"}' || true)"
    [[ "$code" != "404" ]] || die "gate route answered 404 after enable; the mount did not take"
    code2="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:${PORT}/v3/meta/asset/gate/submit" \
      -H 'content-type: application/json' -H 'x-tdai-service-id: default' -d '{"asset_id":"x"}' || true)"
    [[ "$code2" != "404" ]] || die "asset/gate/submit answered 404 after enable; the metadata mount did not take"
    ok "gate mounted → /v3/meta/asset/outcome/{append,list}, /v3/meta/asset/gate/{evaluate,get,review,submit} live (HTTP $code without a key)"
    ok "skill data plane mounted → ${GATEWAY_FILES[*]} (admission filter on get/get-by-name/files-read/list/search/listing)"
    ok "source commit: $(git -C "$REPO_ROOT" log -1 --format=%h -- MemoryCore/src/metadata MemoryCore/src/gateway)"
    if [[ -n "$ACCEPT_IMAGE" ]]; then write_accept_record; fi
    ;;
  disable)
    recreate
    ok "evaluation mode off: stock image source for src/metadata"
    ;;
  status)
    src="$(mounted_now)"
    if [[ -n "$src" ]]; then
      echo "gate:   mounted from ${src#/host_mnt}"
      gw="$(gateway_mounted_now)"
      [[ -n "$gw" ]] && echo "plane:  gateway files mounted (${GATEWAY_FILES[*]})" || echo "plane:  gateway files NOT mounted (image copies; skill reads are not admission-filtered)"
      echo "commit: $(git -C "$REPO_ROOT" log -1 --format='%h %s' -- MemoryCore/src/metadata MemoryCore/src/gateway)"
      [[ -z "$(git -C "$REPO_ROOT" status --porcelain -- MemoryCore/src/metadata MemoryCore/src/gateway)" ]] && echo "tree:   clean" || echo "tree:   UNCOMMITTED CHANGES in MemoryCore/src/metadata or src/gateway"
    else
      echo "gate:   not mounted (stock image source)"
    fi
    echo "image:  $IMAGE  port: $PORT  network: $NETWORK${ALIAS:+ alias: $ALIAS}"
    echo "digest: $IMAGE_ID${REPO_DIGESTS:+  ($REPO_DIGESTS)}"
    ;;
  *) die "usage: $0 enable [--accept-image <digest>] | disable | status" ;;
esac
