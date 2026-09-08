#!/usr/bin/env bash
# Bring the demo up on a fresh Linux host with Docker. Idempotent: run it
# again to redeploy after uploading a new bundle.
#
#   DEMO_PASSWORD=<something> ./up.sh
#
# Two containers and a proxy, ~700 MB of memory between them: memory-core
# (the registry and the gate), memory-hub (the Panel), and Caddy for the
# password and the docs site. The evaluation harness — the proxy probe and
# ClickHouse — is NOT here; it is only needed to RUN batches, and this host
# exists to show the results, not to produce them.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

die() { echo "[error] $*" >&2; exit 1; }
say() { printf '[ok] %s\n' "$*"; }

command -v docker >/dev/null || die "docker not found. On Ubuntu: curl -fsSL https://get.docker.com | sh"
docker info >/dev/null 2>&1 || die "the docker daemon is not running (try: systemctl start docker)"
[[ -n "${DEMO_PASSWORD:-}" ]] || die "set DEMO_PASSWORD — the site is public and carries real team data"

NET=tdai-demo
CORE_IMAGE="${CORE_IMAGE:-agentmemory/memory-core:latest}"
HUB_IMAGE="${HUB_IMAGE:-agentmemory/memory-hub:latest}"
SRC="$PWD"

docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null
say "network $NET"

for img in "$CORE_IMAGE" "$HUB_IMAGE" caddy:2-alpine; do
  docker image inspect "$img" >/dev/null 2>&1 || { echo "  pulling $img …"; docker pull -q "$img" >/dev/null; }
done
say "images present"

# ── data ────────────────────────────────────────────────────────────────
# First run seeds the volumes from the snapshot and keeps a golden copy for
# reset.sh. A redeploy leaves the live data alone: someone may be looking at
# it. Pass RESEED=1 to load the snapshot again.
seed_volume() { # volume tarball
  docker volume inspect "$1" >/dev/null 2>&1 || docker volume create "$1" >/dev/null
  docker run --rm -v "$1:/dst" -v "$SRC/data:/src:ro" alpine \
    sh -c "tar xzf /src/$2 -C /dst" >/dev/null
}
if [[ ! -f data/golden/tdai-memory.tar.gz || "${RESEED:-0}" == "1" ]]; then
  seed_volume tdai-memory-core-data tdai-memory.tar.gz
  seed_volume tdai-panel-data tdai-panel.tar.gz
  mkdir -p data/golden && cp data/tdai-memory.tar.gz data/golden/
  say "data seeded from the snapshot; golden copy kept for reset.sh"
else
  say "data left as it stands (RESEED=1 to reload the snapshot)"
fi

# ── core: the stock image with this branch's gate mounted over it ────────
# The same six gateway/core files and the metadata tree eval-core.sh mounts
# locally. The published image does not contain the gate.
docker rm -f tdai-memory-core >/dev/null 2>&1 || true
docker run -d --name tdai-memory-core --restart unless-stopped \
  --network "$NET" --network-alias memory-core \
  -v tdai-memory-core-data:/data/tdai-memory \
  -v "$SRC/config/tdai-gateway.yaml:/data/config/tdai-gateway.yaml:ro" \
  -v "$SRC/MemoryCore/src/metadata:/app/src/metadata:ro" \
  -v "$SRC/MemoryCore/src/gateway/skill-handlers.ts:/app/src/gateway/skill-handlers.ts:ro" \
  -v "$SRC/MemoryCore/src/gateway/v2-schemas.ts:/app/src/gateway/v2-schemas.ts:ro" \
  -v "$SRC/MemoryCore/src/gateway/v2-router.ts:/app/src/gateway/v2-router.ts:ro" \
  -v "$SRC/MemoryCore/src/gateway/server.ts:/app/src/gateway/server.ts:ro" \
  -v "$SRC/MemoryCore/src/core/tdai-core.ts:/app/src/core/tdai-core.ts:ro" \
  -v "$SRC/MemoryCore/src/core/skill/skill-versioning.ts:/app/src/core/skill/skill-versioning.ts:ro" \
  -e TDAI_GATEWAY_HOST=0.0.0.0 -e TDAI_GATEWAY_PORT=8420 \
  -e TDAI_DATA_DIR=/data/tdai-memory \
  -e TDAI_GATEWAY_CONFIG=/data/config/tdai-gateway.yaml \
  -e TDAI_GATEWAY_API_KEY= \
  -e NODE_OPTIONS=--max-old-space-size=768 \
  "$CORE_IMAGE" >/dev/null
say "core started (heap capped at 768 MB — this box has 2 GB)"

docker rm -f tdai-memory-hub >/dev/null 2>&1 || true
docker run -d --name tdai-memory-hub --restart unless-stopped \
  --network "$NET" --network-alias tdai-memory-hub \
  --add-host=host.docker.internal:host-gateway \
  -v tdai-panel-data:/data/knowledge \
  -v "$SRC/MemoryPanel/dist:/app/panel/dist:ro" \
  -v "$SRC/MemoryPanel/web/dist:/app/panel/web/dist:ro" \
  -e PANEL_PORT=8125 \
  -e TDAI_AGENT_TEMPLATE_DIR=/data/knowledge/agent-templates \
  "$HUB_IMAGE" >/dev/null
say "panel started"

# ── caddy: the password, the docs site, and the panel's own port ─────────
HASH="$(docker run --rm caddy:2-alpine caddy hash-password --plaintext "$DEMO_PASSWORD")"
docker rm -f tdai-demo-caddy >/dev/null 2>&1 || true
docker run -d --name tdai-demo-caddy --restart unless-stopped \
  --network "$NET" \
  -p 80:80 -p 8125:8125 \
  -v "$SRC/Caddyfile.tmpl:/etc/caddy/Caddyfile:ro" \
  -v "$SRC/site:/srv/site:ro" \
  -e DEMO_PASSWORD_HASH="$HASH" \
  caddy:2-alpine >/dev/null
say "caddy started (basic auth, user 'demo')"

for _ in $(seq 1 90); do
  [[ "$(docker inspect tdai-memory-core --format '{{.State.Health.Status}}' 2>/dev/null)" == healthy ]] && break
  sleep 1
done
IP="$(curl -fsS --max-time 5 https://checkip.amazonaws.com 2>/dev/null | tr -d '[:space:]' || echo '<this host>')"
echo
echo "  overview   http://$IP/            (user demo)"
echo "  panel      http://$IP:8125/#/review"
echo "  running    $(cat COMMIT 2>/dev/null || echo '?')  packed $(cat PACKED_AT 2>/dev/null || echo '?')"
echo "  reset      ./reset.sh"
