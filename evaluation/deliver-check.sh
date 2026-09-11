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
row "selfcheck" "bash evaluation/tasks/exit-code-fix/selfcheck.sh" "$e" "exit 0, 结论:验证器四段全过" "$(tail -1 "$OUT/selfcheck.txt")"

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
  DIRS="$(python3 -c "import json;print(' '.join('$REJUDGE/'+r['run_id'] for r in json.load(open('evaluation/gate/artifacts/batch4-runs.json'))['runs']))")"
  node evaluation/runner/summarize-runs.mjs $DIRS --baseline=evaluation/gate/artifacts/gate_baseline_batch4.json > "$OUT/summary-reproduced.md" 2>"$OUT/summarize.err"; e=$?
  d="$(mddiff evaluation/runner/summary-2026-09-11-reparsed.md "$OUT/summary-reproduced.md" "$OUT/summary.diff")"
  row "summary" "summarize-runs.mjs <10 formal copies> --baseline=gate_baseline_batch4.json" "$e" "exit 0, diff 0 vs summary-2026-09-11-reparsed.md" "" "$d"
fi

echo "[5] re-judge diff reproduced"
if compgen -G "$REJUDGE/20260910T23*" > /dev/null; then
  node evaluation/attribution/rejudge-diff.mjs --before=evaluation/runner/runs --after="$REJUDGE" --manifest=evaluation/gate/artifacts/batch4-runs.json --extra=20260910T231329Z-b4-prep,20260910T231900Z-b4-prep,20260910T232209Z-trial-gate-off,20260910T232305Z-trial-gate-on > "$OUT/REPARSE-DIFF-reproduced.md" 2>"$OUT/rejudge-diff.err"; e=$?
  d="$(mddiff evaluation/attribution/REPARSE-DIFF-2026-09-11.md "$OUT/REPARSE-DIFF-reproduced.md" "$OUT/REPARSE-DIFF.diff")"
  row "rejudge-diff" "rejudge-diff.mjs --before=runs --after=<copies> --manifest=batch4-runs.json" "$e" "exit 0, diff small (header only) vs REPARSE-DIFF-2026-09-11.md" "" "$d"
fi

echo "[6] dev-loop report reproduced"
node evaluation/tasks/exit-code-fix/report.mjs --out="$OUT/REPORT-reproduced.md" > "$OUT/report.txt" 2>&1; e=$?
d="$(mddiff evaluation/tasks/exit-code-fix/REPORT.md "$OUT/REPORT-reproduced.md" "$OUT/REPORT.diff")"
row "devloop-report" "node evaluation/tasks/exit-code-fix/report.mjs" "$e" "exit 0, diff 0 vs REPORT.md" "" "$d"

echo "[7] demo"
bash evaluation/demo.sh --plain > "$OUT/demo.txt" 2>&1; e=$?
row "demo" "bash evaluation/demo.sh --plain" "$e" "exit 0; segments live/record/fixture counted" "$(grep -E '^Segments:' "$OUT/demo.txt")"

echo "[8] batch-4 conditions check (post-batch: known FAIL items are the design working)"
node evaluation/runner/batch-conditions.mjs --check --conditions=evaluation/gate/artifacts/batch4-conditions.json > "$OUT/conditions-check.txt" 2>&1; e=$?
row "conditions-check" "batch-conditions.mjs --check --conditions=batch4-conditions.json" "$e" "post-batch: exit 1 with the FAIL items listed in STATE.md (trace burned, atomic footprint, run-once.sh changed)" "$(grep -c -E 'PASS' "$OUT/conditions-check.txt") PASS / $(grep -c -E 'FAIL' "$OUT/conditions-check.txt") FAIL lines"

echo "[9] live state"
{ bash evaluation/runner/core-extraction.sh status; bash evaluation/runner/prepare.sh --status 2>&1 | head -6; node evaluation/tasks/exit-code-fix/gate-observe.mjs --label="delivery re-run $STAMP"; } > "$OUT/live-state.txt" 2>&1; e=$?
row "live-state" "core-extraction.sh status; prepare.sh --status; gate-observe.mjs" "$e" "recorded, not judged" "$(head -1 "$OUT/live-state.txt")"

python3 - "$ROWS" "$OUT/SUMMARY.md" "$STAMP" "$(git rev-parse HEAD)" <<'PY'
import json, sys
rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
L = [f"# 交付复跑 {sys.argv[3]}(HEAD {sys.argv[4][:7]};脚本生成)", "", "| 步骤 | 命令 | 退出码 | 期望 | 实际 / 差异行数 |", "|---|---|---|---|---|"]
for r in rows:
    actual = r["note"] or ""
    if r.get("diff_lines") is not None: actual = (actual + " " if actual else "") + f"diff {r['diff_lines']} 行"
    L.append(f"| {r['step']} | `{r['command']}` | {r['exit']} | {r['expected']} | {actual.replace('|', '\\\\|')} |")
bad = [r for r in rows if r["step"] in ("suite", "selfcheck", "devloop-report", "demo") and r["exit"] != 0]
repro = [r for r in rows if r.get("diff_lines") not in (None, 0) and r["step"] in ("calibration", "summary", "devloop-report")]
L += ["", f"判决类步骤退出非 0:{len(bad)}({', '.join(r['step'] for r in bad) or '无'});生成报告与提交副本有差异的:{len(repro)}({', '.join(f\"{r['step']} {r['diff_lines']} 行\" for r in repro) or '无'})。", ""]
open(sys.argv[2], "w", encoding="utf-8").write("\n".join(L) + "\n")
print("\n".join(L))
PY
echo "archived → $OUT"
