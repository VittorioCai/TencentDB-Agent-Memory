#!/usr/bin/env bash
# Does the listing's verdict on each row agree with the decision that used it?
#
# The gate decides from outcome rows and `asset/outcome/list` stamps each row
# with `gate_validity` — both from `outcomeValidity`, one function. This
# checks that against the running stack: every row the decision cites must be
# one the listing calls usable, and the number of usable rows must equal the
# calls the decision counted.
#
#   bash evaluation/gate/check-listing-agrees.sh
#
# Two earlier versions of this check were wrong, in the same way: they sent
# {"pagination":{"limit":N}}, which the schema does not have — it merges
# limit/offset at the TOP level — so Zod stripped it and every request got
# the default first 20 rows. The comparison then held a partial row set
# against a whole decision. It passed anyway while the assets had fewer than
# 20 outcomes, and only failed once batch 3 pushed one to 23.
set -uo pipefail
cd /Users/vittoriocai/Desktop/Tecent_agentmemory-project4/.claude/worktrees/topic4-gate0
K=$(tr -d '[:space:]' < deploy/global-images/.admin-key)
TEAM=$(python3 -c "import json;print(json.load(open('evaluation/gate/artifacts/gate_baseline.json'))['team_id'])")
c() { printf 'header = "Authorization: Bearer %s"\nheader = "x-tdai-user-key: %s"\n' "$K" "$K" \
  | curl -sS -K - -H 'content-type: application/json' -H 'x-tdai-service-id: default' -X POST "http://localhost:8420$1" -d "$2"; }
for A in skl-sZFb3KatWY6m skl-oBaDO5CceKnr skl-lUWmwEYqsZDZ skl-ImeA29HL3Djj; do
  : > /tmp/rows-$A.jsonl; off=0
  while :; do
    c /v3/meta/asset/outcome/list "{\"team_id\":\"$TEAM\",\"asset_id\":\"$A\",\"limit\":100,\"offset\":$off}" > /tmp/page.json
    read n total < <(python3 -c "
import json;d=json.load(open('/tmp/page.json'))['data'];print(len(d['items']), d.get('total',0))")
    python3 -c "
import json
for o in json.load(open('/tmp/page.json'))['data']['items']: print(json.dumps(o))" >> /tmp/rows-$A.jsonl
    off=$((off+n)); { [ "$n" -eq 0 ] || [ "$off" -ge "$total" ]; } && break
  done
  c /v3/meta/asset/gate/evaluate "{\"asset_id\":\"$A\",\"apply\":false}" > /tmp/dec.json
  python3 - "$A" "$total" <<'PY'
import json, sys
A, total = sys.argv[1], int(sys.argv[2])
rows = [json.loads(l) for l in open(f"/tmp/rows-{A}.jsonl")]
dec = json.load(open('/tmp/dec.json'))['data']['decision']
on = dec['signals']['online']
usable = sorted(o['id'] for o in rows if o['gate_validity']['usable'])
cited = sorted(x['outcome_id'] for x in dec['evidence_refs'])
missing = [c for c in cited if c not in usable]
ok = (not missing) and len(usable) == on.get('calls') and len(rows) == total
print(f"{A:20s} {dec['decision']:8s} rows={len(rows)}/{total} usable={len(usable):2d} cites={len(cited):2d} "
      f"cited⊆usable={not missing} usable==calls={len(usable)==on.get('calls')} → {'OK' if ok else 'MISMATCH'}")
if missing: print("  CITED BUT NOT USABLE:", missing)
PY
done
