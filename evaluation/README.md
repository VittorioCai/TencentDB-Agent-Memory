# Trustworthy attribution for team assets

Tooling that answers one question with evidence the model cannot fabricate:
**was a team asset actually used, and by whom?**

The system injects team assets (skills, memories, knowledge bases) into an agent's
context, but the trail stops there. Nothing records whether the agent retrieved
the content, whether it influenced the change, or whether the result held up. The
task specification is explicit that retrieval and injection must not be reported
as effective use — and that is precisely the gap this tooling closes.

## Why the obvious approaches fail

**A model's own report is not evidence.** Asked whether it used an asset, a model
produces a plausible, well-formatted answer that is often correct — but its
correctness cannot be established from the answer itself. In the telemetry, an
intent row's `initiated_tool` is just `Bash`: what the model calls "using a team
asset" is, at the observable layer, a request to run a shell command. The asset's
identity only appears once a bridge actually forwards the call.

**Where you tap decides what you can see.** A probe placed between the client and
the proxy captured a system prompt of 15,523 characters with zero asset blocks,
while the proxy's own log showed several blocks injected on every turn. Both were
honest: injection happens *inside* the proxy. Moved between proxy and model, the
same prompt is 27,103 characters with every block present. The misplaced probe
yields data that looks clean and gives no hint that it is wrong.

**Regex over tool-result text gets fooled.** The first version reported all three
asset channels as used when not a single real fetch had occurred. Three distinct
causes, none of them "the pattern was too loose":

1. A tool result echoes the executed command before its output, so scanning the
   whole blob matches the *request*, not the response. A call that timed out after
   75 s with exit code 28 and empty stdout still contained the bridge name.
2. One asset's description happened to discuss the very endpoints being matched.
3. The model grepped this repository, and the result carried the checker's own
   pattern literal — the detector passed because the model searched for the detector.

All three share a shape: *looks related*. The fix is a different judgement
structure, not a stricter pattern.

## What is here

| Directory | Purpose |
|---|---|
| `contracts/` | Three frozen JSON Schemas plus a zero-dependency validator. Everything downstream is written against them. |
| `gate0/` | Observability probe and the two-tier capture verifier that decides whether an asset fetch can be seen at all. |
| `provenance/` | Asset pool snapshot and the join that puts producer and consumer on the same event. |

Nothing under `evaluation/` pulls npm packages; everything runs on Node's standard
library and shell.

## Two-tier evidence

| Tier | Source | Why it is trusted |
|---|---|---|
| bridge | A `kind='bridge_call'` row written to `tool_call_logs` with a 2xx `upstream_status` | Written by the service itself, never passes through the model, cannot be talked into existence |
| wire | Reconstructed from the capture: results paired back to their calls by `tool_call_id`, the channel decided by the *issued URL*, the outcome read from exit code and stderr | Stronger than text matching, but still reconstructed from model-produced text |

When both are available they cross-check, and disagreement in **either** direction
fails the run: a wire-level success with no bridge row means the judge is wrong; a
bridge row the capture never saw means the tap has a hole.

Checks report `PASS`, `FAIL`, or `n/a`. A check with nothing to run against
reports `n/a`, never `PASS`, and `n/a` blocks progress exactly as firmly as
`FAIL`. **Not knowing is not the same as being fine** — an earlier version of the
verifier reported PASS and declared the schema ready to freeze while two of three
channels were false positives, which was more dangerous than reporting failure.

## The team dimension

Using an asset you wrote yourself is a personal note; a local file would do. What
distinguishes a *team* asset system is someone else's asset helping you, and the
injection cost is paid by every person on every turn. So the headline metric is
not the usage rate but the **cross-person reuse rate**, and every event records
the producer and the consumer together.

That edge cannot be backfilled: asset ownership changes and versions roll forward,
so a lookup after the fact returns a different row than the one that was used.

Two rules guard against quiet misreporting:

- When either identity is missing, `relation` is `unknown` — **never** a default of
  `self`, which would erase genuine cross-person use.
- When nothing is attributable, the summary says "not computable" rather than 0%.
  0% reads as *"we measured, and there was none"*; the truth is *"nothing was
  measured"*.

## Running it

```bash
# Observability: can each asset channel be seen at all?
node --test evaluation/gate0/verify-capture.test.mjs
SINCE="2 HOUR" bash evaluation/gate0/export-tool-call-logs.sh
node evaluation/gate0/verify-capture.mjs <capture.jsonl> <tool-call-logs.jsonl>

# Provenance: who wrote it, who used it
bash evaluation/provenance/snapshot-assets.sh
node evaluation/provenance/build-events.mjs <snapshot.json> <tool-call-logs.jsonl> <capture.jsonl>

# Contract conformance
node evaluation/contracts/validate.mjs \
  evaluation/contracts/provenance-event.schema.json \
  evaluation/provenance/artifacts/provenance-events.jsonl
```

Full suite: 50 tests across the three directories.

Each directory has its own README with the details.

## Current status and its limits

Fetches on all three asset channels (skill, memory, knowledge) are now decided by
service-side records rather than by anything the model wrote. Three classes of
false positive each have a regression test holding them shut.

Two limitations are stated rather than buried:

- **The knowledge channel's pass depended on a human supplying the asset id in the
  prompt.** The `<knowledge_tools>` block never reached the system prompt, because
  the injector requires an asset bound in metadata and marked ready, while the test
  wiki was a draft. So the channel is proven *observable*, not *discoverable by the
  model*. Those are different claims.
- **Cross-person reuse is currently zero** — every asset in the pool has the same
  owner. This is reported as a finding, not as unfinished work: the system records
  who created an asset but never records whose asset someone else successfully used.

A configuration note worth recording: the knowledge service ships its own
ClickHouse telemetry writing the *same* `tool_call_logs` table, tagged
`source_tag='knowledge'`. It is off by default and the deploy script did not
forward its settings, so early runs found no rows and nearly concluded none could
exist. **Bypassing the proxy's bridge is not the same as having no telemetry.**
