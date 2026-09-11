#!/usr/bin/env bash
# The delivery re-run: every acceptance command of the delivery, run again now,
# its output archived, and every script-generated report regenerated and
# compared with the committed copy (CLAUDE.md §1, §9). A SUMMARY.md is
# written from the results — one row per step with the exit status, the
# expectation, and the diff size; nothing in it is typed by hand.
#
# Usage: bash evaluation/deliver-check.sh [--out evaluation/delivery/<stamp>]
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
OUT="$SCRIPT_DIR/delivery/$STAMP"
while [[ $# -gt 0 ]]; do case "$1" in --out) OUT="$2"; shift 2;; *) echo "unknown: $1" >&2; exit 2;; esac; done
mkdir -p "$OUT"
REJUDGE="${REJUDGE_DIR:-/private/tmp/topic4-rejudge/2026-09-11}"
ROWS="$OUT/rows.jsonl"; : > "$ROWS"
cd "$REPO_ROOT"

row() {  # step command exit expected note [diff_lines]
  python3 - "$ROWS" "$@" <<'PY'
import json, sys
p, step, cmd, exit_, expected, note = sys.argv[1:7]
diff = sys.argv[7] if len(sys.argv) > 7 else ""
open(p, "a").write(json.dumps({"step": step, "command": cmd, "exit": int(exit_), "expected": expected, "note": note, "diff_lines": (int(diff) if diff != "" else None)}, ensure_ascii=False) + "\n")
PY
}
# diff two generated markdown files ignoring generation timestamps; prints the line count
mddiff() { diff <(grep -v -E '^生成于|^Generated|generated_at|^\s*$' "$1") <(grep -v -E '^生成于|^Generated|generated_at|^\s*$' "$2") > "$3" 2>&1; wc -l < "$3" | tr -d ' '; }

echo "[1] the whole suite"
node --test $(find evaluation -name '*.test.mjs' -not -path '*/node_modules/*' | sort) > "$OUT/suite.txt" 2>&1; e=$?
row "suite" "node --test evaluation/**/*.test.mjs" "$e" "exit 0, fail 0" "$(grep -E '^ℹ (tests|pass|fail)' "$OUT/suite.txt" | tr '\n' ' ')"

echo "[2] dev-loop verifier self-check"
bash evaluation/tasks/exit-code-fix/selfcheck.sh > "$OUT/selfcheck.txt" 2>&1; e=$?
# After the loop the note's value sits in REPORT.md and devloop-runs.json (burned), so segment 4
# ("来源唯一") must fail; segments 0-2 must still read 0/1/0. Rotate the value before any reuse.
SEG="$(tail -1 "$OUT/selfcheck.txt")"; S4="$(grep -oE '已出现于 \[[a-z]+\] [^ ]+' "$OUT/selfcheck.txt" | tr '\n' ' ')"
row "selfcheck" "bash evaluation/tasks/exit-code-fix/selfcheck.sh" "$e" "seg0=0 seg1=1 seg2=0; seg4=1 after the loop (value in the records, burned; rotate before reuse)" "$SEG $S4"

echo "[2b] second dev-loop task's verifier self-check (exit-line-collect; same verifier, its own task dir)"
bash evaluation/tasks/exit-line-collect/selfcheck.sh > "$OUT/selfcheck-exit-line-collect.txt" 2>&1; e=$?
SEG="$(tail -1 "$OUT/selfcheck-exit-line-collect.txt")"; S4="$(grep -oE '已出现于 \[[a-z]+\] [^ ]+' "$OUT/selfcheck-exit-line-collect.txt" | tr '\n' ' ')"
row "selfcheck-exit-line-collect" "bash evaluation/tasks/exit-line-collect/selfcheck.sh" "$e" "seg0=0 seg1=1 seg2=0; seg4=1 after the loop (the note's v2 value is in the records, burned; rotate before reuse)" "$SEG $S4"

echo "[3] batch-4 calibration reproduced from the re-judge copies"
if compgen -G "$REJUDGE/20260910T23*" > /dev/null; then
  node evaluation/attribution/calibrate-runs.mjs --frozen=gate-rules-2026-09-08f --task=evaluation/tasks/bridge-addr --manifest=evaluation/gate/artifacts/batch4-runs.json --md="$OUT/CALIBRATION-reproduced.md" "$REJUDGE"/20260910T23*/ > "$OUT/calibrate.txt" 2>&1; e=$?
  d="$(mddiff evaluation/attribution/CALIBRATION-batch4-reparsed-2026-09-11.md "$OUT/CALIBRATION-reproduced.md" "$OUT/CALIBRATION.diff")"
  row "calibration" "calibrate-runs.mjs --manifest=batch4-runs.json <re-judge copies>" "$e" "exit 0, diff 0 vs CALIBRATION-batch4-reparsed-2026-09-11.md" "" "$d"
else
  row "calibration" "calibrate-runs.mjs …" 3 "re-judge copies present" "copies absent at $REJUDGE: regenerate with rejudge-runs.mjs (COMPARISON-2026-09-11-reparsed.md 开头的命令)"
fi

echo "[4] batch-4 summary reproduced"
if compgen -G "$REJUDGE/20260910T23*" > /dev/null; then
  # summarize-runs reads ONE root directory: a root holding links to the ten formal copies only
  rm -rf "$OUT/summary-root"; mkdir -p "$OUT/summary-root"
  for id in $(python3 -c "import json;print(' '.join(r['run_id'] for r in json.load(open('evaluation/gate/artifacts/batch4-runs.json'))['runs']))"); do ln -s "$REJUDGE/$id" "$OUT/summary-root/$id"; done
  node evaluation/runner/summarize-runs.mjs "$OUT/summary-root" --baseline=evaluation/gate/artifacts/gate_baseline_batch4.json > "$OUT/summary-reproduced.md" 2>"$OUT/summarize.err"; e=$?
  d="$(mddiff evaluation/runner/summary-2026-09-11-reparsed.md "$OUT/summary-reproduced.md" "$OUT/summary.diff")"
  row "summary" "summarize-runs.mjs <10 formal copies> --baseline=gate_baseline_batch4.json" "$e" "exit 0, diff 0 vs summary-2026-09-11-reparsed.md" "" "$d"
  rm -rf "$OUT/summary-root"   # links into /private/tmp do not belong in the archive
fi

echo "[5] re-judge diff reproduced"
if compgen -G "$REJUDGE/20260910T23*" > /dev/null; then
  node evaluation/attribution/rejudge-diff.mjs --before=evaluation/runner/runs --after="$REJUDGE" --manifest=evaluation/gate/artifacts/batch4-runs.json --extra=20260910T231329Z-b4-prep,20260910T231900Z-b4-prep,20260910T232209Z-trial-gate-off,20260910T232305Z-trial-gate-on > "$OUT/REPARSE-DIFF-reproduced.md" 2>"$OUT/rejudge-diff.err"; e=$?
  d="$(mddiff evaluation/attribution/REPARSE-DIFF-2026-09-11.md "$OUT/REPARSE-DIFF-reproduced.md" "$OUT/REPARSE-DIFF.diff")"
  row "rejudge-diff" "rejudge-diff.mjs --before=runs --after=<copies> --manifest=batch4-runs.json" "$e" "exit 0, diff small (header only) vs REPARSE-DIFF-2026-09-11.md" "" "$d"
fi

echo "[5b] exit-line re-parse reproduced (the second task's fix on the main branch, measured on the 14 batch-4 captures)"
OLDCA="evaluation/attribution/collect-artifacts.old-77959dc.tmp.mjs"; git show 77959dc:evaluation/attribution/collect-artifacts.mjs > "$OLDCA"
node evaluation/attribution/reparse-exit-status.mjs --old="$OLDCA" --old-label=77959dc --md="$OUT/REPARSE-exitline-collect-reproduced.md" evaluation/runner/runs/20260910T23*/ > /dev/null 2>"$OUT/reparse-exitline.err"; e=$?; rm -f "$OLDCA"
d="$(mddiff evaluation/attribution/REPARSE-DIFF-2026-09-11-exitline-collect.md "$OUT/REPARSE-exitline-collect-reproduced.md" "$OUT/REPARSE-exitline-collect.diff")"
row "reparse-exitline" "reparse-exit-status.mjs --old=<77959dc copy> <14 batch-4 runs>" "$e" "exit 0, diff 0 vs REPARSE-DIFF-2026-09-11-exitline-collect.md" "" "$d"

echo "[6] dev-loop report reproduced"
node evaluation/tasks/exit-code-fix/report.mjs --out="$OUT/REPORT-reproduced.md" > "$OUT/report.txt" 2>&1; e=$?
d="$(mddiff evaluation/tasks/exit-code-fix/REPORT.md "$OUT/REPORT-reproduced.md" "$OUT/REPORT.diff")"
row "devloop-report" "node evaluation/tasks/exit-code-fix/report.mjs" "$e" "exit 0, diff 0 vs REPORT.md" "" "$d"

echo "[6b] second task's report reproduced"
node evaluation/tasks/exit-line-collect/report.mjs --out="$OUT/REPORT-exit-line-collect-reproduced.md" > "$OUT/report-exit-line-collect.txt" 2>&1; e=$?
d="$(mddiff evaluation/tasks/exit-line-collect/REPORT.md "$OUT/REPORT-exit-line-collect-reproduced.md" "$OUT/REPORT-exit-line-collect.diff")"
row "devloop-report-2" "node evaluation/tasks/exit-line-collect/report.mjs" "$e" "exit 0, diff 0 vs exit-line-collect/REPORT.md" "" "$d"

echo "[7] demo"
bash evaluation/demo.sh --plain > "$OUT/demo.txt" 2>&1; e=$?
row "demo" "bash evaluation/demo.sh --plain" "$e" "exit 0; segments live/record/fixture counted" "$(grep -E '^Segments:' "$OUT/demo.txt")"

echo "[8] batch-4 conditions check (post-batch: known FAIL items are the design working)"
node evaluation/runner/batch-conditions.mjs --check --conditions=evaluation/gate/artifacts/batch4-conditions.json > "$OUT/conditions-check.txt" 2>&1; e=$?
row "conditions-check" "batch-conditions.mjs --check --conditions=batch4-conditions.json" "$e" "post-batch: exit 1 with the FAIL items listed in STATE.md (trace burned, atomic footprint, run-once.sh changed; since 2026-09-12 also the runtime rows: core image digest, gate source mount→image)" "$(grep -c -E 'PASS' "$OUT/conditions-check.txt") PASS / $(grep -c -E 'FAIL' "$OUT/conditions-check.txt") FAIL lines"

echo "[9] live state"
{ bash evaluation/runner/core-extraction.sh status; bash evaluation/runner/prepare.sh --status 2>&1 | head -6; node evaluation/tasks/exit-code-fix/gate-observe.mjs --label="delivery re-run $STAMP" --out="$OUT/gate-observation.jsonl"; } > "$OUT/live-state.txt" 2>&1; e=$?
row "live-state" "core-extraction.sh status; prepare.sh --status; gate-observe.mjs" "$e" "recorded, not judged" "$(head -1 "$OUT/live-state.txt")"

python3 - "$ROWS" "$OUT/SUMMARY.md" "$STAMP" "$(git rev-parse HEAD)" <<'PY'
import json, sys
rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
L = [f"# 交付复跑 {sys.argv[3]}(HEAD {sys.argv[4][:7]};脚本生成)", "", "| 步骤 | 命令 | 退出码 | 期望 | 实际 / 差异行数 |", "|---|---|---|---|---|"]
for r in rows:
    actual = r["note"] or ""
    if r.get("diff_lines") is not None: actual = (actual + " " if actual else "") + f"diff {r['diff_lines']} 行"
    actual = actual.replace("|", "\\|")
    L.append(f"| {r['step']} | `{r['command']}` | {r['exit']} | {r['expected']} | {actual} |")
def selfcheck_ok(r):
    n = r["note"] or ""
    return "seg0=0 seg1=1 seg2=0" in n and ("seg4=0" in n or "task:REPORT.md" in n or "devloop-runs.json" in n)
bad = [r for r in rows if (r["step"] in ("suite", "devloop-report", "devloop-report-2", "demo", "reparse-exitline") and r["exit"] != 0) or (r["step"].startswith("selfcheck") and not selfcheck_ok(r))]
repro = [r for r in rows if r.get("diff_lines") not in (None, 0) and r["step"] in ("calibration", "summary", "devloop-report", "devloop-report-2", "reparse-exitline")]
bad_s = ", ".join(r["step"] for r in bad) or "无"
repro_s = ", ".join(f"{r['step']} {r['diff_lines']} 行" for r in repro) or "无"
L += ["", f"判决类步骤退出非 0:{len(bad)}({bad_s});生成报告与提交副本有差异的:{len(repro)}({repro_s})。", ""]
open(sys.argv[2], "w", encoding="utf-8").write("\n".join(L) + "\n")
print("\n".join(L))
PY
echo "archived → $OUT"
