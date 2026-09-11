# 交付复跑 2026-09-11T170753Z(HEAD 3077962;脚本生成)

| 步骤 | 命令 | 退出码 | 期望 | 实际 / 差异行数 |
|---|---|---|---|---|
| suite | `node --test evaluation/**/*.test.mjs` | 0 | exit 0, fail 0 | ℹ tests 580 ℹ pass 580 ℹ fail 0  |
| selfcheck | `bash evaluation/tasks/exit-code-fix/selfcheck.sh` | 1 | seg0=0 seg1=1 seg2=0; seg4=1 after the loop (value in the records, burned; rotate before reuse) | 结论:验证器未全过(seg0=0 seg1=1 seg2=0 seg4=1) 已出现于 [task] task:REPORT.md 已出现于 [record] task:devloop-runs.json  |
| calibration | `calibrate-runs.mjs --manifest=batch4-runs.json <re-judge copies>` | 0 | exit 0, diff 0 vs CALIBRATION-batch4-reparsed-2026-09-11.md | diff 0 行 |
| summary | `summarize-runs.mjs <10 formal copies> --baseline=gate_baseline_batch4.json` | 0 | exit 0, diff 0 vs summary-2026-09-11-reparsed.md | diff 0 行 |
| rejudge-diff | `rejudge-diff.mjs --before=runs --after=<copies> --manifest=batch4-runs.json` | 0 | exit 0, diff small (header only) vs REPARSE-DIFF-2026-09-11.md | diff 0 行 |
| devloop-report | `node evaluation/tasks/exit-code-fix/report.mjs` | 0 | exit 0, diff 0 vs REPORT.md | diff 0 行 |
| demo | `bash evaluation/demo.sh --plain` | 0 | exit 0; segments live/record/fixture counted | Segments: 2 live, 4 record, 0 fixture |
| conditions-check | `batch-conditions.mjs --check --conditions=batch4-conditions.json` | 1 | post-batch: exit 1 with the FAIL items listed in STATE.md (trace burned, atomic footprint, run-once.sh changed) | 47 PASS / 15 FAIL lines |
| live-state | `core-extraction.sh status; prepare.sh --status; gate-observe.mjs` | 0 | recorded, not judged | skill.extraction.enabled: file=false container=enabled:false |

判决类步骤退出非 0:0(无);生成报告与提交副本有差异的:0(无)。

