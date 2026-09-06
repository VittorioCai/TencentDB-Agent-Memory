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
