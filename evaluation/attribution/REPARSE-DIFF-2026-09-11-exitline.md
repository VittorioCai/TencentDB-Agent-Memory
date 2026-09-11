# Re-judge diff — 2026-09-11, after the exit-line fix reached the main branch (fb4edfa)

Generated: `node evaluation/attribution/rejudge-diff.mjs --before=/private/tmp/topic4-rejudge/2026-09-11 --after=/private/tmp/topic4-rejudge/2026-09-11b --manifest=evaluation/gate/artifacts/batch4-runs.json --extra=…`. The after-copies were judged by `evaluation/tasks/bridge-addr/verify.mjs` with the dev loop's accepted fix (exit line read under either spelling; code hashes in each copy's REJUDGED.json). Formal sample and evidence/checkpoint runs listed apart. Result: no verdict, attempt or outcome changed, so the reports generated from the 2026-09-11 copies stand as they are.

Before: `/private/tmp/topic4-rejudge/2026-09-11` (records as written at run time). After: `/private/tmp/topic4-rejudge/2026-09-11b` (copies re-judged by rejudge-runs.mjs; acceptance attempts-2026-09-11). Formal sample: the 10 run ids in `evaluation/gate/artifacts/batch4-runs.json`. 
### Formal sample (the manifest)

| run | verdict before → after | attempts before | attempts after | outcomes before | outcomes after | changed |
|---|---|---|---|---|---|---|
| 20260910T232424Z-gate-off | ERROR → ERROR | 10.244.7.19:8096=timed out; 127.0.0.1:47318=ok | 10.244.7.19:8096=timed out; 127.0.0.1:47318=ok | CceKnr:needs_review atWY6m:corrected | CceKnr:needs_review atWY6m:corrected | no |
| 20260910T232507Z-gate-on | PASS → PASS | 127.0.0.1:47318=ok | 127.0.0.1:47318=ok | CceKnr:validated | CceKnr:validated | no |
| 20260910T232522Z-gate-off | ERROR → ERROR | 10.244.7.19:8096=timed out; 127.0.0.1:47318=ok | 10.244.7.19:8096=timed out; 127.0.0.1:47318=ok | CceKnr:needs_review atWY6m:corrected | CceKnr:needs_review atWY6m:corrected | no |
| 20260910T232611Z-gate-on | PASS → PASS | 127.0.0.1:47318=ok | 127.0.0.1:47318=ok | CceKnr:validated | CceKnr:validated | no |
| 20260910T232627Z-gate-off | ERROR → ERROR | 127.0.0.1:47318=?; 10.244.7.19:8096=? | 127.0.0.1:47318=?; 10.244.7.19:8096=? (+1 unidentified) | CceKnr:needs_review atWY6m:needs_review | CceKnr:needs_review atWY6m:needs_review | no |
| 20260910T232715Z-gate-on | PASS → PASS | 127.0.0.1:47318=ok | 127.0.0.1:47318=ok | CceKnr:validated | CceKnr:validated | no |
| 20260910T232730Z-gate-off | ERROR → ERROR | 10.244.7.19:8096=?; 127.0.0.1:47318=ok | 10.244.7.19:8096=?; 127.0.0.1:47318=ok | CceKnr:needs_review atWY6m:needs_review | CceKnr:needs_review atWY6m:needs_review | no |
| 20260910T232818Z-gate-on | PASS → PASS | 127.0.0.1:47318=ok | 127.0.0.1:47318=ok | CceKnr:validated | CceKnr:validated | no |
| 20260910T232835Z-gate-off | PASS → PASS | 127.0.0.1:47318=ok | 127.0.0.1:47318=ok (+1 unidentified) | CceKnr:validated | CceKnr:validated | no |
| 20260910T232924Z-gate-on | PASS → PASS | 127.0.0.1:47318=ok | 127.0.0.1:47318=ok | CceKnr:validated | CceKnr:validated | no |

10 runs, 0 changed. Verdicts before: ERROR 4, PASS 6; after: ERROR 4, PASS 6.

### Not samples: preparation and trial runs

| run | verdict before → after | attempts before | attempts after | outcomes before | outcomes after | changed |
|---|---|---|---|---|---|---|
| 20260910T231329Z-b4-prep | ERROR → ERROR | 10.244.7.19:8096=could not connect; 127.0.0.1:47318=ok | 10.244.7.19:8096=could not connect; 127.0.0.1:47318=ok | CceKnr:needs_review+needs_review+needs_review atWY6m:needs_review+corrected | CceKnr:needs_review+needs_review+needs_review atWY6m:needs_review+corrected | no |
| 20260910T231900Z-b4-prep | ERROR → ERROR | 10.244.7.19:8096=could not connect; 127.0.0.1:47318=ok | 10.244.7.19:8096=could not connect; 127.0.0.1:47318=ok | CceKnr:needs_review atWY6m:corrected | CceKnr:needs_review atWY6m:corrected | no |
| 20260910T232209Z-trial-gate-off | ERROR → ERROR | 10.244.7.19:8096=timed out; 127.0.0.1:47318=ok | 10.244.7.19:8096=timed out; 127.0.0.1:47318=ok | CceKnr:needs_review atWY6m:corrected | CceKnr:needs_review atWY6m:corrected | no |
| 20260910T232305Z-trial-gate-on | PASS → PASS | 127.0.0.1:47318=ok | 127.0.0.1:47318=ok | CceKnr:validated | CceKnr:validated | no |

4 runs, 0 changed. Verdicts before: ERROR 3, PASS 1; after: ERROR 3, PASS 1.

