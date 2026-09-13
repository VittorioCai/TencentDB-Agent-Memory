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

echo "[2c] re-judge copies: regenerate when absent (a clean clone has none; same command as the report head, runs/ untouched)"
if ! compgen -G "$REJUDGE/20260910T23*" > /dev/null; then
  mkdir -p "$REJUDGE"
  node evaluation/attribution/rejudge-runs.mjs --out="$REJUDGE" --task=evaluation/tasks/bridge-addr evaluation/runner/runs/20260910T23*/ > "$OUT/rejudge-regenerate.txt" 2>&1; e=$?
  row "rejudge-regenerate" "rejudge-runs.mjs --out=$REJUDGE --task=evaluation/tasks/bridge-addr runs/20260910T23*/" "$e" "exit 0; 14 copies written (only when they were absent)" "$(ls -d "$REJUDGE"/20260910T23* 2>/dev/null | wc -l | tr -d ' ') copies"
else
  row "rejudge-regenerate" "(skipped: copies already at $REJUDGE)" 0 "copies present" "$(ls -d "$REJUDGE"/20260910T23* | wc -l | tr -d ' ') copies"
fi

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
  row "rejudge-diff" "rejudge-diff.mjs --before=runs --after=<copies> --manifest=batch4-runs.json" "$e" "exit 0, diff 0 vs REPARSE-DIFF-2026-09-11.md (the title date now comes from the re-judge copy, not the clock)" "" "$d"
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

echo "[6c] third task's report reproduced (a different kind of work, judged by behaviour)"
node evaluation/tasks/resource-download/report.mjs --out="$OUT/REPORT-resource-download-reproduced.md" > "$OUT/report-resource-download.txt" 2>&1; e=$?
d="$(mddiff evaluation/tasks/resource-download/REPORT.md "$OUT/REPORT-resource-download-reproduced.md" "$OUT/REPORT-resource-download.diff")"
row "devloop-report-3" "node evaluation/tasks/resource-download/report.mjs" "$e" "exit 0, diff 0 vs resource-download/REPORT.md" "$(grep -oE '计入样本 [0-9]+ 次' "$OUT/report-resource-download.txt" | head -1)" "$d"

echo "[6d] third task's samples re-scanned for contamination (any run not explicitly clean blocks)"
node evaluation/runner/contamination.mjs --batch=evaluation/tasks/resource-download/devloop-runs.json --task=evaluation/tasks/resource-download > "$OUT/contamination-resource-download.txt" 2>&1; e=$?
row "contamination-3" "contamination.mjs --batch=resource-download/devloop-runs.json" "$e" "exit 0;每一次计入样本的运行都明确判为干净(污染或未知同样阻断)" "$(tail -1 "$OUT/contamination-resource-download.txt")"

echo "[7] demo"
bash evaluation/demo.sh --plain > "$OUT/demo.txt" 2>&1; e=$?
row "demo" "bash evaluation/demo.sh --plain" "$e" "exit 0; segments live/record/fixture counted" "$(grep -E '^Segments:' "$OUT/demo.txt")"

echo "[7b] closed-loop walkthrough: the main chain and the two counterexamples"
{ for c in main delivered_not_adopted adopted_but_flagged; do
    echo "══════ $c ══════"; node evaluation/receipt/chain-cli.mjs --case="$c" --expand; echo;
  done; } > "$OUT/chain.txt" 2>&1; e=$?
row "chain" "receipt/chain-cli.mjs --case=main|delivered_not_adopted|adopted_but_flagged --expand" "$e" "exit 0;三条链都渲染出来,未证明的环节按原样保留" "$(grep -c '^[1-7]\. ' "$OUT/chain.txt") 个环节,其中未证明 $(grep -c '未证明' "$OUT/chain.txt") 个"

echo "[7c] relevance selection: pool → admission → task relevance → context"
node evaluation/attribution/selection-cli.mjs > "$OUT/selection.txt" 2>&1; e=$?
row "selection" "attribution/selection-cli.mjs" "$e" "exit 0;两层过滤分开报(准入与任务相关性)" "$(grep -oE '池中 [0-9]+ 项' "$OUT/selection.txt" | head -1);$(grep -oE '放行 [0-9]+ 项;挡下 [0-9]+ 项' "$OUT/selection.txt" | head -1)"

echo "[8] batch-4 conditions check (every allowed FAIL is registered with its class and reason)"
node evaluation/runner/batch-conditions.mjs --check --conditions=evaluation/gate/artifacts/batch4-conditions.json > "$OUT/conditions-check.txt" 2>&1; e=$?
cls="$(node evaluation/runner/conditions-classify.mjs "$OUT/conditions-check.txt" 2>&1)"; ce=$?
echo "$cls" > "$OUT/conditions-classified.txt"
row "conditions-check" "batch-conditions.mjs --check; conditions-classify.mjs" "$e" "exit 1 是常态;**每一项 FAIL 必须在 conditions-expected.json 里登记性质与原因**,未登记即阻断。三类:批次后的正常变化 / 已载明的实验限制 / 证据缺口(后者属于缺点,不属于按设计)" "$(grep -c -E 'PASS' "$OUT/conditions-check.txt") PASS / $(grep -c -E 'FAIL' "$OUT/conditions-check.txt") FAIL;$cls"

echo "[9] live state"
{ bash evaluation/runner/core-extraction.sh status; bash evaluation/runner/prepare.sh --status 2>&1 | head -6; node evaluation/tasks/exit-code-fix/gate-observe.mjs --label="delivery re-run $STAMP" --out="$OUT/gate-observation.jsonl"; } > "$OUT/live-state.txt" 2>&1; e=$?
row "live-state" "core-extraction.sh status; prepare.sh --status; gate-observe.mjs" "$e" "recorded, not judged" "$(head -1 "$OUT/live-state.txt")"

node evaluation/deliver-verdict.mjs "$ROWS" "$OUT/SUMMARY.md" "$STAMP" "$(git rev-parse HEAD)"; verdict=$?

echo "archived → $OUT"
[ "$verdict" -eq 0 ] || echo "交付复跑判为失败 —— 见上面的逐条说明与 $OUT/SUMMARY.md" >&2
exit "$verdict"
