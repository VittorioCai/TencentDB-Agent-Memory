# Provenance: joining "who wrote it" to "who used it"

The existing telemetry is missing that edge. `tool_call_logs` records only the
consumer (`user_id` / `agent_id`); the asset's owner lives in the asset record,
and the two were never joined. Without the edge, neither the team dimension nor
author confidence can be computed.

**And it cannot be backfilled.** Asset ownership changes and versions roll
forward, so a lookup after the fact returns a different row than the one that was
actually used. This has to be recorded before the event schema is frozen.

## Running it

```bash
# 1. Snapshot the asset pool (this also fixes pool_snapshot_at)
bash evaluation/provenance/snapshot-assets.sh

# 2. Export the service-side telemetry
SINCE="7 DAY" bash evaluation/gate0/export-tool-call-logs.sh

# 3. Join all three inputs
node evaluation/provenance/build-events.mjs \
  evaluation/provenance/artifacts/asset-pool-snapshot.json \
  evaluation/gate0/artifacts/tool-call-logs.jsonl \
  evaluation/gate0/artifacts/gate0-threechannel-capture.jsonl
```

Unit tests: `node --test evaluation/provenance/build-events.test.mjs`

## Each input answers only part of the question

| Input | Answers | Cannot answer |
|---|---|---|
| Asset pool snapshot | who wrote it, when, which version | whether it was used |
| `tool_call_logs` | who used it, whether the call succeeded | which assets came back |
| Capture JSONL | which asset ids appear in responses | whether the call truly succeeded |

The second row is the key limitation: a `skill/search` bridge row records the
request only — its body holds the query, not the result. **Asset identity can be
recovered only from the captured response**, which is why all three inputs are
required and why every event states how it was witnessed.

## Observation levels

| Level | Meaning |
|---|---|
| `bridge+wire` | Service-side success plus an asset id parsed from the capture. Strongest. |
| `bridge_only` | Service-side success, but the capture missed it — only the channel is known. |
| `wire_only` | An asset id in the capture with no matching service-side success. Doubtful. |

`bridge_only` records are kept rather than dropped: **a gap in collection and an
absence of activity are not the same thing.**

`observation` answers *how the fetch was witnessed*. A separate field,
`evidence_tier` (`hard` / `soft`), answers *how strong the "it was used"
judgement is*. This tool emits fetch-level events only, so it always writes
`null` there; the attribution judges fill it in. Both are defined in
`evaluation/contracts/README.md`.

Every emitted event validates against the contract:

```bash
node evaluation/contracts/validate.mjs \
  evaluation/contracts/provenance-event.schema.json \
  evaluation/provenance/artifacts/provenance-events.jsonl
```

## Relation, and the headline metric

| Value | Meaning | Counts as team value |
|---|---|---|
| `self` | used one's own asset | no |
| `cross_agent` | same person, different agent | partly |
| `cross_user` | another identity used it | yes |
| `unknown` | identity missing on one side | excluded from the denominator |

When an identity is missing the relation is `unknown`; it **never defaults to
`self`**, because defaulting would quietly erase genuine cross-person use. By the
same reasoning, when nothing at all is attributable the summary reports "not
computable" rather than 0% — 0% reads as *"we measured, and there was none"*,
whereas the truth is *"nothing was measured"*.

## Answer-leak guard

This system auto-extracts assets from failed sessions — measured: a Skill was
generated 45 seconds after a debugging failure ended. If such an asset flows back
into the candidate pool while a related task is being evaluated, it leaks the
answer.

The snapshot instant becomes `pool_snapshot_at`, and any asset created after it
is marked `excluded_by_snapshot`.

## Early lifecycle states: recalled, selected, injected

`build-events.mjs` starts at `fetched`. That leaves the three states before it
unrecorded, and with them the distinction between **an asset that was never
offered** and **an asset that was offered and ignored**. Those are different
failures of a team asset system and only the second one is the asset's fault.

`build-early-events.mjs` fills them in. Every state is proved from its own
source; none is inferred from another.

| State | Meaning | Proved by |
|---|---|---|
| `recalled` | a retrieval operation returned this asset as a candidate | `candidate_listing` (injector hits) or `bridge_response` (a `search`/`list` response in the capture) |
| `selected` | the asset survived a narrowing step | `candidate_listing` — the hits *and* the rendered block, which are its input and output |
| `injected` | the asset reached the model | `injected_block` (an entry in the real `<available_skills>` block) or `session_message` (a listing carried in `messages[]` of a captured request) |

### Two retrieval paths, and why only reading the system prompt is wrong

`<available_skills>` is owner-filtered — it lists skills belonging to the
current agent. A consumer identity that has written nothing gets an empty block,
and every team asset it sees arrives through `skill_search` as a **tool result**.
Reading only the system prompt would report "nothing was recalled" for exactly
the cross-person case this tooling exists to measure.

So both paths are collected, and an asset that arrives by both is one `injected`
event carrying two proof references, not two events.

### Why `hits` is not `selected`

`skill-injector.ts` logs `hits=<count>`. A count can support *"something was
recalled"* but never *"this asset was recalled"*, and a record that cannot name
the asset is not evidence. `candidate-log.sh` mounts a patched injector that
appends `skill_id` + `version` per hit **and** the rendered block.

Both sides are needed because they are the input and the output of the narrowing
step: session-init `<available_skills>` caps at 20 entries, so hits genuinely
exceed what is rendered once a team grows. With only one side the step is
unobservable — and then `selected` is not written at all rather than copied from
the candidates.

On the bridge-search path there is **no** narrowing step: the service returns a
list and the model's next move is a fetch. `selected` is never written there.

### The rule that governs all of it

A state that cannot be evidenced is not written. A missing event means *not
observed*, never *did not happen*, and the summary prints both so the difference
stays visible. The same rule already governs `n/a` in the capture verifier.

### Running it

```bash
# once, before the session — recreates the proxy with the injector patch mounted
bash evaluation/eval-proxy.sh enable
bash evaluation/eval-proxy.sh status     # what the listing returned
bash evaluation/eval-proxy.sh disable    # back to the stock image

node evaluation/provenance/build-early-events.mjs \
  evaluation/provenance/artifacts/asset-pool-snapshot.json \
  evaluation/gate0/artifacts/tool-call-logs.jsonl \
  evaluation/gate0/artifacts/*-capture.jsonl \
  --candidates=evaluation/provenance/artifacts/candidate-log.jsonl
```

The listing runs once at session init and its block is cached for the rest of
the session, so enabling the log mid-session records nothing — start a fresh one.

### Two traps this collector is built around

**A prose mention of a block tag is not the block.** In a real captured system
prompt the literal string `<available_skills>` occurs three times: twice inside
`<skill_tools>` prose telling the model where to look, once as the actual block.
A non-anchored `<tag>(.*?)</tag>` starts at the first mention and returns a
paragraph of English instructions as the skill list. Injected blocks are emitted
on their own line; prose mentions never are.

**A command echo is not a response.** A tool result repeats the command before
its output, so a `skill/search` that timed out after 75 s with empty stdout still
contains the bridge URL and the query. The endpoint is read from the command —
that is what the command is for — and the payload only from stdout.

Both are the same shape as the three false positives the fetch judge fell for:
the text looks related. Each has a test holding it shut.

## The proxy augments the request body

A service-side `bridge_call` row records the request body **as the bridge
forwarded it** — the model's body plus the identity the proxy injects from the
session (`user_id` / `team_id` / `agent_id`, and routing fields). The model
never writes those. So pairing a captured response to its service row on an
exact string match of the body always fails, and the real injector-probe run
showed the cost: two genuine `get-by-name` reads reported `wire_only` with "no
service row" while their rows sat in the log.

Pairing now canonicalises both sides — parse, sort keys at every depth, drop the
proxy-injected identity keys — before comparing. The fields that tell one call
from another (`skill_id`, `skill_name`, `include_content`) are all kept, and
within a session identity is constant, so this cannot merge calls that were
really distinct. It is a defined normalisation, not the positional fallback that
was removed earlier.

## Assets the frozen snapshot does not hold

`build-events.mjs` used to iterate the snapshot's assets, which made an asset
that appeared *after* the freeze invisible — not excluded, not flagged, simply
absent from every event. That is the worst outcome for exactly the case the
freeze exists to catch: the system auto-extracts skills from finished sessions,
and the first real consumer run left a consumer-owned skill in the evaluation
pool one minute after it ended. The next run read that skill before any
credited asset, and no event recorded it.

Targeted responses naming a skill id the snapshot lacks are now collected as
`unknownAssets` and printed in the summary with their first message index.
Nothing attributes to them; the judge's earliest-delivery rule is what screens
against them. `run-once.sh` additionally reads the live pool every run and
writes `pool-drift.json`, warning loudly when the pool has moved.
