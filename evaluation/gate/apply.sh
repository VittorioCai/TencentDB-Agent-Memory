#!/usr/bin/env bash
# Gate integration (P3-3): write gate decisions into the product as asset
# `visibility`, and read back what the product then reports.
#
# The gate acts on exactly one field. The bridge's team-search whitelist is
# A ∪ B with A = meta list-accessible(visibility='team'); an asset set to
# `private` drops out of A, and since the four read paths (search, get,
# get-by-name, files/read) share that whitelist, it drops out of the
# consumer's reach entirely. That is what "reject" means in the product.
#
# Three modes:
#
#   --status   read each baseline asset's visibility; write {asset_id: vis|null}
#   --reset    restore every asset to its baseline visibility (gate OFF, and the
#              start of every gate-ON run — both arms begin from the same pool)
#   --apply    reset, then hide the assets the baseline's decisions reject
#
# Every write is followed by a read, and the record (--out) carries both. A
# write the service accepted but did not persist would otherwise look applied.
# Nothing is planned for an asset whose visibility could not be read: a run
# whose gate state is unknown is not comparable with anything.
#
# Only the asset's owner can change visibility (asset/update checks the caller
# against owner_user_id; admin status does not help). The key used is identity
# A's — the author of the scenario assets — and the record says so.
#
# Usage:
#   bash evaluation/gate/apply.sh --status [--baseline F] [--out F]
#   bash evaluation/gate/apply.sh --reset  [--baseline F] [--out F] [--dry-run]
#   bash evaluation/gate/apply.sh --apply  [--baseline F] [--out F] [--dry-run]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_DIR="$REPO_ROOT/deploy/global-images"

CORE_URL="${CORE_URL:-http://localhost:8420}"
SERVICE_ID="${SERVICE_ID:-default}"
KEY_FILE="${GATE_KEY_FILE:-$ENV_DIR/.topic4-user-key}"
BASELINE="$SCRIPT_DIR/artifacts/gate_baseline.json"
OUT=""
MODE=""
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --status|--reset|--apply) MODE="${1#--}"; shift ;;
    --baseline) BASELINE="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$MODE" ]] || { echo "usage: apply.sh --status|--reset|--apply [--baseline F] [--out F] [--dry-run]" >&2; exit 2; }

if [[ -t 1 ]]; then C_R=$'\033[31m'; C_G=$'\033[32m'; C_B=$'\033[34m'; C_Y=$'\033[33m'; C_0=$'\033[0m'
else C_R=""; C_G=""; C_B=""; C_Y=""; C_0=""; fi
info() { echo "${C_B}[$(date +%H:%M:%S)]${C_0} $*"; }
ok()   { echo "${C_G}[ok]${C_0} $*"; }
warn() { echo "${C_Y}[warn]${C_0} $*"; }
die()  { echo "${C_R}[error]${C_0} $*" >&2; exit 1; }

[[ -f "$BASELINE" ]] || die "no baseline: $BASELINE (build it with evaluation/gate/build-baseline.mjs)"
[[ -f "$KEY_FILE" ]] || die "owner key not found: $KEY_FILE"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# Credential over stdin to curl; never on a command line. Both headers, since
# /v3/meta/* reads x-tdai-user-key and answers 401 without it.
call() {
  local path="$1" body="$2" out="$3" key
  key="$(tr -d '[:space:]' < "$KEY_FILE")"
  printf 'header = "Authorization: Bearer %s"\nheader = "x-tdai-user-key: %s"\n' "$key" "$key" \
    | curl -sS -K - --max-time 25 \
        -H 'content-type: application/json' \
        -H "x-tdai-service-id: $SERVICE_ID" \
        -X POST "$CORE_URL$path" -d "$body" -o "$out"
}
envelope_ok() { python3 -c "import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if d.get('code')==0 else 1)" "$1" 2>/dev/null; }
envelope_msg() { python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d.get('message') or d)" "$1" 2>/dev/null | head -c 200; }

ASSET_IDS=()
while IFS= read -r id; do ASSET_IDS+=("$id"); done < <(python3 -c "import json;print('\n'.join(json.load(open('$BASELINE'))['assets'].keys()))")
(( ${#ASSET_IDS[@]} > 0 )) || die "baseline lists no assets"

# ── read ─────────────────────────────────────────────────────────
# Returns visibility or "null" (unreadable) per asset, plus the owner, into a
# JSON file. Unreadable is kept distinct from every real value.
read_visibility() {
  local out="$1"
  : > "$TMP/rows.jsonl"
  for id in "${ASSET_IDS[@]}"; do
    if call "/v3/meta/asset/get" "{\"asset_id\":\"$id\"}" "$TMP/get-$id.json" && envelope_ok "$TMP/get-$id.json"; then
      python3 -c "
import json; d=json.load(open('$TMP/get-$id.json'))['data']
print(json.dumps({'asset_id':'$id','visibility':d.get('visibility'),'owner_user_id':d.get('owner_user_id') or d.get('user_id'),'name':d.get('name')}))" >> "$TMP/rows.jsonl"
    else
      echo "{\"asset_id\":\"$id\",\"visibility\":null,\"owner_user_id\":null,\"error\":$(python3 -c "import json;print(json.dumps('$(envelope_msg "$TMP/get-$id.json" | tr -d '"')' or 'unreadable'))")}" >> "$TMP/rows.jsonl"
    fi
  done
  python3 - "$TMP/rows.jsonl" "$out" <<'PY'
import json, sys
rows = [json.loads(l) for l in open(sys.argv[1], encoding="utf-8") if l.strip()]
json.dump({r["asset_id"]: r["visibility"] for r in rows}, open(sys.argv[2], "w", encoding="utf-8"), indent=2)
json.dump(rows, open(sys.argv[2] + ".rows", "w", encoding="utf-8"), indent=2)
PY
}

show_rows() {
  python3 - "$1.rows" <<'PY'
import json, sys
for r in json.load(open(sys.argv[1], encoding="utf-8")):
    vis = r["visibility"] if r["visibility"] is not None else "UNREADABLE (" + str(r.get("error")) + ")"
    print(f"  {r['asset_id']}  {str(r.get('name') or ''):28}  visibility={vis:10}  owner={r.get('owner_user_id')}")
PY
}

info "reading visibility of ${#ASSET_IDS[@]} baseline asset(s) …"
read_visibility "$TMP/before.json"
show_rows "$TMP/before.json"

if [[ "$MODE" == "status" ]]; then
  if [[ -n "$OUT" ]]; then
    mkdir -p "$(dirname "$OUT")"; cp "$TMP/before.json" "$OUT"
    info "→ $OUT"
  fi
  python3 -c "import json,sys; sys.exit(1 if None in json.load(open('$TMP/before.json')).values() else 0)" \
    || die "at least one asset's visibility could not be read"
  exit 0
fi

# ── plan ─────────────────────────────────────────────────────────
PLAN_MODE="$MODE"
if ! node "$SCRIPT_DIR/plan-visibility.mjs" --mode="$PLAN_MODE" --baseline="$BASELINE" --current="$TMP/before.json" --json > "$TMP/plan.json"; then
  node "$SCRIPT_DIR/plan-visibility.mjs" --mode="$PLAN_MODE" --baseline="$BASELINE" --current="$TMP/before.json" || true
  die "plan refused: an asset's visibility could not be read, so its gate state would be unknown"
fi
node "$SCRIPT_DIR/plan-visibility.mjs" --mode="$PLAN_MODE" --baseline="$BASELINE" --current="$TMP/before.json"

N_CHANGES="$(python3 -c "import json;print(len(json.load(open('$TMP/plan.json'))['changes']))")"

# ── write, then read back ────────────────────────────────────────
: > "$TMP/results.jsonl"
if (( DRY_RUN )); then
  warn "dry run — nothing written"
else
  while IFS=$'\t' read -r id to; do
    [[ -n "$id" ]] || continue
    call "/v3/meta/asset/update" "{\"asset_id\":\"$id\",\"visibility\":\"$to\"}" "$TMP/upd-$id.json" || true
    if envelope_ok "$TMP/upd-$id.json"; then
      echo "{\"asset_id\":\"$id\",\"to\":\"$to\",\"accepted\":true}" >> "$TMP/results.jsonl"
    else
      echo "{\"asset_id\":\"$id\",\"to\":\"$to\",\"accepted\":false,\"error\":$(python3 -c "import json;print(json.dumps('$(envelope_msg "$TMP/upd-$id.json" | tr -d '"')'))")}" >> "$TMP/results.jsonl"
      warn "$id → $to refused: $(envelope_msg "$TMP/upd-$id.json")"
    fi
  done < <(python3 -c "
import json
for c in json.load(open('$TMP/plan.json'))['changes']:
    print(c['asset_id'] + '\t' + c['to'])")
fi

read_visibility "$TMP/after.json"

# ── record ───────────────────────────────────────────────────────
RECORD="${OUT:-$TMP/record.json}"
mkdir -p "$(dirname "$RECORD")"
python3 - "$MODE" "$DRY_RUN" "$BASELINE" "$KEY_FILE" "$TMP/plan.json" "$TMP/before.json" "$TMP/after.json" "$TMP/results.jsonl" "$RECORD" <<'PY'
import json, sys, datetime
mode, dry, baseline, key_file, plan_p, before_p, after_p, results_p, out = sys.argv[1:10]
plan = json.load(open(plan_p, encoding="utf-8"))
before = json.load(open(before_p, encoding="utf-8"))
after = json.load(open(after_p, encoding="utf-8"))
rows_after = {r["asset_id"]: r for r in json.load(open(after_p + ".rows", encoding="utf-8"))}
accepted = {}
for l in open(results_p, encoding="utf-8"):
    if l.strip():
        r = json.loads(l); accepted[r["asset_id"]] = r

# What each asset should read now: the plan's target for changed ones, the
# current value for unchanged ones.
expected = {c["asset_id"]: c["to"] for c in plan["changes"]}
for u in plan["unchanged"]:
    expected[u["asset_id"]] = u["visibility"]

verified = {aid: (after.get(aid) == vis) for aid, vis in expected.items()}
all_ok = all(verified.values()) and not plan["unreadable"]

owners = sorted({r.get("owner_user_id") for r in rows_after.values() if r.get("owner_user_id")})
record = {
    "mode": mode,
    "dry_run": bool(int(dry)),
    "at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "baseline": baseline,
    "key_file": key_file,
    # asset/update is owner-only, so an accepted write is itself the proof
    # that this key resolves to the owner. Recorded rather than assumed.
    "asset_owners": owners,
    "key_is_owner": "accepted writes prove it" if any(r["accepted"] for r in accepted.values()) else "not exercised (no writes)",
    "plan": plan,
    "visibility_before": before,
    "visibility_after": after,
    "writes": list(accepted.values()),
    "verified": verified,
    "all_verified": all_ok,
}
json.dump(record, open(out, "w", encoding="utf-8"), indent=2)
print()
for aid, vis in expected.items():
    if int(dry) and after.get(aid) != vis:
        print(f"  [plan] {aid}: would set {vis} (reads {after.get(aid)})")
    else:
        mark = "ok " if verified[aid] else "MISMATCH"
        print(f"  [{mark}] {aid}: expected {vis}, reads {after.get(aid)}")
sys.exit(0 if all_ok or bool(int(dry)) else 1)
PY
STATUS=$?

if (( DRY_RUN )); then
  info "dry run: $N_CHANGES change(s) planned, none written${OUT:+; record → $OUT}"
  exit 0
fi
if (( STATUS == 0 )); then
  ok "gate $MODE applied and read back ($N_CHANGES change(s))${OUT:+; record → $OUT}"
else
  die "gate $MODE did NOT read back as planned; see ${OUT:-the output above}"
fi
