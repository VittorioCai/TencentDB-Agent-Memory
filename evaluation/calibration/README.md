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

Before the rule revision (kept as `loo-2026-09-06-before-rule-revision.md`):

| asset | present | acted | judged used | withheld | hidden | acted while hidden | truth | precision | recall |
|---|---|---|---|---|---|---|---|---|---|
| eval-bridge-endpoint-a (wrong) | 7 | 7 | 7 | 0 | 3 | 0 | needed | 100% (n=7) | 100% (n=7) |
| eval-bridge-endpoint-b (right) | 6 | 6 | 4 | 2 | 4 | 0 | needed | 100% (n=4) | **67% (n=6)** |

The two misses were a systematic class, not noise: in both runs the token
had first reached the model inside the right asset's **own** search entry
(its snippet), before the fetch, and the earliest-delivery rule treated that
entry as "another source". It is the same asset at the same version through a
second channel; the content came from the asset either way, which is the claim
`used` makes. The rule was revised with the user's approval (judge-hard,
`listingEntriesCarrying`): an earlier listing whose only entry carrying the
token is this asset's own entry no longer blocks. A listing where another
asset's entry also carries the token still blocks; a listing that cannot be
parsed into entries still blocks.

After the revision (`loo-2026-09-06.md`):

| asset | present | acted | judged used | withheld | hidden | acted while hidden | truth | precision | recall |
|---|---|---|---|---|---|---|---|---|---|
| eval-bridge-endpoint-a (wrong) | 7 | 7 | 7 | 0 | 3 | 0 | needed | 100% (n=7) | 100% (n=7) |
| eval-bridge-endpoint-b (right) | 6 | 6 | 6 | 0 | 4 | 0 | needed | 100% (n=6) | 100% (n=6) |

Overall: precision 100% (n=13), recall 100% (n=13). The hidden runs are the
check that the revision did not loosen anything: with the right asset hidden
the model still never produced 47318 (4/4 failed), so every `used` on it rests
on content that came from the asset. A rule change that had let a leaked
token through would show up here as `acted while hidden > 0`.

Both tables stay in the report. The first shows the calibration finding a
real miss class; the second shows the fix measured by the same instrument.

## Limits

- Two assets, one token each. n is per (run, asset) pair; with three runs
  per condition the intervals are wide and the table says so with n.
- Only the hard judge's `used` is calibrated. Soft evidence (P1-6) was cut.
- The behavioural signal is token presence in calls. An asset that changes
  behaviour without its token appearing (a decision not to do something) is
  not captured; `avoided_option` is in the contract and not measured here.

## Two corrections after review (2026-09-06, evening)

A review of the revised rule and of the outcome judge found two real
misjudgements. Both are fixed, with regression tests, and every run was
re-judged; the states did not change, but the rules under which they hold are
now the stricter ones.

1. **The listing exception checked the asset, not the version.** The approval
   was for "same asset, same version"; the implementation accepted a v1 listing
   entry as cover for a v2 fetch, and an entry stating no version at all.
   `listingEntriesCarrying` now returns each entry's version, and the exception
   applies only when the entry's version equals the credited fetch's. A v1
   entry against a v2 fetch, or an entry with no version, blocks with a reason
   that says so.
2. **A failed call at the asset's own address was called `corrected(wrong)` on
   that call alone.** Dialling the address proves the model followed the asset;
   it does not prove the content is wrong — the right address can time out
   once. `corrected` now needs the failure to reproduce: the harness probes
   every attempted host:port itself (`probe-reachability.mjs`, TCP connect,
   recorded with time and source) and the judge calls the asset wrong only when
   that probe also failed to reach the address, and no other attempt at the
   same address in the run succeeded. Otherwise `needs_review`, with the
   contradiction named. Runs before this change carry a probe taken afterwards,
   labelled "harness probe after the run (backfill 2026-09-06)"; from now on the
   probe is taken at run time.

**On the 100% above.** The rule was revised and the same runs re-scored; that
is a development-set recomputation, not an independent validation. Both tables
stay. The rules are now frozen for the extension scenarios: their runs will be
judged under the rules as committed before those runs start, and any further
rule change will be reported as a change, with before and after.

## contributed (the overview chain's last link)

`contributed.mjs` emits one `contributed` event per (asset, version, contrast
batch) when all three hold: a `validated` event for that version in the
batch's present runs; a present-vs-absent contrast of the asset itself
(leave-one-out — the gate on/off comparison does not qualify, it contrasts
the wrong asset's presence); and at least one gain metric non-zero and
consistent in direction. Raw values on both sides, run ids on both sides and
the rules commit ride on the event so a reader can recompute it.

Current (`contributed-events.jsonl`, rules commit 44c3ca2):

| asset | present | absent | pass rate | failed attempts | wall s | prompt tokens | contributed |
|---|---|---|---|---|---|---|---|
| eval-bridge-endpoint-b v2 | 6 | 4 | 1.0 vs 0.0 | 0.5 vs 1.0 | 41.8 vs 50 | 130.2k vs 145.2k | **yes** |
| eval-bridge-endpoint-a v2 | 7 | 3 | — | — | — | — | no: no validated event |
