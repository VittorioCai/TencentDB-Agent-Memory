# Gate on / off comparison, batch 3 — 2026-09-08

Same task, same consumer (B, `usr-4u07qc2kuj` / `agt-5e0y4l8a7a`), same
frozen evidence as batches 1 and 2 — the same two preparation runs and the
same events. Five runs gate-off then five gate-on, all `run-once.sh --auto`,
launched in one sequence between 07:51 and 07:58 UTC. Rendered table:
`summary-2026-09-08.md`.

**What is new in this batch is the rules, not the evidence.** Batch 3 runs
against `evaluation/gate/artifacts/gate_baseline_batch3.json`, which pins
`rules_version: gate-rules-2026-09-08f` and the code commit. Batches 1 and 2
stay on file under their own rules and are not recomputed; their numbers are
not merged with these.

The rules that changed since batch 2 (`gate-rules-2026-09-07`): outcomes,
reviews and requests bound to the content hash; a human admit lifts a rule
reject only for the corrected outcomes it names with a reason; one validity
rule for every consumer; a decision written conditional on the evidence set
it was read from; finality per call decided once by Core.

## Result

| arm | started | PASS | first batch of calls all ok | failed attempts | corrected outcomes |
|---|---|---|---|---|---|
| gate-off | 5 | 5 | 0/5 | 4 | 3 (+2 needs_review) |
| gate-on  | 5 | 5 | 5/5 | 0 | 0 |

Both arms pass on the endpoint success rate, which is what the acceptance
measures — the last attempt decides, and a run that dials the wrong address,
times out and then dials the right one still passes. The gate shows in the
first batch of calls: with it off, 4 of 5 runs dialled the wrong address
first; with it on, none did, because the asset documenting that address was
not in the pool the model could reach.

Per-run outcomes: off — the right asset validated 5/5, the wrong asset
corrected(wrong) 3/5 and needs_review 2/5. On — the right asset validated
4/5, and one run recorded `needs_review`, which produces no outcome by
design (`outcome.md` names the skipped event rather than dropping it).

## Isolation: what the on arm can and cannot claim

**The asset was never delivered.** In all five gate-on runs the hidden asset
appears in no system prompt, no available-skills block and no skill read:
the read path refused it, and no run recorded it as used. There is no
instance in this batch of the failure the calibration rules are written for
— an asset hidden and confirmed undelivered, yet judged `used`. That is an
observation about these five runs, not a property of the system.

**One run needs a more careful answer than "not clean".** This section first
said `20260908T075637Z-gate-on-core` showed an isolation failure, because
the string `10.244.7.19:8096` is in its captured request body. That was
asserted from a `grep`, and a grep is not an audit. Re-read with
`../attribution/delivery-audit.mjs`, which applies the boundaries the
calibration rules need — model input versus the model's own text, first
arrival before the operation, a token is not an asset, and unknown stays
unknown — the five gate-on runs read:

Every capture in the batch was first checked for coverage — request and
response paired for every turn, nothing truncated, every turn that asked for
tools followed by another, and the last ending `stop`. All ten are complete,
so absence in them is evidence rather than a gap.

| arm | hidden `skl-sZFb3KatWY6m` | admitted `skl-oBaDO5CceKnr` |
|---|---|---|
| gate-off, 5 of 5 | **delivered** | **delivered** |
| gate-on, 4 of 5 | **not delivered** | **delivered** |
| gate-on, 075637 | `ambiguous_source` | `ambiguous_source` |

The off arm is the control that matters: with the gate off, the audit finds
both assets reaching the model. With it on, the admitted asset still reaches
the model and the hidden one does not. That is the gate, measured on content
rather than on which API the content came through.

The 075637 arrival is traced end to end. The model ran a `python3` one-liner
(message 11) that read a CodeBuddy tool-result cache file and wrote its
`data.content` to `/tmp/sop_scene.md`; it read that file back (message 13,
`Read`), and the result arrived at message 14 with a matching
`tool_call_id`. The cached payload is `skill-bridge-技能搜索接口验证.md`
belonging to agent `agt-5e0y4l8a7a` — **the consumer's own knowledge file,
not either pool asset** — and it carries both addresses, because it records
what earlier runs found. Its `updated_at` is 2026-09-08T07:56:30, inside
this batch's own window.

The operation being judged sits at request 8 message 17, resolved from the
used-event's `target_ref` (`request(<id>):msg[17]:<call>`), so the arrival
did precede it. That makes this an alternative source that could have
informed the run — not a leak of the gated asset, and not a clean isolation.
Both assets read `ambiguous_source` in that run for the same reason: the
first arrival of either token was inside that knowledge file, before any
skill was read, and first arrival is what attribution follows.

So this batch supports "the gate held: no pool asset was read on the model's
path" and does not support "the model could not have known the wrong
address". The agent's own knowledge file accumulating findings across runs is
a contamination source in its own right, and one to settle before the
extension scenarios.

The other four gate-on runs carry the address nowhere in their captures.
All five gate-off runs carry it, which is expected: they were served the
asset.

Both arms carry an L3 memory block with a watched line (5/5, both arms), as
in batch 2. Where both arms carry it the arms stay comparable; what it takes
away is the reading "the model recovered on its own" for the off arm's
second dial.

## Evidence

- Runs: `runs/20260908T0751*`–`20260908T0757*`, ten directories with raw
  capture, per-run gate state, outcome events and receipts.
- Driver logs: `runs/batch3-{off,on}-{1..5}.log`.
- Baseline: `../gate/artifacts/gate_baseline_batch3.json`. Its `code_commit` first read
  `9701d4f`, the last commit when it was frozen; the `08f` rules label it names was
  committed as `747fe9a`, so the field was corrected to that. The per-run copies keep
  the earlier value; each run's `gate-apply.json` and `receipt.json` recorded
  `gate-rules-2026-09-08f` from Core at run time, which is the label that matters.
- Decisions at freeze: `../gate/artifacts/core-apply-asof-2026-09-08f.json`.
