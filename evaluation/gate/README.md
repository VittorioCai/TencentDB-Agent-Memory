# Admission gate

Where the evidence chain changes something in the product. Everything before
this directory records; the gate decides, and the decision is the asset's own
`status` — the field the product's read paths already act on.

**Since 2026-09-07 the gate lives in Core** (`MemoryCore/src/metadata`,
commit 98cbe25 and after), not in a script beside it. Review asked why a
script flipped `visibility` from outside when the product has a pool: it
does — `AssetStatus` carries `candidate / approved / failed`,
`list-accessible` already drops `failed`, and the bridge's whitelist is
`list-accessible`. What was missing was anyone writing those fields. Now:

```
/v3/meta/asset/outcome/append   record what happened after a use (validated / corrected / used)
/v3/meta/asset/outcome/list     read them
/v3/meta/asset/gate/evaluate    decide from the outcomes on file; write status, confidence, metadata_json.gate
/v3/meta/asset/gate/get         the decision on file
```

A skill enters the pool as a `candidate`; a candidate is readable by its
owner, team admins and reviewers and by nobody else (permission-checker),
which is the candidate pool. `approved` is governed by visibility as before;
`failed` leaves `list-accessible`, so the consumer's bridge never lists it.

| File | Does |
|---|---|
| `core-gate.sh` | The runner's side of the in-Core gate: `--seed` (evidence base → Core, decisions checked against the frozen baseline), `--sync <run>` (a run's outcomes → Core, evaluate=false), `--reset` (gate off: every baseline asset approved), `--apply` (gate on: Core evaluates at `as_of` = frozen baseline), `--status`. Every write read back; the record carries status and the full decision per asset |
| `../eval-core.sh` | Mounts this branch's `MemoryCore/src/metadata` over the core image's copy (the image runs tsx on src), after checking parity with a committed pre-gate version and a clean tree |
| `artifacts/gate_baseline.json` | The frozen evidence base: which runs, which events, what they decided |
| `artifacts/core-seed-2026-09-07.json` | The seed: 4 outcomes from the two evidence-base runs recorded in Core; Core's decisions agree with the frozen baseline (admit / reject) |
| `artifacts/core-apply-asof-2026-09-07.json` | The apply with `as_of`: each decision cites exactly the evidence-base records |
| `decide.mjs`, `author-confidence.mjs`, `render-decision.mjs` | The earlier evaluation-side decision (gate-decision-v1). Still run per run as an informational recomputation; the author-confidence formula in it was rejected in review and is not used by Core |
| `plan-visibility.mjs`, `apply.sh` | The earlier mechanism: flip `visibility` from outside. Kept for ablation (`--hide`) and for a like-for-like rerun of the 2026-09-06 batch (`GATE_MECHANISM=visibility`) |
| `build-baseline.mjs` | Freezes the evidence and decisions every comparison run starts from |

The outcome judge that feeds this lives beside the other judges:
`evaluation/attribution/judge-outcome.mjs`.

## The rules

```
reject    any corrected with reason wrong / stale
admit     ≥ 1 validated with relation cross_user, and no such corrected
pending   everything else
```

Nothing else moves admit or reject. Distinct tasks and distinct consumers are
reported in `signals` and `reasons`; they are not thresholds, and the output
says so. Every admit and reject cites the outcome rows it rests on
(`evidence_refs`); each row carries the run, the call and the proof it came
from, so a reviewer can open them and overturn the decision.

`confidence` on the asset is the share of its cross-person outcomes that
validated — a description of the evidence on file, `null` with none. It is
not a prior and not an estimate.

## Outcomes are tied to calls, not to the run

`judge-outcome.mjs` follows each `used` event to the call it fed and reads
that call's own result from the acceptance verdict. The mainline scenario is
exactly the case where anything coarser fails: the model dials the wrong
asset's address, times out, dials the right one, succeeds, and the run passes.
Grading by run outcome validates both assets. Grading by call gives:

```
corrected(wrong)  eval-bridge-endpoint-a  the call dialled 10.244.7.19:8096 — the asset's own value — and timed out
validated         eval-bridge-endpoint-b  the call succeeded and the run's acceptance passed
```

A failed call is blamed on an asset only when the failure is a reachability
class **and** the address dialled carries the asset's discriminative token
**and** an independent probe from the harness also fails to reach it. A 503
on the right address is `needs_review`, not `corrected`: a service fault is
not a wrong address. So is a token that appears in something other than an
acceptance attempt, a call that succeeded in a run that did not pass, and an
outcome that could not be read.

## The author signal

Review (2026-09-07) rejected the smoothed ratio `(V + α·μ) / (V + C + α)` as
too heuristic: two counts compressed into a number that says nothing about
what the person actually did. Core's decision carries no such number. What
it carries:

- the author's outcomes on their **other** assets, cross-person only, as
  counts (validated / corrected / distinct consumers) — reported, never
  scored;
- `recent_wrong_asset_ids`: the author's other assets judged wrong within 30
  days;
- `signals.author.assessment`: the **context-based assessment** when one is
  on file — competence for the asset's domain (high / medium / low /
  unknown), derived by reading the author's own records (L0 conversations,
  L1 memories, persona, earlier assets and their outcomes) with every claim
  citing a record id and the citations machine-checked. Written under
  `metadata_json.gate.author_assessment`; survives re-evaluation.

Where it changes something visible: a `pending` asset gets a review
priority — high when the author has recent assets judged wrong or the
assessment says low/unknown competence, low when it says high, normal
otherwise. The priority orders the human queue and never moves admit or
reject; on no evidence, neither would survive a question.

## What "reject" means in the product

```
admit    → status approved     (visibility as before)
pending  → status candidate    (owner, admins and reviewers read it; plain members do not)
reject   → status failed       (list-accessible drops it; the bridge whitelist follows)
```

Status writes are the product's own (`gate/evaluate` as the owner, an admin
or a reviewer). Proven live on 2026-09-07: after `--seed`, `list-accessible`
for the consumer returned only the right asset (`core-seed-2026-09-07.json`),
and the gate-on runs of batch 2 recorded the wrong asset absent from every
stage.

## The frozen baseline, and `as_of`

`build-baseline.mjs` takes the preparation runs, deduplicates their events,
decides once, and writes `gate_baseline.json`. `core-gate.sh --seed` records
those runs' outcomes in Core and checks that Core decides the same.

`run-once.sh --gate off` resets every baseline asset to `approved` before the
session; `--gate on` resets and then has Core evaluate **at `as_of` = the
baseline's `frozen_at`**. A comparison run's own outcomes are recorded
(`--sync`, evaluate=false) and sit on file, but they do not decide the batch
they belong to: if the gate learned from run 1 before run 3, the arms would
not share an initial condition. The decision records `evidence_as_of`.

The baseline in use was frozen from runs `20260905T220020Z` and
`20260905T223401Z` (both PASS, 14 events). It rejects the wrong asset and
admits the right one. Those two runs are the evidence base and are not part
of any comparison.

## Running it

```bash
# put the gate into the running product (checks image parity, needs a clean tree)
bash evaluation/eval-core.sh enable

# evidence base → Core, then check Core's decisions against the frozen baseline
bash evaluation/gate/core-gate.sh --seed --out evaluation/gate/artifacts/core-seed-<date>.json

# what the assets look like to the product right now
bash evaluation/gate/core-gate.sh --status

# the comparison (each run resets or applies first, and syncs its outcomes after)
bash evaluation/runner/run-once.sh --gate off --auto --label gate-off-core
bash evaluation/runner/run-once.sh --gate on  --auto --label gate-on-core

# the earlier evaluation-side recomputation, per run (informational)
node evaluation/gate/decide.mjs --events=RUN/events.jsonl,RUN/used-events.jsonl,RUN/outcome-events.jsonl \
  --snapshot=RUN/asset-pool-snapshot.json --tokens=RUN/tokens.json

# tests
node --test evaluation/gate/*.test.mjs evaluation/attribution/judge-outcome.test.mjs
(cd MemoryCore && npx vitest run src/metadata/service/asset-gate.test.ts)
```
