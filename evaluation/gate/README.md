# Admission gate

Where the evidence chain changes something in the product. Everything before
this directory records; this directory decides, and writes the decision into
the one field the product will act on.

| File | Does |
|---|---|
| `author-confidence.mjs` | Author prior for cold-start assets: cross-person outcomes only, shrunk, person and agent apart, null when not computable |
| `decide.mjs` | The three rules (reject / admit / pending) and the cold-start branch where the author signal sets a review priority |
| `render-decision.mjs` | Human-readable form of a decision file |
| `plan-visibility.mjs` | Pure: decisions × baseline × what the product reads now → the writes to make |
| `apply.sh` | Reads each asset's `visibility`, writes the plan, reads it back, records both |
| `build-baseline.mjs` | Freezes the evidence and decisions every comparison run starts from |
| `artifacts/gate_baseline.json` | The frozen baseline in use |

The outcome judge that feeds this lives beside the other judges:
`evaluation/attribution/judge-outcome.mjs`.

## The rules

```
reject    any corrected with reason wrong / stale
admit     ≥ 1 validated with relation cross_user, and no such corrected
pending   everything else
```

Nothing else moves admit or reject. Distinct tasks and distinct consumers are
reported in `signals` and `reasons`; with the evidence one evaluation can
produce, a threshold on them would only ever say pending, so they are not
thresholds yet and the output says so.

Every admit and reject cites the events it rests on. A reviewer can open
`evidence_refs`, find the `verify_result` proof on the corrected event, and
read which call dialled which address and what happened.

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
class **and** the address dialled carries the asset's discriminative token. A
503 on the right address is `needs_review`, not `corrected`: a service fault
is not a wrong address. So is a token that appears in something other than an
acceptance attempt, a call that succeeded in a run that did not pass, and an
outcome that could not be read.

## Author confidence

```
confidence = (V + α·μ) / (V + C + α)      α = 5
```

`V` and `C` count only `cross_user` outcomes; an author validating their own
asset is self-certification. `μ` is the mean validation rate of the *other*
authors, itself shrunk toward 0.5 by how many outcomes they have. Leave-one-out
matters: with one author in the pool, a pool mean is that author's own rate,
and one validation would score 1.0 — the raw ratio the shrinkage exists to
temper. Shrinking the pool mean matters too: with two authors of one outcome
each, an unshrunk leave-one-out prior pulled each toward the other's extreme,
and one validation scored *below* one correction.

Not computable is `null`, never 0. Decoy assets are excluded from the tally.
Person and agent are scored separately; the two diverging points at an
extraction path, not a person.

Where the author signal changes something visible: a cold-start asset (no
usage evidence) is `pending` either way, but its reasons carry a review
priority — high when the author has recent assets judged wrong, low when the
author's confidence is computable and ≥ 0.8. The signal orders the human
queue. It never moves admit or reject; on no evidence, neither would survive
a question.

## What "reject" means in the product

The bridge's team-search whitelist is A ∪ B with
A = `meta list-accessible(visibility='team')`. An asset set to `private`
leaves A, and since the four read paths (search, get, get-by-name,
files/read) share the whitelist, it leaves the consumer's reach entirely.
`apply.sh` writes exactly that:

```
reject   → private
admit    → baseline (team)
pending  → baseline — the gate does not hide what it could not judge
```

Only the asset's owner can change `visibility`; the key used is identity A's,
and an accepted write is recorded as the proof that the key is the owner's.
Every write is followed by a read, and the record carries both. Proven live
on 2026-09-06 (`artifacts/p3-3-live-apply.json`, `…-reset.json`): apply set
the wrong asset `team → private` and read it back; reset restored `team`.

## The frozen baseline

`build-baseline.mjs` takes the preparation runs, deduplicates their events,
decides once, and writes `gate_baseline.json`. `run-once.sh --gate off` resets
the assets to it before the session; `--gate on` resets and then applies its
decisions. Nothing a comparison run produces feeds back: if the gate learned
from run 1 before run 3, the arms would not share an initial condition, and
the difference between them could be the gate or the order.

The baseline in use was frozen from runs `20260905T220020Z` and
`20260905T223401Z` (both PASS, 14 events). It rejects the wrong asset and
admits the right one. Those two runs are the evidence base and are not part
of the comparison.

## Running it

```bash
# what the gate says about one run's evidence
node evaluation/gate/decide.mjs \
  --events=RUN/events.jsonl,RUN/used-events.jsonl,RUN/outcome-events.jsonl \
  --snapshot=RUN/asset-pool-snapshot.json --tokens=RUN/tokens.json

# freeze a baseline from preparation runs
bash evaluation/gate/apply.sh --status --out evaluation/gate/artifacts/visibility-at-freeze.json
node evaluation/gate/build-baseline.mjs --runs=RUN_A,RUN_B \
  --snapshot=RUN_B/asset-pool-snapshot.json \
  --visibility=evaluation/gate/artifacts/visibility-at-freeze.json \
  --tokens=evaluation/attribution/artifacts/tokens.json

# see what an arm would write, without writing
bash evaluation/gate/apply.sh --apply --dry-run
bash evaluation/gate/apply.sh --reset --dry-run

# the comparison (each run resets first)
bash evaluation/runner/run-once.sh --gate off --auto
bash evaluation/runner/run-once.sh --gate on  --auto

node --test evaluation/gate/*.test.mjs evaluation/attribution/judge-outcome.test.mjs
```

## Limits, stated

- `task_id` is not stamped on events by the runner yet, so `distinct_tasks`
  reads 0 everywhere and the reasons say generalisation is not measurable. It
  is a reporting gap, not a zero.
- One author, one consumer. The author prior is at its neutral fallback and
  says so; the team dimension is real in mechanism and thin in data.
- `visibility` is proven to govern the bridge's search result set (P3-3a) and
  the three other read paths share the whitelist. Whether it also changes the
  system-prompt injection is not claimed; the comparison reads what the model
  fetched, not what it was shown.
