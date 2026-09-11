#!/usr/bin/env bash
# Switch the product's skill auto-extraction on or off, with the CLAUDE.md §10
# record: a protected backup of the mounted config, in-place (inode-preserving)
# edit, Core restart, read-back from inside the container, and a JSON record
# with the restore command. prepare.sh switches it OFF for the comparison
# batches; the dev loop's write-back (5e) needs it ON for the extraction worker
# to exist at all (tdai-core.ts: the queue and the worker are constructed only
# when skill.extraction.enabled), and OFF again afterwards.
#
# Usage: bash evaluation/runner/core-extraction.sh on|off|status [--record F]
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CORE_CFG="$REPO_ROOT/deploy/global-images/.memory-core-config/tdai-gateway.yaml"
BACKUP_DIR="$REPO_ROOT/deploy/global-images/.memory-core-config"   # gitignored, persistent, beside the config
MODE="${1:-status}"; RECORD=""
shift || true
while [[ $# -gt 0 ]]; do case "$1" in --record) RECORD="$2"; shift 2;; *) echo "unknown: $1" >&2; exit 2;; esac; done
state() { python3 - "$CORE_CFG" <<'PY' 2>/dev/null || echo unknown
import re, sys
s = open(sys.argv[1], encoding="utf-8").read()
m = re.search(r"^skill:\n(?:(?:  .*|)\n)*?  extraction:\n(?:(?:    .*|)\n)*?    enabled:\s*(true|false)", s, re.M)
print(m.group(1) if m else "unknown")
PY
}
in_container() { docker exec tdai-memory-core sh -c 'grep -A1 "^  extraction:" /data/config/tdai-gateway.yaml | tail -1' 2>/dev/null | tr -d ' ' ; }
sha() { shasum -a 256 "$1" | cut -c1-64; }
case "$MODE" in
  status) echo "skill.extraction.enabled: file=$(state) container=$(in_container)"; exit 0 ;;
  on|off) ;;
  *) echo "usage: $0 on|off|status [--record F]" >&2; exit 2 ;;
esac
WANT="$([[ "$MODE" == on ]] && echo true || echo false)"
BEFORE="$(state)"; SHA_BEFORE="$(sha "$CORE_CFG")"; INODE="$(stat -f %i "$CORE_CFG")"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="$BACKUP_DIR/tdai-gateway.yaml.bak-$STAMP-before-extraction-$MODE"
cp "$CORE_CFG" "$BACKUP"
if [[ "$BEFORE" == "$WANT" ]]; then
  echo "already $WANT; nothing written (backup kept at $BACKUP)"
else
  python3 - "$CORE_CFG" "$WANT" <<'PY' || exit 1
import re, sys
p, want = sys.argv[1], sys.argv[2]; s = open(p, encoding="utf-8").read()
pat = re.compile(r"(^skill:\n(?:(?:  .*|)\n)*?  extraction:\n(?:(?:    .*|)\n)*?    enabled:\s*)(true|false)", re.M)
new, n = pat.subn(lambda m: m.group(1) + want, s, count=1)
if n != 1: sys.exit("skill.extraction.enabled not found exactly once")
fh = open(p, "r+", encoding="utf-8"); fh.write(new); fh.truncate(); fh.close()
PY
  [[ "$(stat -f %i "$CORE_CFG")" == "$INODE" ]] || { echo "inode changed while writing $CORE_CFG — the container would keep the old bytes; restore: cp $BACKUP $CORE_CFG" >&2; exit 1; }
  docker restart tdai-memory-core >/dev/null || { echo "could not restart tdai-memory-core; restore: cp $BACKUP $CORE_CFG && docker restart tdai-memory-core" >&2; exit 1; }
  st=""; for _ in $(seq 1 45); do st="$(docker inspect tdai-memory-core --format '{{.State.Health.Status}}' 2>/dev/null)"; [[ "$st" == healthy ]] && break; sleep 2; done
  [[ "$st" == healthy ]] || { echo "tdai-memory-core did not come back healthy; restore: cp $BACKUP $CORE_CFG && docker restart tdai-memory-core" >&2; exit 1; }
fi
AFTER="$(state)"; IN="$(in_container)"; SHA_AFTER="$(sha "$CORE_CFG")"
OK=false; [[ "$AFTER" == "$WANT" && "$IN" == "enabled:$WANT" ]] && OK=true
REC="{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"switch\":\"$MODE\",\"config\":\"$CORE_CFG\",\"before\":\"$BEFORE\",\"after\":\"$AFTER\",\"container_reads\":\"$IN\",\"sha256_before\":\"$SHA_BEFORE\",\"sha256_after\":\"$SHA_AFTER\",\"backup\":\"$BACKUP\",\"restore\":\"cp $BACKUP $CORE_CFG && docker restart tdai-memory-core\",\"verify\":\"bash evaluation/runner/core-extraction.sh status\",\"ok\":$OK}"
[[ -n "$RECORD" ]] && { echo "$REC" >> "$RECORD"; }
echo "$REC"
$OK && echo "skill.extraction.enabled is $WANT (file and container agree); Core healthy" || { echo "NOT verified: file=$AFTER container=$IN" >&2; exit 1; }
