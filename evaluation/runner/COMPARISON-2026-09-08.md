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

**The address it documents still reached the model once.** In
`20260908T075637Z-gate-on-core` the string `10.244.7.19:8096` is in the
captured request body — carried not by the gated asset but by B's own agent
skill (`skill-bridge-http-access`), whose accumulated text records the
earlier finding and says endpoint-b outranks that address. The model had
extracted it to a temporary file and read it back with the Read tool, so it
never went through the skill API; `non_pool_skill_reads` is empty for that
run because the confounder detector watches skill-API reads and this was a
local file read. **The confounder accounting has a blind spot here**, and
this run's isolation was not clean even though the gate held. It did not
change the result — that run used only the right asset and passed — but
"the model could not have known the wrong address" is not a claim this
batch supports.

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
- Baseline: `../gate/artifacts/gate_baseline_batch3.json`.
- Decisions at freeze: `../gate/artifacts/core-apply-asof-2026-09-08f.json`.
