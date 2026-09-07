#!/usr/bin/env bash
# Put a verified author assessment onto the asset it was made for, then let
# the gate re-read the asset.
#
# The assessment (assess.mjs) is a file beside the evaluation. The gate reads
# `metadata_json.gate.author_assessment` on the asset record — that is the
# slot Core's decision consumes (MemoryCore/src/metadata/service/asset-gate.ts,
# authorAssessmentOf). This script merges `summary_for_gate` into that slot
# through the product's own asset/update (the asset's owner writes it), reads
# it back, and runs gate/evaluate so the decision on file reflects it.
#
# What lands on the asset is the verified summary only — competence, domain,
# time, citation count, the asset-claim verdict and the record ids that carry
# it, the pack hash and the assessment file — never the model's raw text.
#
# Usage:
#   bash evaluation/author/write-assessment.sh <assessment.json> [--owner-key F] [--as-of ISO] [--out F]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CORE_URL="${CORE_URL:-http://localhost:8420}"
SERVICE_ID="${SERVICE_ID:-default}"
ASSESSMENT="${1:-}"; shift || true
OWNER_KEY_FILE=""; AS_OF=""; OUT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --owner-key) OWNER_KEY_FILE="$2"; shift 2 ;;
    --as-of) AS_OF="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -f "$ASSESSMENT" ]] || { echo "usage: write-assessment.sh <assessment.json> [--owner-key F] [--as-of ISO] [--out F]" >&2; exit 2; }
die() { echo "[error] $*" >&2; exit 1; }

ASSET_ID="$(python3 -c "import json;print(json.load(open('$ASSESSMENT'))['asset_id'] or '')")"
[[ -n "$ASSET_ID" ]] || die "assessment carries no asset_id"
AUTHOR_LETTER="$(python3 -c "import json;print(json.load(open('$ASSESSMENT'))['author'].get('letter',''))")"
if [[ -z "$OWNER_KEY_FILE" ]]; then
  OWNER_KEY_FILE="$REPO_ROOT/$(python3 -c "import json;print(json.load(open('$REPO_ROOT/evaluation/tasks/identities.json'))['identities']['$AUTHOR_LETTER']['key_file'])")"
fi
[[ -f "$OWNER_KEY_FILE" ]] || die "owner key not found: $OWNER_KEY_FILE"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
call() {  # path body out — key over stdin
  local path="$1" body="$2" out="$3" key
  key="$(tr -d '[:space:]' < "$OWNER_KEY_FILE")"
  printf 'header = "Authorization: Bearer %s"\nheader = "x-tdai-user-key: %s"\n' "$key" "$key" \
    | curl -sS -K - --max-time 25 -H 'content-type: application/json' -H "x-tdai-service-id: $SERVICE_ID" -X POST "$CORE_URL$path" -d "$body" -o "$out"
}
ok() { python3 -c "import json,sys;sys.exit(0 if json.load(open(sys.argv[1])).get('code')==0 else 1)" "$1"; }

call "/v3/meta/asset/get" "{\"asset_id\":\"$ASSET_ID\"}" "$TMP/get.json"
ok "$TMP/get.json" || die "asset/get failed: $(cat "$TMP/get.json")"
python3 - "$TMP/get.json" "$ASSESSMENT" "$TMP/upd.json" <<'PY'
import json, sys
asset = json.load(open(sys.argv[1]))["data"]; a = json.load(open(sys.argv[2]))
try: m = json.loads(asset.get("metadata_json") or "{}")
except Exception: m = {}
if not isinstance(m, dict): m = {}
gate = m.get("gate") if isinstance(m.get("gate"), dict) else {}
gate["author_assessment"] = a["summary_for_gate"]
m["gate"] = gate
json.dump({"asset_id": asset["asset_id"], "metadata_json": json.dumps(m, ensure_ascii=False)}, open(sys.argv[3], "w"))
print(f"asset {asset['asset_id']} ({asset.get('name')}): writing author_assessment competence={a['summary_for_gate']['competence']} claim={a['summary_for_gate']['asset_claim_check']['verdict']}")
PY
call "/v3/meta/asset/update" "@$TMP/upd.json" "$TMP/upd-res.json"
ok "$TMP/upd-res.json" || die "asset/update failed: $(cat "$TMP/upd-res.json")"
# Read back: the slot must carry what was written.
call "/v3/meta/asset/get" "{\"asset_id\":\"$ASSET_ID\"}" "$TMP/after.json"
python3 -c "
import json,sys; a=json.load(open('$TMP/after.json'))['data']; m=json.loads(a['metadata_json']); s=m['gate']['author_assessment']; e=json.load(open('$ASSESSMENT'))['summary_for_gate']
sys.exit(0 if s.get('competence')==e['competence'] and s.get('assessed_at')==e['assessed_at'] else 1)" || die "read-back does not carry the assessment"
# The gate re-reads the asset, at as_of when given (the comparison's frozen time).
BODY="{\"asset_id\":\"$ASSET_ID\",\"apply\":true${AS_OF:+,\"as_of\":\"$AS_OF\"}}"
call "/v3/meta/asset/gate/evaluate" "$BODY" "$TMP/eval.json"
ok "$TMP/eval.json" || die "gate/evaluate failed: $(cat "$TMP/eval.json")"
python3 - "$TMP/eval.json" "$ASSESSMENT" "${OUT:-}" "$OWNER_KEY_FILE" "$AS_OF" <<'PY'
import json, sys, datetime, os
r = json.load(open(sys.argv[1]))["data"]; d = r["decision"]; a = json.load(open(sys.argv[2]))
print(f"gate: {d['decision']} (status {r['asset']['status']}) review_priority={d.get('review_priority')} assessment={json.dumps(d['signals']['author'].get('assessment'))}")
for line in d["reasons"]:
    if "assessment" in line or "priority" in line: print("  " + line)
if sys.argv[3]:
    rec = {"schema": "assessment-write-record-v1", "at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "assessment_file": sys.argv[2], "asset_id": a["asset_id"], "owner_key_file": sys.argv[4], "as_of": sys.argv[5] or None,
           "written": a["summary_for_gate"], "decision_after": d, "status_after": r["asset"]["status"]}
    os.makedirs(os.path.dirname(os.path.abspath(sys.argv[3])), exist_ok=True)
    json.dump(rec, open(sys.argv[3], "w"), indent=2, ensure_ascii=False); print(f"→ {sys.argv[3]}")
PY
