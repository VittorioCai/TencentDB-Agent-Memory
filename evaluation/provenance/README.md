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
