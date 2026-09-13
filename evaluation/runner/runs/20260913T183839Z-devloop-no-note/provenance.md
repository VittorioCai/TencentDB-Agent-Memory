# Provenance summary

2 event(s) across 2 asset(s)

| relation | count | meaning |
|---|---|---|
| self | 1 | used one's own asset; not team value |
| cross_agent | 0 | same person, different agent |
| cross_user | 1 | another identity used it — this is team value |
| unknown | 0 | identity missing on one side; undecidable |

| observation | count |
|---|---|
| bridge+wire | 2 |

Cross-person reuse rate: **50.0%** (cross_user / attributable events).

2 asset/session pair(s) appeared in the capture but were never retrieved:
  - skl-eM1xP28pXiYA via skill:search
  - skl-sZFb3KatWY6m via no bridge command
Offered, not fetched. These are **not** written as `fetched` — appearing in a
listing is the retrieval system doing its job, not the model taking the content.
They are recorded as `recalled` / `injected` by build-early-events.mjs.

Events written to evaluation/provenance/artifacts/provenance-events.jsonl
