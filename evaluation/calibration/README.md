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

## Current state (2026-09-06)

| asset | present | acted | judged used | withheld | hidden | acted while hidden | truth | precision | recall |
|---|---|---|---|---|---|---|---|---|---|
| eval-bridge-endpoint-a (wrong) | 3 | 3 | 3 | 0 | 3 | 0 | needed | 100% (n=3) | 100% (n=3) |
| eval-bridge-endpoint-b (right) | 6 | 6 | 4 | 2 | 0 | — | undetermined | — | — |

The right asset needs hidden runs:

```bash
bash evaluation/runner/run-once.sh --ablate skl-oBaDO5CceKnr --auto   # ×3
node evaluation/calibration/loo.mjs evaluation/runner/runs
```

If the model never dials 47318 without the asset, the right asset is
`needed`, and the two `needs_review` runs become recall misses: the
earliest-delivery rule withheld `used` because the token had appeared in a
search snippet before the fetch. That is the rule's cost, and it will show
here as recall below 100%, which is the honest reading. If the model does dial
47318 without the asset, it knew the port from somewhere else, the token is
not discriminative after all, and every `used` on it is a false positive.
Either outcome is reported as found.

## Limits

- Two assets, one token each. n is per (run, asset) pair; with three runs
  per condition the intervals are wide and the table says so with n.
- Only the hard judge's `used` is calibrated. Soft evidence (P1-6) was cut.
- The behavioural signal is token presence in calls. An asset that changes
  behaviour without its token appearing (a decision not to do something) is
  not captured; `avoided_option` is in the contract and not measured here.
