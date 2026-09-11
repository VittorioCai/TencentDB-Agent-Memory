# Provenance summary

7 event(s) across 4 asset(s)

| relation | count | meaning |
|---|---|---|
| self | 0 | used one's own asset; not team value |
| cross_agent | 0 | same person, different agent |
| cross_user | 4 | another identity used it — this is team value |
| unknown | 3 | identity missing on one side; undecidable |

| observation | count |
|---|---|
| bridge_only | 7 |

Cross-person reuse rate: **100.0%** (cross_user / attributable events).

2 asset/session pair(s) appeared in the capture but were never retrieved:
  - skl-eM1xP28pXiYA via skill:search
  - skl-ImeA29HL3Djj via no bridge command
Offered, not fetched. These are **not** written as `fetched` — appearing in a
listing is the retrieval system doing its job, not the model taking the content.
They are recorded as `recalled` / `injected` by build-early-events.mjs.

Events written to evaluation/provenance/artifacts/provenance-events.jsonl
