#!/usr/bin/env bash
# Put a verified author assessment onto the asset it was made for, through
# the product's own route, then let the gate re-read the asset.
#
# Since 2026-09-08b the slot the gate reads (`metadata_json.gate.author_assessment`)
# is written only by `/v3/meta/asset/gate/assessment`: a team admin or
# reviewer writes it — never the author — and Core checks the binding
# (author, asset version, content hash, evidence cutoff) and signs it. An
# assessment merged into metadata_json through asset/update is dropped by
# the audit-field guard, and an unsigned one on file is ignored by the gate.
#
# What lands on the asset is `summary_for_gate` only — the derived
# competence and verdict, the model's as-said labels, counts, the cutoff,
# the binding, the pack hash and the assessment file — never the model's
# raw text.
#
# Usage:
#   bash evaluation/author/write-assessment.sh <assessment.json> [--writer-key F] [--as-of ISO] [--out F]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CORE_URL="${CORE_URL:-http://localhost:8420}"
SERVICE_ID="${SERVICE_ID:-default}"
ASSESSMENT="${1:-}"; shift || true
WRITER_KEY_FILE="${GATE_SUBMITTER_KEY_FILE:-$REPO_ROOT/deploy/global-images/.admin-key}"; AS_OF=""; OUT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --writer-key|--owner-key) WRITER_KEY_FILE="$2"; shift 2 ;;
    --as-of) AS_OF="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -f "$ASSESSMENT" ]] || { echo "usage: write-assessment.sh <assessment.json> [--writer-key F] [--as-of ISO] [--out F]" >&2; exit 2; }
die() { echo "[error] $*" >&2; exit 1; }

ASSET_ID="$(python3 -c "import json;print(json.load(open('$ASSESSMENT'))['asset_id'] or '')")"
[[ -n "$ASSET_ID" ]] || die "assessment carries no asset_id"
[[ -f "$WRITER_KEY_FILE" ]] || die "writer (admin/reviewer) key not found: $WRITER_KEY_FILE"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
call() {  # path body out — key over stdin
  local path="$1" body="$2" out="$3" key
  key="$(tr -d '[:space:]' < "$WRITER_KEY_FILE")"
  printf 'header = "Authorization: Bearer %s"\nheader = "x-tdai-user-key: %s"\n' "$key" "$key" \
    | curl -sS -K - --max-time 25 -H 'content-type: application/json' -H "x-tdai-service-id: $SERVICE_ID" -X POST "$CORE_URL$path" -d "$body" -o "$out"
}
ok() { python3 -c "import json,sys;sys.exit(0 if json.load(open(sys.argv[1])).get('code')==0 else 1)" "$1"; }

python3 - "$ASSESSMENT" "$TMP/body.json" <<'PY'
import json, sys
a = json.load(open(sys.argv[1])); s = a["summary_for_gate"]
json.dump({"asset_id": a["asset_id"], "assessment": s}, open(sys.argv[2], "w"), ensure_ascii=False)
print(f"asset {a['asset_id']}: writing assessment competence={s['competence']} (said {s.get('competence_as_said')}) claim={s['asset_claim_check']['verdict']} cutoff={s.get('evidence_cutoff')} version={s.get('asset_version')}")
PY
call "/v3/meta/asset/gate/assessment" "@$TMP/body.json" "$TMP/res.json"
ok "$TMP/res.json" || die "asset/gate/assessment failed: $(cat "$TMP/res.json")"
python3 -c "
import json; d=json.load(open('$TMP/res.json'))['data']; s=d['assessment']
print(f\"signed by {s.get('written_by')} at {s.get('written_at')}; decision now {d['decision']['decision']} (status {d['asset']['status']})\")"
# The gate re-reads the asset, at as_of when given (the comparison's frozen time).
BODY="{\"asset_id\":\"$ASSET_ID\",\"apply\":true${AS_OF:+,\"as_of\":\"$AS_OF\"}}"
call "/v3/meta/asset/gate/evaluate" "$BODY" "$TMP/eval.json"
ok "$TMP/eval.json" || die "gate/evaluate failed: $(cat "$TMP/eval.json")"
python3 - "$TMP/eval.json" "$ASSESSMENT" "${OUT:-}" "$WRITER_KEY_FILE" "$AS_OF" <<'PY'
import json, sys, datetime, os
r = json.load(open(sys.argv[1]))["data"]; d = r["decision"]; a = json.load(open(sys.argv[2]))
au = d["signals"]["author"]
print(f"gate: {d['decision']} (status {r['asset']['status']}) review_priority={d.get('review_priority')} assessment={'accepted' if au.get('assessment') else 'ignored: ' + str(au.get('assessment_ignored'))}")
for line in d["reasons"]:
    if "assessment" in line or "priority" in line: print("  " + line)
if sys.argv[3]:
    rec = {"schema": "assessment-write-record-v2", "at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "assessment_file": sys.argv[2], "asset_id": a["asset_id"], "writer_key_file": sys.argv[4], "as_of": sys.argv[5] or None,
           "written": a["summary_for_gate"], "decision_after": d, "status_after": r["asset"]["status"]}
    os.makedirs(os.path.dirname(os.path.abspath(sys.argv[3])), exist_ok=True)
    json.dump(rec, open(sys.argv[3], "w"), indent=2, ensure_ascii=False); print(f"→ {sys.argv[3]}")
PY
