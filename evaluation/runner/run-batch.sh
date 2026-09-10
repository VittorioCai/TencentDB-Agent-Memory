#!/usr/bin/env bash
# Run the formal comparison: gate-off / gate-on interleaved, N pairs, recording
# the order and every run id into a batch manifest. The manifest is what
# batch-conditions --check uses to prove the formal runs share no id with the
# gate baseline's source_runs (the preparation runs): evidence and samples must
# be different runs.
#
# Usage: bash evaluation/runner/run-batch.sh --batch 4 --pairs 5 [--manifest F]
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BATCH=""; PAIRS=5; MANIFEST=""
while [[ $# -gt 0 ]]; do case "$1" in --batch) BATCH="$2"; shift 2;; --pairs) PAIRS="$2"; shift 2;; --manifest) MANIFEST="$2"; shift 2;; *) echo "unknown: $1" >&2; exit 2;; esac; done
[[ -n "$BATCH" ]] || { echo "--batch required" >&2; exit 2; }
MANIFEST="${MANIFEST:-$REPO_ROOT/evaluation/gate/artifacts/batch${BATCH}-runs.json}"
BASELINE="${GATE_BASELINE:-$REPO_ROOT/evaluation/gate/artifacts/gate_baseline_batch${BATCH}.json}"
export GATE_BASELINE="$BASELINE" MEM_EXPECT_EMPTY="${MEM_EXPECT_EMPTY:-1}"
python3 - "$MANIFEST" "$BATCH" "$PAIRS" "$BASELINE" <<'PY'
import json,sys,datetime
m,b,p,base=sys.argv[1:5]
json.dump({"batch":int(b),"pairs":int(p),"order":"interleaved off,on per pair","gate_baseline":base,"started_at":datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),"runs":[]},open(m,"w"),indent=2)
PY
record() { python3 - "$MANIFEST" "$1" "$2" "$3" "$4" <<'PY'
import json,sys
m,rid,arm,seq,rc=sys.argv[1:6]
d=json.load(open(m)); d["runs"].append({"seq":int(seq),"arm":arm,"run_id":rid,"exit":int(rc)}); json.dump(d,open(m,"w"),indent=2)
PY
}
seq=0
for i in $(seq 1 "$PAIRS"); do
  for arm in off on; do
    seq=$((seq+1)); log="$(mktemp)"
    bash "$SCRIPT_DIR/run-once.sh" --auto --gate "$arm" --label "gate-$arm" > "$log" 2>&1; rc=$?
    rid="$(grep -oE 'run [0-9TZ]+-gate-(off|on)(-[0-9]+)? →' "$log" | head -1 | sed -E 's/^run //; s/ →$//')"
    echo "[$seq/$((PAIRS*2))] $arm  $rid  exit=$rc"
    record "${rid:-unknown}" "$arm" "$seq" "$rc"; cat "$log" >> "${MANIFEST%.json}.log"; rm -f "$log"
  done
done
echo "manifest → $MANIFEST"
