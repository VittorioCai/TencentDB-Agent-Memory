#!/usr/bin/env bash
# Put the demo back to the state it was deployed in.
#
# A visitor is meant to click: admit, reject, overrule a correction by name.
# All of that writes. Rather than restrict what they may do, the whole
# metadata store is restored from the copy taken at deploy time — reviews,
# statuses, assessments, the lot. Ten seconds, and no surgical edits that
# could themselves be wrong.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
GOLDEN=data/golden/tdai-memory.tar.gz
[[ -f "$GOLDEN" ]] || { echo "[error] no golden snapshot at $GOLDEN — was up.sh run?" >&2; exit 1; }

echo "  stopping core…"
docker stop tdai-memory-core >/dev/null
echo "  restoring the store as deployed…"
docker run --rm -v tdai-memory-core-data:/dst -v "$PWD/data/golden:/src:ro" alpine \
  sh -c 'rm -rf /dst/metadata /dst/vectors.db && tar xzf /src/tdai-memory.tar.gz -C /dst' 
echo "  starting core…"
docker start tdai-memory-core >/dev/null
for _ in $(seq 1 60); do
  [[ "$(docker inspect tdai-memory-core --format '{{.State.Health.Status}}' 2>/dev/null)" == healthy ]] && { echo "  ready."; exit 0; }
  sleep 1
done
echo "[warn] core did not report healthy; see: docker logs tdai-memory-core" >&2
