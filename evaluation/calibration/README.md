# Leave-one-out calibration

Answers "is the attribution trustworthy?" without asking the judge to grade
itself. A human reading the same artifacts as the judge shares its source, so
their agreement proves little. The truth used here is behavioural: hide the
asset from the model, run again, and see whether the run changes.

| File | Does |
|---|---|
| `loo.mjs` | Loads runs, reads what the model acted on from the artifacts, and scores the judge's `used` against present/hidden runs. |

The hiding is the gate's own write path: `run-once.sh --ablate <asset_id>`
resets the pool to the frozen baseline, sets that one asset `private`, reads
it back, and records the state in `run.json`. Gate-on runs, which hide the
rejected asset, count as hidden runs for it.

## Definitions

- **acted(run, X)** — X's discriminative token appears in a tool call's
  arguments or in an address the model dialled. Read from `run-artifacts.json`
  and `verdict.json`, never from the judge.
- **present / hidden** — X visible / not visible at the start, as read back
  from the product (`run.json → gate.visibility_at_start`). A run that recorded
  no gate state is left out and counted; visibility is not assumed.
- **needed(X)** — acted in some present run and in no hidden run.
- **leak(X)** — acted in a hidden run. The model produced the token without
  the asset, so it knew it from elsewhere, and every `used` the judge issued
  on that token is unsupported.

Per (present run, asset) pair: **TP** judged used, acted, needed · **FP**
judged used but not acted in that run, or the asset leaks · **FN** not judged
used (needs_review or nothing) but acted and needed. Precision and recall are
always printed with n. An asset with no hidden run is **undetermined**, never
100%.

## Current state (2026-09-06, after the hidden runs)

| asset | present | acted | judged used | withheld | hidden | acted while hidden | truth | precision | recall |
|---|---|---|---|---|---|---|---|---|---|
| eval-bridge-endpoint-a (wrong) | 7 | 7 | 7 | 0 | 3 | 0 | needed | 100% (n=7) | 100% (n=7) |
| eval-bridge-endpoint-b (right) | 6 | 6 | 4 | 2 | 4 | 0 | needed | 100% (n=4) | 67% (n=6) |

Overall: precision 100% (n=11), recall 85% (n=13). Rendered table: `loo-2026-09-06.md`.

The four runs with the right asset hidden all **failed**: the model dialled
10.244.7.19:8096, timed out, and never reached 47318. With the asset visible,
6/6 passed. Nothing else in the pool, the system prompt or the model's own
knowledge supplied the port — which is what makes the token discriminative and
the `used` claims on it supportable.

The two recall misses are the two `needs_review` runs: the token had appeared
in a search snippet before the fetch, and the earliest-delivery rule withheld
`used`. The rule is conservative by design; this is its measured cost, 2 of 6,
and it is reported as a miss rather than argued away.

## Limits

- Two assets, one token each. n is per (run, asset) pair; with three runs
  per condition the intervals are wide and the table says so with n.
- Only the hard judge's `used` is calibrated. Soft evidence (P1-6) was cut.
- The behavioural signal is token presence in calls. An asset that changes
  behaviour without its token appearing (a decision not to do something) is
  not captured; `avoided_option` is in the contract and not measured here.
