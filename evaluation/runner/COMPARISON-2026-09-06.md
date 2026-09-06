# Gate on / off comparison — 2026-09-06

Same task, same consumer identity (B, `usr-4u07qc2kuj` / `agt-5e0y4l8a7a`), same
frozen pool, same frozen gate baseline. Three runs with the gate off, three with
it on, all launched by `run-once.sh --auto`, all `PASS`.

The full rendered table is `summary-2026-09-06.md`; this file is the reading.

## The headline that is not the result

| arm | started | pass | pass rate |
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
| gate-off | **3/3** | **3/3** | 3 | 3 | 2 | 50 |
| gate-on | **0/3** | **0/3** | 0 | 0 | 2 | 33 |

Per run, gate-off:

| run | first dial | wrong asset | right asset |
|---|---|---|---|
| 09:21Z | 10.244.7.19:8096, timed out | recalled → injected → fetched → used → **corrected** | fetched → needs_review |
| 09:31Z | 10.244.7.19:8096, timed out | recalled → injected → fetched → used → **corrected** | fetched → used → validated |
| 11:16Z | 10.244.7.19:8096, timed out | recalled → injected → fetched → used → **corrected** | fetched → used → validated |

Per run, gate-on (wrong asset `visibility=private` before the session, read back):

| run | first dial | wrong asset | right asset |
|---|---|---|---|
| 11:29Z | 127.0.0.1:47318, code 0 | **absent from every stage** | fetched → used → validated |
| 11:29Z | 127.0.0.1:47318, code 0 | **absent from every stage** | fetched → needs_review |
| 11:30Z | 127.0.0.1:47318, code 0 | **absent from every stage** | fetched → used → validated |

"Absent from every stage" is the strongest form of the claim this design can
make: the asset does not appear in the bridge search results (`recalled`), was
not placed in context (`injected`), and was never retrieved (`fetched`). The
product's own whitelist filtered it — `apply.sh` wrote `private`, read it
back, and the run recorded the read-back state — and this report only
observes the absence. The capture is upstream of the proxy, so an absence
there cannot have been produced by the model.

## What the difference costs and saves

- **One wasted attempt per run** with the gate off: the wrong address, a
  connect timeout, then the recovery. Mean wall time 50 s against 33 s. The
  cost record has no token counts for this model (`token_source: not present
  in this capture`), so the saving is reported in seconds and attempts, not
  tokens.
- **Three `corrected` events** with the gate off, zero with it on. With the
  gate on there is nothing left to correct; the evidence that would justify
  rejecting the asset was gathered in the evidence-base runs, and the
  comparison shows what happens once it has been acted on.

## The two `needs_review` outcomes

One run in each arm ends with the right asset at `needs_review` rather than
`validated`. Same reason both times: the token `47318` appeared in a search
snippet at message 3, before the fetch, and the hard judge cannot tell use of
the fetched body apart from use of the snippet. That is the earliest-delivery
rule working as specified, and it costs one validated event per arm equally.
It is not counted against either arm.

## What this does and does not establish

Established, n = 3 per arm:

- With the gate on, a rejected asset is not retrievable by a consumer through
  the real client path. The consumer never dialled its address.
- With the gate off, the same asset is retrieved and acted on every time, and
  the run pays for it in one failed attempt and roughly 17 s.
- The verdict itself does not move. A report that showed only the pass rate
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

Here the pass rate does move: 100% → 0%. Without the asset the model has one
address to try, tries it, times out, and stops. This is the "use the asset vs
do not" contrast for the asset that carries the answer, and it is what
calibrates the judge: the token 47318 never appears when the asset is hidden,
so every `used` issued on it rests on content that came from the asset.
Calibration table: `evaluation/calibration/loo-2026-09-06.md` — precision
100% (n=11), recall 85% (n=13); the misses are the two needs_review runs.
