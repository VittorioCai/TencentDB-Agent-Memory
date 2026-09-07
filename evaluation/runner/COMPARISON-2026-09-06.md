# Gate on / off comparison — 2026-09-06

Same task, same consumer identity (B, `usr-4u07qc2kuj` / `agt-5e0y4l8a7a`), same
frozen pool, same frozen gate baseline. Three runs with the gate off, three with
it on, all launched by `run-once.sh --auto`, all `PASS`.

The full rendered table is `summary-2026-09-06.md`; this file is the reading.

## The headline that is not the result

| arm | started | pass | endpoint success rate |
|---|---|---|---|
| gate-off | 3 | 3 | 100% |
| gate-on | 3 | 3 | 100% |

Both arms pass every run. That is not the gate failing to matter; it is the
acceptance criterion doing what it was designed to do. `verify.mjs` lets the
**last** attempt at the target decide, so a run that dials the wrong address,
waits out the timeout, and then dials the right address is a pass. Every
gate-off run did exactly that. The plan predicted "off group partly fails"; the
model recovered every time instead. Reported as observed.

## Where the gate shows

| arm | wrong asset seen at any stage | first dial failed | failed attempts | corrected events | validated events | mean wall s |
|---|---|---|---|---|---|---|
| gate-off | **3/3** | **3/3** | 3 | 3 | 3 | 50 |
| gate-on | **0/3** | **0/3** | 0 | 0 | 3 | 33 |

Per run, gate-off:

| run | first dial | wrong asset | right asset |
|---|---|---|---|
| 09:21Z | 10.244.7.19:8096, timed out | recalled → injected → fetched → used → **corrected** | fetched → used → validated (needs_review before the rule revision) |
| 09:31Z | 10.244.7.19:8096, timed out | recalled → injected → fetched → used → **corrected** | fetched → used → validated |
| 11:16Z | 10.244.7.19:8096, timed out | recalled → injected → fetched → used → **corrected** | fetched → used → validated |

Per run, gate-on (wrong asset `visibility=private` before the session, read back):

| run | first dial | wrong asset | right asset |
|---|---|---|---|
| 11:29Z | 127.0.0.1:47318, code 0 | **absent from every stage** | fetched → used → validated |
| 11:29Z | 127.0.0.1:47318, code 0 | **absent from every stage** | fetched → used → validated (needs_review before the rule revision) |
| 11:30Z | 127.0.0.1:47318, code 0 | **absent from every stage** | fetched → used → validated |

"Absent from every stage" is the strongest form of the claim this design can
make: the asset does not appear in the bridge search results (`recalled`), was
not placed in context (`injected`), and was never retrieved (`fetched`). The
product's own whitelist filtered it — `apply.sh` wrote `private`, read it
back, and the run recorded the read-back state — and this report only
observes the absence. The capture is upstream of the proxy, so an absence
there cannot have been produced by the model.

## What the difference costs and saves

| arm | mean wall s | mean prompt tokens | mean total tokens | of which cached (mean) |
|---|---|---|---|---|
| gate-off | 50 | 136.7k | 141.2k | ~108k |
| gate-on | 33 | 123.6k | 127.7k | ~96k |
| right asset hidden | 50 | 145.2k | 148.7k | ~118k |

- **One wasted attempt per run** with the gate off: the wrong address, a
  connect timeout, then the recovery. That is the 17 s and the extra turn.
- **Tokens are real, not estimated.** The upstream is asked with
  `stream_options.include_usage` and reports usage in the final chunk of each
  streamed response; `cost.mjs` sums those. Gate on saves about 13k prompt
  tokens per run (≈10%) — one fewer turn carrying the 27k-character system
  prompt. Roughly three quarters of every prompt is cache hits, so the
  injection cost per turn is mostly cached; the saving is in turns, not in
  the size of any one prompt.
- **Three `corrected` events** with the gate off, zero with it on. With the
  gate on there is nothing left to correct; the evidence that would justify
  rejecting the asset was gathered in the evidence-base runs, and the
  comparison shows what happens once it has been acted on.
- The first version of the cost collector reported "no usage in this
  capture" for every run; it was reading request JSON while the usage sat in
  the response stream. Fixed 2026-09-06 and recomputed for all fifteen runs.

## The two `needs_review` outcomes, and the rule revision

At first judgement one run in each arm ended with the right asset at
`needs_review` rather than `validated`: the token `47318` had appeared in a
search snippet at message 3, before the fetch. Leave-one-out calibration
(`evaluation/calibration/`) showed this was a systematic miss class: the
snippet sat inside the right asset's **own** listing entry, and the
earliest-delivery rule was treating the same asset's second channel as
another source. With the user's approval the rule was revised (same-asset
listing entry no longer blocks; another asset's entry, or an unparseable
listing, still does) and the runs re-judged. Both arms now read 3 validated;
the pre-revision table is kept beside the new one in the calibration README.

## What this does and does not establish

Established, n = 3 per arm:

- With the gate on, a rejected asset is not retrievable by a consumer through
  the real client path. The consumer never dialled its address.
- With the gate off, the same asset is retrieved and acted on every time, and
  the run pays for it in one failed attempt and roughly 17 s.
- The verdict itself does not move. A report that showed only the endpoint success rate
  would show nothing.

Not established:

- Anything about *arbitrary* wrong assets. The scenario has one wrong asset
  with one discriminative token; the gate rejects it on two `corrected` events
  gathered earlier. Whether the outcome judge catches wrong assets whose
  failure is not a reachability class is a separate question (P4-6).
- Ecological validity. One person operated both identities; the author and
  consumer are distinct user ids by construction, not by circumstance.
- Effect on the system-prompt injection. `visibility` is shown to govern the
  bridge search result set and the three other read paths that share its
  whitelist. The consumer owns nothing, so the injector block was empty in
  both arms anyway.

## Provenance of this comparison

- Baseline: `evaluation/gate/artifacts/gate_baseline.json`, frozen
  2026-09-06T08:47:33Z from runs `20260905T220020Z` and `20260905T223401Z`
  (evidence base, not in the comparison).
- Pre-baseline runs of 2026-09-05 (2 unjudgeable, 1 injector probe) are
  listed in the summary under their own labels and excluded here.
- Gate state per run: `run.json → gate.visibility_at_start`, `gate.all_verified`
  (true in all six), and `gate-apply.json` with the write and the read-back.
- Auto-extraction was off for every run (`auto_extraction_enabled: false`),
  enforced by `prepare.sh` before the session.
- One runner defect found and fixed during the off arm: the service-row export
  window (30 minutes) pulled the previous run's rows into run 2's directory.
  Rows are now cut to the run's own conversation; run 2 was rebuilt from its
  own rows and its `run.json` says so. The gate-on arm ran after the fix.

## Alternative explanations, checked

Asked after the runs: could an open CodeBuddy session, or anything other than
the gate, have produced the on-arm result? Each of the following was checked
against the captures, not assumed.

| candidate cause | check | result |
|---|---|---|
| A second session leaking into the capture (the desktop app or an interactive CLI was open during some runs) | `x-conversation-id` on every captured request | exactly one id per run, six distinct ids, no truncated bodies |
| The previous run's service rows in this run's directory | export window overlap | found in run 2 of the off arm, fixed, run 2 rebuilt; the on arm ran after the fix |
| Order effect through injected memory or skills (on ran after off) | sha1 of the system prompt, off vs on, full diff | byte-identical except the conversation id (three occurrences); same 27,051 characters in all six runs |
| The consumer's own auto-extracted skill (`skill-bridge-http-access`, in the pool since 2026-09-05) leaking the answer | its injected block and fetched body scanned for both tokens | neither `47318` nor `10.244.7.19` appears in the system prompt of any run; it names neither asset |
| The model simply not searching in the on arm | search tool results, names parsed | on arm: the search ran every time and returned `eval-bridge-endpoint-b` + the consumer's own skill; off arm: the same search returned `-a` as well |
| The wrong asset hidden by something other than the visibility write | `gate-apply.json` write + read-back, `run.json.gate` | `private` written and read back before each on run; `team` read back before each off run |
| The model knowing the hidden asset anyway | every message of the on-arm captures | the name `eval-bridge-endpoint-a` occurs once, in one run's `reasoning_content`: "there could also be an eval-bridge-endpoint-a" — a guess from the `-b` suffix, never acted on, never fetched, never dialled |

What remains is what the design set out to show: the product's whitelist
removed the rejected asset from the consumer's search results, and the run's
behaviour followed from what was left.

## Receipts

Each of the six runs now carries `receipt.json` (contract-valid) and
`receipt.txt`. Gate off: every receipt shows `✗ eval-bridge-endpoint-a`
(corrected, gate reject) beside `✓` or `○ eval-bridge-endpoint-b`. Gate on:
only `eval-bridge-endpoint-b` appears at all. The receipts are the task-four
deliverable for these runs; the comparison above is what they add up to.

## Removing the right asset (leave-one-out, contrast 3 of task five)

Four runs with `eval-bridge-endpoint-b` hidden (`run-once.sh --ablate`), the
wrong asset left visible:

| condition | started | pass | fail | first dial |
|---|---|---|---|---|
| right asset visible (gate-off + gate-on runs) | 6 | 6 | 0 | wrong 3/6, right 3/6 |
| right asset hidden | 4 | 0 | **4** | wrong 4/4, then nothing |

Here the endpoint success rate does move: 100% → 0%. Without the asset the model has one
address to try, tries it, times out, and stops. This is the "use the asset vs
do not" contrast for the asset that carries the answer, and it is what
calibrates the judge: the token 47318 never appears when the asset is hidden,
so every `used` issued on it rests on content that came from the asset.
Calibration table: `evaluation/calibration/loo-2026-09-06.md` — precision
100% (n=11), recall 85% (n=13); the misses are the two needs_review runs.

## Supplementary metric: the first batch (added after the results were read)

The primary verdict stays "last attempt decides". As a supplementary view,
`summarize-runs` now reports the **first batch** — every target call issued in
the earliest message that carried one:

| arm | first batch all ok | first batch had a failure | failed attempts |
|---|---|---|---|
| gate-off | 0/3 | 3/3 | 3 |
| gate-on | 3/3 | 0/3 | 0 |

One fact must travel with this table: in every gate-off run the wrong-address
call and the right-address call were issued **in the same model message**.
There was no feedback between them, so "the first call failed" is true in
submission order but cannot be told as "the model saw the failure and
corrected itself". What the batch shows is that the model dialled the wrong
address at all; the gate-on arm never did. This metric was added after the
first comparison was read, and is labelled as such.

The outcome judge was also tightened after review: `corrected(wrong)` now
requires the harness's own reachability probe to reproduce the failure
(`reachability.json` per run). The three off-arm corrected events stand under
that rule; the probe reaches 127.0.0.1:47318 and times out on 10.244.7.19:8096.

## Confounders found in review (2026-09-07)

Two things were in the model's context in every comparison run besides the
two pool assets. Both are the product working as designed; neither was named
above, and both change how one row of this comparison may be read. Recorded
per run in `context-confounders.json` from now on (stage 5d of `run-once.sh`),
backfilled for the fifteen runs here, and tabulated in `summary-2026-09-06.md`
under "What else was in context".

1. **The consumer agent's own L3 memory.** `<tdai_profile_memory>` for
   `agt-5e0y4l8a7a` (identity B), last updated 2026-09-06T00:04Z — learned
   by the product from B's evidence-base runs the evening before. Its SOP
   reads: "probe every documented candidate under a bounded timeout
   (--max-time 15) … a live code:0 reply outranks silent/unreachable
   records", and "never get-by-name (agent-scoped; cross-agent 404 by
   design)". Present in 3/3 off runs, 3/3 on runs and 4/4 leave-one-out runs;
   byte-identical across the six comparison runs (the system-prompt hash row
   above already showed that). **Consequence:** the off arm dialling both
   addresses is prescribed by this block. It must not be read as the model
   recovering on its own — the first-batch note above said the two calls were
   issued together; this says why. The between-arm columns (rejected asset
   seen, first batch, corrected, wall, tokens) stay valid: both arms carried
   the same block, and the on arm had one candidate to probe because the gate
   had removed the other.
2. **A consumer-owned auto-extracted skill outside the frozen pool.**
   `skill-bridge-http-access` (`skl-lUWmwEYqsZDZ`, owner B, created
   2026-09-05T22:02Z from the first evidence-base run, before auto-extraction
   was switched off). Listed in `<available_skills>` in every 2026-09-06 run
   and read by the model in 3/3 off, 2/3 on and 2/4 leave-one-out runs. Its
   body carries neither `10.244.7.19` nor `47318` (checked above), so no
   `used` rests on it; it carries the outdated get-by-name claim and the
   acceptance marker query `team-bridge-reachability`, which is task
   knowledge that leaked into a team asset. A corrected version is published
   separately, with v2 kept and its applicability stated.

Also renamed in this file: the "pass rate" column is the **endpoint success
rate**. `task.md` counts an accurately reported failure as a completed task;
`verify.mjs` does not. The number is right; its old name was not.

None of the figures above were re-measured after these changes. A new
comparison under the in-Core gate, with the L3 block and the extra skill
recorded per run, is the next batch; until it exists, no improvement in
success rate or tokens is claimed from any change made since 2026-09-06.
