# Re-parse of exit status — collect-artifacts.mjs exit-line fix on the main branch

Generated 2026-09-12T17:36:40Z: `node evaluation/attribution/reparse-exit-status.mjs --old=77959dc <14 run dir(s)>`. Old reader: `outcomeOf` as it was before the fix (77959dc); new reader: the current `evaluation/attribution/collect-artifacts.mjs`. Tool results are taken once per tool call from each capture's last request.

| run | tool results | with an exit line | spelled `Exit Code:` | exit_code null before | null after | readings changed |
|---|---|---|---|---|---|---|
| 20260910T231329Z-b4-prep | 17 | 17 | 17 | 17 | 0 | 17 |
| 20260910T231900Z-b4-prep | 11 | 11 | 11 | 11 | 0 | 11 |
| 20260910T232209Z-trial-gate-off | 5 | 5 | 5 | 5 | 0 | 5 |
| 20260910T232305Z-trial-gate-on | 3 | 3 | 3 | 3 | 0 | 3 |
| 20260910T232424Z-gate-off | 5 | 5 | 5 | 5 | 0 | 5 |
| 20260910T232507Z-gate-on | 3 | 3 | 3 | 3 | 0 | 3 |
| 20260910T232522Z-gate-off | 7 | 7 | 7 | 7 | 0 | 7 |
| 20260910T232611Z-gate-on | 3 | 3 | 3 | 3 | 0 | 3 |
| 20260910T232627Z-gate-off | 7 | 7 | 7 | 7 | 0 | 7 |
| 20260910T232715Z-gate-on | 3 | 3 | 3 | 3 | 0 | 3 |
| 20260910T232730Z-gate-off | 9 | 9 | 9 | 9 | 0 | 9 |
| 20260910T232818Z-gate-on | 4 | 4 | 4 | 4 | 0 | 4 |
| 20260910T232835Z-gate-off | 15 | 15 | 15 | 15 | 0 | 15 |
| 20260910T232924Z-gate-on | 3 | 3 | 3 | 3 | 0 | 3 |
| **total** | 95 | 95 | 95 | 95 | 0 | 95 |

Across 14 run(s): 95 tool result(s) carry an exit line, 95 of them spelled `Exit Code:`; the old reader returned null for 95 of them, the new one for 0; 95 reading(s) changed.

What cannot have moved: `judge-hard.mjs` decides used events from `op.text` (the whole result) and never reads `exit_code` or `stderr` (see its token checks); so the used events, outcomes and verdicts of these runs are unaffected by this fix, and no re-judge of them is claimed here. What did move is the operations list each run's record would now carry: an exit status per shell result instead of null.
