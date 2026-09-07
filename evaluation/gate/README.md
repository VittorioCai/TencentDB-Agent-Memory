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

## Phase 1 (2026-09-08): who may write, what counts, where the model reads

Review found three ways round the gate: the owner could set `status`
through `asset/update`; a consumer's own report was read as evidence; and
the caller's own skills reached the model through paths that never asked
the registry (the bridge's own-skills list, the injected listing, `get`).
All three are closed in commit c7be0f5 and after.

**Evidence.** An outcome row is `trusted` only when a team admin or
reviewer submits it naming the consumer, with the `call_id`, the
`asset_version` and evidence attached. The service derives that mark and
the `relation`; the caller's values are dropped. Anything else — a
member's own report, an admin's row without a call id — is recorded with
the reasons and ignored by the decision, the confidence and the author
statistics alike. Rows about the same call collapse to the latest, so a
supplement (`used`, then `validated`) or a retry never adds weight, and
`event_id` makes delivery idempotent. Rules version
`gate-rules-2026-09-08`; the decision carries `confidence_n` (the
denominator) and `evidence_policy: trusted-only`.

**Writes.** `status`, `confidence` and `metadata_json.gate` are written by
the gate and the review routes only. A member cannot set them through
create or update; a member's manual registration enters as a candidate; an
admin may set status (a management act) but the gate object on file always
wins. A re-evaluation keeps the human review and the review request (it
used to drop the review).

**Reads.** Every read now carries a purpose. `use` is the model's path —
the proxy's bridge and injector, and any `/v3/skill/*` call without
`x-tdai-read-purpose: manage` — and passes an `approved` asset only, the
caller's own included. `manage` is the person's path (the panel sends the
header): the owner, admins and reviewers also see candidates and
rejections. On the skill data plane the filter sits in `skill-handlers.ts`
(`admissionFilter`) on get, get-by-name, files/read, versions, export,
list, search and listing; a skill with no asset row is denied and
registered as a candidate. `asset/list`, `asset/get`, `gate/get`,
`outcome/list`, `evaluate` and `review` all follow the asset's own
permission — hidden in a list means hidden in detail. A private candidate
reaches the reviewers only after its owner submits it
(`asset/gate/submit`; withdraw takes it back).

```
/v3/meta/asset/gate/submit      owner: ask the team to review a candidate / withdraw
/v3/meta/asset/gate/backfill    admin: legacy statuses ("active") → candidate, decided once; never approved by migration
```

**Seen live (2026-09-08, commit 225f3ba).** Consumer B on the model path:
`skill/list` (own skills) → 0 items, `listing` → `(none)`, team `search`
→ approved skills only, `get` of the failed asset → `40301
SKILL_NOT_ADMITTED`; on the manage path B sees its own auto-extracted
skill. Outcome rows in Core: 19 recorded before this phase as the consumer
are on file and untrusted; the evidence base re-recorded with the admin
key is 4 trusted rows (`artifacts/core-seed-2026-09-08.json`), and Core's
decisions from them agree with the frozen baseline (admit b / reject a).

Consequence for the comparison: B's injected `<available_skills>` block no
longer names its own auto-extracted skill — the gate itself removes the
confounder `COMPARISON-2026-09-06.md` records. That is a change in what
the model sees, so batch 3 is run after phases 1–4, not before.

| File | Does |
|---|---|
| `core-gate.sh` | The runner's side of the in-Core gate: `--seed` (evidence base → Core, decisions checked against the frozen baseline), `--sync <run>` (a run's outcomes → Core as the admin naming the consumer, with `call_id` from `target_ref` and `event_id`; evaluate=false), `--reset` (gate off: every baseline asset approved), `--apply` (gate on: Core evaluates at `as_of` = frozen baseline), `--status`. Every write read back; the record carries status, the full decision per asset and, since v2, each row's `trusted` mark |
| `../eval-core.sh` | Mounts this branch's `MemoryCore/src/metadata` and the three gateway files (`skill-handlers.ts`, `v2-schemas.ts`, `v2-router.ts`) over the core image's copies (the image runs tsx on src), after checking parity with a committed version and a clean tree |
| `artifacts/gate_baseline.json` | The frozen evidence base: which runs, which events, what they decided |
| `artifacts/core-seed-2026-09-07.json` | The seed: 4 outcomes from the two evidence-base runs recorded in Core; Core's decisions agree with the frozen baseline (admit / reject) |
| `artifacts/core-apply-asof-2026-09-07.json` | The apply with `as_of`: each decision cites exactly the evidence-base records |
| `artifacts/core-seed-2026-09-08.json` | The evidence base re-recorded as trusted rows after phase 1; decisions unchanged |
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
