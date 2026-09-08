#!/usr/bin/env bash
# Build the upload bundle, on this machine, for a fresh Linux host.
#
# The published images are the stock ones: the gate lives in this branch's
# source and is mounted over them, exactly as eval-core.sh does locally. So
# the bundle carries the source the mounts need, the Panel build (which is
# gitignored), the data snapshot and the demo site — everything the host
# needs beyond Docker itself.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
OUT="${1:-/private/tmp/claude-501/demo-bundle.tar.gz}"
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT

say() { printf '  %s\n' "$*"; }

# The six gateway/core files eval-core.sh mounts, plus the metadata tree.
mkdir -p "$STAGE/MemoryCore/src/gateway" "$STAGE/MemoryCore/src/core/skill"
cp -R MemoryCore/src/metadata "$STAGE/MemoryCore/src/metadata"
for f in gateway/skill-handlers.ts gateway/v2-schemas.ts gateway/v2-router.ts gateway/server.ts \
         core/tdai-core.ts core/skill/skill-versioning.ts; do
  cp "MemoryCore/src/$f" "$STAGE/MemoryCore/src/$f"
done
say "core source: src/metadata + 6 gateway/core files"

[[ -d MemoryPanel/dist && -d MemoryPanel/web/dist ]] || {
  echo "[error] the Panel is not built. Run: (cd MemoryPanel && npm run build) && (cd MemoryPanel/web && npm run build)" >&2; exit 1; }
mkdir -p "$STAGE/MemoryPanel/web"
cp -R MemoryPanel/dist "$STAGE/MemoryPanel/dist"
cp -R MemoryPanel/web/dist "$STAGE/MemoryPanel/web/dist"
say "panel build: dist + web/dist (gitignored, so it travels here)"

mkdir -p "$STAGE/config"
cp deploy/global-images/.memory-core-config/tdai-gateway.yaml "$STAGE/config/tdai-gateway.yaml"
cp -R deploy/demo/site "$STAGE/site"
cp -R deploy/demo/data "$STAGE/data"
cp deploy/demo/up.sh deploy/demo/reset.sh deploy/demo/Caddyfile.tmpl deploy/demo/README.md "$STAGE/"
chmod +x "$STAGE/up.sh" "$STAGE/reset.sh"
say "site, data snapshot, scripts"

# The commit the source came from, so the host can say what it is running.
git rev-parse --short HEAD > "$STAGE/COMMIT"
date -u +%Y-%m-%dT%H:%M:%SZ > "$STAGE/PACKED_AT"

mkdir -p "$(dirname "$OUT")"
tar czf "$OUT" -C "$STAGE" .
say "→ $OUT  ($(du -h "$OUT" | cut -f1))"
echo
echo "Upload and run on the host:"
echo "  scp $OUT root@<IP>:/root/"
echo "  ssh root@<IP> 'mkdir -p /opt/topic4 && tar xzf /root/$(basename "$OUT") -C /opt/topic4 && cd /opt/topic4 && DEMO_PASSWORD=<pw> ./up.sh'"
