# Provenance summary

2 event(s) across 0 asset(s)

| relation | count | meaning |
|---|---|---|
| self | 0 | used one's own asset; not team value |
| cross_agent | 0 | same person, different agent |
| cross_user | 0 | another identity used it — this is team value |
| unknown | 2 | identity missing on one side; undecidable |

| observation | count |
|---|---|
| bridge_only | 2 |

Cross-person reuse rate: **not computable** (no event has both identities).

2 asset/session pair(s) appeared in the capture but were never retrieved:
  - skl-sZFb3KatWY6m via no bridge command
  - skl-oBaDO5CceKnr via no bridge command
Offered, not fetched. These are **not** written as `fetched` — appearing in a
listing is the retrieval system doing its job, not the model taking the content.
They are recorded as `recalled` / `injected` by build-early-events.mjs.

Events written to evaluation/provenance/artifacts/provenance-events.jsonl
