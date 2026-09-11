#!/usr/bin/env bash
# One command, six segments, one question each:
#
#   1. What is in the asset pool, and who wrote it?
#   2. With the gate off, what happens?
#   3. What did attribution conclude, and what did it change?
#   4. With the gate on, what happens?
#   5. How accurate is the judgement itself?
#   6. Does experience flow back: the dev loop
#
# Every segment is labelled [live], [record] or [fixture]. A [live] segment is
# produced by actually running something now; a [record] segment reads the
# real records of runs already made (evaluation/runner/runs/, gate/artifacts/,
# tasks/*/devloop-runs.json) and names them; a [fixture] segment reads sample
# data from evaluation/contracts/fixtures/. The distinction is enforced by
# seg_begin(), which refuses to print without a source, because a demo that
# renders sample data as if it were a real result is the same failure this
# project exists to prevent.
#
# Usage:
#   bash evaluation/demo.sh            # run everything
#   bash evaluation/demo.sh --plain    # no colour (for piping into a file)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FIXTURES="$SCRIPT_DIR/contracts/fixtures"
ARTIFACTS="$SCRIPT_DIR/provenance/artifacts"

if [[ "${1:-}" == "--plain" || ! -t 1 ]]; then
  C_DIM=""; C_B=""; C_G=""; C_Y=""; C_R=""; C_0=""
else
  C_DIM=$'\033[2m'; C_B=$'\033[1m'; C_G=$'\033[32m'; C_Y=$'\033[33m'; C_R=$'\033[31m'; C_0=$'\033[0m'
fi

LIVE_COUNT=0
RECORD_COUNT=0
FIXTURE_COUNT=0
RUNS="$SCRIPT_DIR/runner/runs"
GATE_ART="$SCRIPT_DIR/gate/artifacts"
REJUDGE="${REJUDGE_DIR:-/private/tmp/topic4-rejudge/2026-09-11}"

# seg_begin <n> <title> <live|fixture> [note]
# The source tag is mandatory. Callers cannot print a segment without declaring
# where its data came from.
seg_begin() {
  local n="$1" title="$2" src="$3" note="${4:-}"
  local tag
  case "$src" in
    live)    tag="${C_G}[live]${C_0}";    LIVE_COUNT=$((LIVE_COUNT + 1)) ;;
    record)  tag="${C_B}[record]${C_0}";  RECORD_COUNT=$((RECORD_COUNT + 1)) ;;
    fixture) tag="${C_Y}[fixture]${C_0}"; FIXTURE_COUNT=$((FIXTURE_COUNT + 1)) ;;
    *) echo "demo.sh: segment $n declared an unknown source '$src'" >&2; exit 2 ;;
  esac
  echo
  echo "${C_B}[$n/6] $title${C_0}  $tag${note:+  ${C_DIM}$note${C_0}}"
  echo "${C_DIM}────────────────────────────────────────────────────────────${C_0}"
}

row() { printf '      %s\n' "$*"; }
note() { echo "      ${C_DIM}$*${C_0}"; }

have_stack() { docker ps --format '{{.Names}}' 2>/dev/null | grep -q tdai-memory-core; }

# ── 1. The asset pool ────────────────────────────────────────────
#
# Reads the snapshot; never takes one. Freezing the pool is a deliberate act —
# it is what `pool_snapshot_at` means and what the answer-leak guard compares
# against — so it belongs to `enter-pool.sh`, not to a command whose job is to
# render results. An earlier version re-froze here on every run, against the
# default team, and silently replaced the evaluation freeze with a fresh
# snapshot of a different pool.
segment_pool() {
  local snap="$ARTIFACTS/asset-pool-snapshot.json"
  if [[ -f "$snap" ]]; then
    seg_begin 1 "Asset pool" live
    python3 - "$snap" "$SCRIPT_DIR/tasks/bridge-addr/pair.json" <<'PY'
import json, os, sys
snap = json.load(open(sys.argv[1], encoding="utf-8"))
owners = {a["producer_user_id"] for a in snap["assets"] if a["producer_user_id"]}
print(f"      frozen at {snap['pool_snapshot_at']}   team {snap['team_id']}")
for a in snap["assets"]:
    print(f"      {a['asset_id']:<22} {a['name'][:34]:<36} author={a['producer_user_id']}")
print(f"      {snap['asset_count']} asset(s), {len(owners)} distinct author(s)")

# Cross-person reuse is judged on user_id, so the demo has to show that a second
# identity exists and which role each one plays. Both come from pair.json, which
# is written when the pool is frozen — hardcoding them here would keep printing
# the last run's identities after the pool changed.
pair_path = sys.argv[2]
if os.path.exists(pair_path):
    pair = json.load(open(pair_path, encoding="utf-8"))
    authors = sorted({a["producer_user_id"] for a in pair["assets"] if a["producer_user_id"]})
    print()
    print(f"      identities:  {', '.join(authors) or '?'} authors   {pair['consumer_agent_id']} consumes")
    if pair["pool_snapshot_at"] != snap["pool_snapshot_at"]:
        print(f"      [warn] pair.json was written for {pair['pool_snapshot_at']}, this snapshot is"
              f" {snap['pool_snapshot_at']} — re-run enter-pool.sh")
else:
    print("      identities:  pair.json not written yet (P4-1b)")
print("      both operated by one person: the mechanism is real, ecological validity is not")
PY
  else
    seg_begin 1 "Asset pool" fixture "no snapshot yet"
    row "run evaluation/tasks/bridge-addr/enter-pool.sh to enter the pool and freeze it"
  fi
}

# ── 2. Gate off ──────────────────────────────────────────────────
# The evidence base: the first preparation run of batch 4 (gate off, both
# assets admitted). Read from its record — receipt, verdict, outcome events.
segment_gate_off() {
  local base="$GATE_ART/gate_baseline_batch4.json" run
  run="$(python3 -c "import json,sys;b=json.load(open(sys.argv[1]));print(b['source_runs'][0]['run_id'])" "$base" 2>/dev/null || true)"
  if [[ -n "$run" && -d "$RUNS/$run" ]]; then
    seg_begin 2 "Gate off — identity B runs the task" record "run $run (batch 4 evidence base)"
    python3 - "$RUNS/$run" <<'PY'
import json, os, sys, collections
d = sys.argv[1]
run = json.load(open(os.path.join(d, "run.json"), encoding="utf-8"))
verdict = json.load(open(os.path.join(d, "verdict.json"), encoding="utf-8"))
gate = run.get("gate") or {}
print(f"      gate {gate.get('mode')}: status at start {gate.get('status_at_start')}")
outcomes = collections.Counter()
names = {}
for line in open(os.path.join(d, "outcome-events.jsonl"), encoding="utf-8"):
    if not line.strip(): continue
    e = json.loads(line); outcomes[(e["asset_id"], e["state"])] += 1; names[e["asset_id"]] = e.get("asset_name") or e["asset_id"]
for (aid, state), n in sorted(outcomes.items()):
    print(f"      {state:<13} {names[aid][:30]:<32} x{n}")
for a in verdict.get("attempts", []):
    print(f"      attempt  {str(a.get('host'))}:{str(a.get('port'))}  ok={a.get('ok')}  {a.get('why')}")
print(f"      verdict {verdict['verdict']}: {verdict['reason'][:90]}")
PY
    local receipt="$RUNS/$run/receipt.zh.txt"
    [[ -f "$receipt" ]] && { note "receipt (first lines of $run/receipt.zh.txt):"; sed -n '3,5p' "$receipt" | cut -c1-110 | sed 's/^/      /'; }
  else
    seg_begin 2 "Gate off — identity B runs the task" fixture "no batch-4 evidence-base run under runner/runs/"
    row "injected 2 assets -> model fetched the wrong-address skill"
    row "curl timed out -> acceptance FAILED"
  fi
}

# ── 3. Attribution ───────────────────────────────────────────────
# What the outcomes decided: Core's gate decision per asset in the frozen
# batch-4 baseline, with its reasons and evidence counts.
segment_attribution() {
  local base="$GATE_ART/gate_baseline_batch4.json"
  if [[ -f "$base" ]]; then
    seg_begin 3 "Attribution, and what it changed" record "gate_baseline_batch4.json (frozen $(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['frozen_at'])" "$base"))"
    python3 - "$base" <<'PY'
import json, sys
b = json.load(open(sys.argv[1], encoding="utf-8"))
for d in b.get("decisions") or []:
    sig = (d.get("signals") or {}).get("online") or {}
    print(f"      {d['decision']:<8} {d['asset_name'][:30]:<32} used {sig.get('used_hard','?')}  validated {sig.get('validated','?')}  corrected {sig.get('corrected','?')}")
    print(f"               {d['reasons'][0][:100]}")
print(f"      evidence: {len(b.get('source_runs') or [])} run(s) — " + ", ".join(r['run_id'] for r in b.get('source_runs') or []))
PY
  else
    seg_begin 3 "Attribution, and what it changed" fixture "no frozen baseline"
  fi
}

# ── 4. Gate on ───────────────────────────────────────────────────
# The ten formal runs of batch 4 (batch4-runs.json), interleaved off/on. The
# verdict shown is the re-judged one (attempts-2026-09-11) when the re-judge
# copies are present, else the one recorded at run time — and the line says which.
segment_gate_on() {
  local manifest="$GATE_ART/batch4-runs.json"
  if [[ -f "$manifest" ]]; then
    local src="as judged at run time"
    [[ -d "$REJUDGE" ]] && src="re-judged copies under $REJUDGE (attempts-2026-09-11)"
    seg_begin 4 "Gate on — same task, ten formal runs" record "batch4-runs.json; verdicts $src"
    python3 - "$manifest" "$RUNS" "$REJUDGE" <<'PY'
import json, os, sys
m = json.load(open(sys.argv[1], encoding="utf-8")); runs, rej = sys.argv[2], sys.argv[3]
WRONG, RIGHT = "skl-sZFb3KatWY6m", "skl-oBaDO5CceKnr"
tally = {}
for r in m["runs"]:
    d = os.path.join(rej, r["run_id"]) if os.path.isdir(os.path.join(rej, r["run_id"])) else os.path.join(runs, r["run_id"])
    if not os.path.isdir(d):
        print(f"      {r['seq']:>2} {r['arm']:<4} {r['run_id']}  (record missing)"); continue
    verdict = json.load(open(os.path.join(d, "verdict.json"), encoding="utf-8"))["verdict"]
    used = set()
    for line in open(os.path.join(d, "used-events.jsonl"), encoding="utf-8"):
        if line.strip():
            e = json.loads(line)
            if e["state"] == "used": used.add(e["asset_id"])
    seen = ("wrong+right" if WRONG in used and RIGHT in used else "wrong" if WRONG in used else "right" if RIGHT in used else "none")
    t = tally.setdefault(r["arm"], {"n": 0, "PASS": 0, "FAIL": 0, "ERROR": 0, "wrong_used": 0})
    t["n"] += 1; t[verdict if verdict in t else "ERROR"] += 1; t["wrong_used"] += WRONG in used
    print(f"      {r['seq']:>2} {r['arm']:<4} {r['run_id']}  used: {seen:<12} verdict {verdict}")
for arm in ("off", "on"):
    t = tally.get(arm)
    if t: print(f"      gate-{arm}: {t['n']} runs — PASS {t['PASS']}, FAIL {t['FAIL']}, unjudgeable {t['ERROR']}; the rejected asset was used in {t['wrong_used']}/{t['n']}")
PY
    note "PASS is the endpoint request's success, not task completion; unjudgeable runs stay in the denominator"
  else
    seg_begin 4 "Gate on — same task again" fixture "no batch manifest"
  fi
}

# ── 5. Is the judgement itself accurate? ─────────────────────────
segment_selfcheck() {
  local out pass total
  out="$(cd "$REPO_ROOT" && node --test \
      evaluation/gate0/verify-capture.test.mjs \
      evaluation/provenance/build-events.test.mjs \
      evaluation/contracts/validate.test.mjs 2>&1)"
  pass="$(sed -n 's/^# *pass \([0-9]*\)/\1/p;s/^ℹ pass \([0-9]*\)/\1/p' <<<"$out" | tail -1)"
  total="$(sed -n 's/^# *tests \([0-9]*\)/\1/p;s/^ℹ tests \([0-9]*\)/\1/p' <<<"$out" | tail -1)"

  seg_begin 5 "Is the judgement itself accurate?" live
  if [[ -n "${pass:-}" && "$pass" == "${total:-}" ]]; then
    row "regression suite ${C_G}${pass}/${total} passing${C_0}"
  else
    row "regression suite ${C_R}${pass:-?}/${total:-?}${C_0}"
  fi
  note "including one test per false positive the earlier verifier fell for:"
  note "  command echo · an asset discussing the endpoints · the checker matching itself"
  echo
  local cal="$SCRIPT_DIR/attribution/CALIBRATION-batch4-reparsed-2026-09-11.md"
  if [[ -f "$cal" ]]; then
    note "calibration of the judgement against independent adoption evidence (batch 4, re-parsed; $(basename "$cal")):"
    python3 - "$cal" <<'PY'
import re, sys
rows = [l for l in open(sys.argv[1], encoding="utf-8") if l.startswith("| gate-rules") and "batch4 (frozen)" in l]
labels = ["delivery consistency", "usage detection"]
for label, l in zip(labels, rows):
    c = [x.strip() for x in l.strip().strip("|").split("|")]
    print(f"      {label:<22} TP {c[1]}  FP {c[2]}  TN {c[3]}  FN {c[4]}  rated {c[-2]}  accuracy {c[-1]}" if label == "delivery consistency" else f"      {label:<22} TP {c[1]}  FP {c[2]}  TN {c[3]}  FN {c[4]}  adoption unknown {c[5]}  rated {c[6]}  accuracy {c[7]}  coverage {c[8]}")
PY
    note "the FN of delivery consistency is a true negative of usage detection (run 9: read, not dialled); read both tables together"
  else
    row "${C_Y}calibration against independent adoption evidence: not on file${C_0}"
  fi
}

# ── 6. The dev loop ──────────────────────────────────────────────
# A real bug fixed by the model in a frozen working copy, judged by a verifier
# that runs its own reference test; the experience note's delivery, adoption
# and the write-back are read from the loop's manifest and REPORT.md.
segment_devloop() {
  local m="$SCRIPT_DIR/tasks/exit-code-fix/devloop-runs.json"
  if [[ -f "$m" ]]; then
    seg_begin 6 "Does experience flow back — the dev loop" record "tasks/exit-code-fix/devloop-runs.json"
    python3 - "$m" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
runs = d.get("runs") or []
for r in runs:
    kind = "void" if r.get("void") else ("sample" if r.get("sample") else "smoke")
    print(f"      {r['arm']:<8} {kind:<6} {r['run_id']}  consumer {r.get('consumer_agent_id')}  verdict {r.get('verdict')}  memory ok {r.get('memory_channel_ok')}")
    for a in r.get("attempts") or []: print(f"               attempt: {a[:90]}")
obs = d.get("status_observations") or []
if obs: print(f"      note status observed: " + "; ".join(f"{o['at'][11:19]} {o['note_status']} ({o['arm']})" for o in obs[-4:]))
samples = [r for r in runs if r.get("sample")]
print(f"      {len(samples)} sample run(s), {sum(1 for r in runs if r.get('void'))} voided, {sum(1 for r in runs if not r.get('sample') and not r.get('void'))} smoke")
PY
    note "full report: node evaluation/tasks/exit-code-fix/report.mjs → REPORT.md"
  else
    seg_begin 6 "Does experience flow back — the dev loop" fixture "no dev-loop manifest"
  fi
}

# ── main ─────────────────────────────────────────────────────────
echo
echo "${C_B}Trustworthy attribution — end-to-end demo${C_0}"
echo "${C_DIM}$(date -u '+%Y-%m-%dT%H:%M:%SZ')${C_0}"

segment_pool
segment_gate_off
segment_attribution
segment_gate_on
segment_selfcheck
segment_devloop

echo
echo "${C_DIM}────────────────────────────────────────────────────────────${C_0}"
echo "${C_B}Segments:${C_0} ${C_G}${LIVE_COUNT} live${C_0}, ${C_B}${RECORD_COUNT} record${C_0}, ${C_Y}${FIXTURE_COUNT} fixture${C_0}"
if (( FIXTURE_COUNT > 0 )); then
  echo "${C_DIM}A fixture segment reads sample data. It is replaced by a live run as each${C_0}"
  echo "${C_DIM}module lands; the tag is the honest record of which is which.${C_0}"
fi
echo
