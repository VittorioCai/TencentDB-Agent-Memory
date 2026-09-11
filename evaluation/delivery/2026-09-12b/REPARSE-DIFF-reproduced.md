# Re-judge diff — 2026-09-11 
Before: `evaluation/runner/runs` (records as written at run time). After: `/private/tmp/topic4-rejudge/2026-09-11` (copies re-judged by rejudge-runs.mjs; acceptance attempts-2026-09-11). Formal sample: the 10 run ids in `evaluation/gate/artifacts/batch4-runs.json`. 
### Formal sample (the manifest)

| run | verdict before → after | attempts before | attempts after | outcomes before | outcomes after | changed |
|---|---|---|---|---|---|---|
| 20260910T232424Z-gate-off | PASS → ERROR | 10.244.7.19:8096=timed out; 127.0.0.1:47318=ok | 10.244.7.19:8096=timed out; 127.0.0.1:47318=ok | CceKnr:validated atWY6m:corrected | CceKnr:needs_review atWY6m:corrected | **yes** |
| 20260910T232507Z-gate-on | PASS → PASS | 127.0.0.1:47318=ok | 127.0.0.1:47318=ok | CceKnr:validated | CceKnr:validated | no |
| 20260910T232522Z-gate-off | PASS → ERROR | 10.244.7.19:8096=timed out; 127.0.0.1:47318=ok | 10.244.7.19:8096=timed out; 127.0.0.1:47318=ok | CceKnr:validated atWY6m:corrected | CceKnr:needs_review atWY6m:corrected | **yes** |
| 20260910T232611Z-gate-on | PASS → PASS | 127.0.0.1:47318=ok | 127.0.0.1:47318=ok | CceKnr:validated | CceKnr:validated | no |
| 20260910T232627Z-gate-off | FAIL → ERROR | 127.0.0.1:8096=?; 127.0.0.1:47318=timed out | 127.0.0.1:47318=?; 10.244.7.19:8096=? (+1 unidentified) | CceKnr:needs_review atWY6m:needs_review | CceKnr:needs_review atWY6m:needs_review | **yes** |
| 20260910T232715Z-gate-on | PASS → PASS | 127.0.0.1:47318=ok | 127.0.0.1:47318=ok | CceKnr:validated | CceKnr:validated | no |
| 20260910T232730Z-gate-off | PASS → ERROR | 10.244.7.19:8096=?; 127.0.0.1:47318=ok | 10.244.7.19:8096=?; 127.0.0.1:47318=ok | CceKnr:validated atWY6m:needs_review | CceKnr:needs_review atWY6m:needs_review | **yes** |
| 20260910T232818Z-gate-on | PASS → PASS | 127.0.0.1:47318=ok | 127.0.0.1:47318=ok | CceKnr:validated | CceKnr:validated | no |
| 20260910T232835Z-gate-off | PASS → PASS | 127.0.0.1:47318=ok | 127.0.0.1:47318=ok (+1 unidentified) | CceKnr:validated | CceKnr:validated | no |
| 20260910T232924Z-gate-on | PASS → PASS | 127.0.0.1:47318=ok | 127.0.0.1:47318=ok | CceKnr:validated | CceKnr:validated | no |

10 runs, 4 changed. Verdicts before: FAIL 1, PASS 9; after: ERROR 4, PASS 6.

### Not samples: preparation and trial runs

| run | verdict before → after | attempts before | attempts after | outcomes before | outcomes after | changed |
|---|---|---|---|---|---|---|
| 20260910T231329Z-b4-prep | PASS → ERROR | 10.244.7.19:8096=could not connect; 127.0.0.1:47318=ok | 10.244.7.19:8096=could not connect; 127.0.0.1:47318=ok | CceKnr:needs_review+needs_review+validated atWY6m:needs_review+corrected | CceKnr:needs_review+needs_review+needs_review atWY6m:needs_review+corrected | **yes** |
| 20260910T231900Z-b4-prep | PASS → ERROR | 127.0.0.1:8096=ok; 10.244.7.19:8096=could not connect; 127.0.0.1:47318=ok | 10.244.7.19:8096=could not connect; 127.0.0.1:47318=ok | CceKnr:validated atWY6m:corrected | CceKnr:needs_review atWY6m:corrected | **yes** |
| 20260910T232209Z-trial-gate-off | PASS → ERROR | 10.244.7.19:8096=timed out; 127.0.0.1:47318=ok | 10.244.7.19:8096=timed out; 127.0.0.1:47318=ok | CceKnr:validated atWY6m:corrected | CceKnr:needs_review atWY6m:corrected | **yes** |
| 20260910T232305Z-trial-gate-on | PASS → PASS | 127.0.0.1:47318=ok | 127.0.0.1:47318=ok | CceKnr:validated | CceKnr:validated | no |

4 runs, 3 changed. Verdicts before: PASS 4; after: ERROR 3, PASS 1.

