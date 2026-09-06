# Leave-one-out calibration of `used` — BEFORE the 2026-09-06 rule revision (kept for the before/after record)

Truth is behavioural: did the model act on the asset's token when it was visible, and never when it was hidden?

| asset | present runs | acted | judged used | withheld | hidden runs | acted while hidden | truth | TP | FP | FN | precision | recall |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| skl-sZFb3KatWY6m | 7 | 7 | 7 | 0 | 3 | 0 | needed | 7 | 0 | 0 | 100% (n=7) | 100% (n=7) |
| skl-oBaDO5CceKnr | 6 | 6 | 4 | 2 | 4 | 0 | needed | 4 | 0 | 2 | 100% (n=4) | 67% (n=6) |

- skl-oBaDO5CceKnr: 2 present run(s) acted on it without a used claim (judge withheld: 2 needs_review)

overall over 2/2 determined asset(s): precision 100% (n=11), recall 85% (n=13)
5 run(s) recorded no gate state and were left out — visibility is not assumed.

An asset with no hidden run is undetermined, not 100%. "withheld" counts needs_review: the judge saw the token but would not tie it to the fetch.
