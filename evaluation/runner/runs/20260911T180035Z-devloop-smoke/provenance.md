# Provenance summary

4 event(s) across 0 asset(s)

| relation | count | meaning |
|---|---|---|
| self | 0 | used one's own asset; not team value |
| cross_agent | 0 | same person, different agent |
| cross_user | 0 | another identity used it — this is team value |
| unknown | 4 | identity missing on one side; undecidable |

| observation | count |
|---|---|
| bridge_only | 4 |

Cross-person reuse rate: **not computable** (no event has both identities).

3 asset/session pair(s) appeared in the capture but were never retrieved:
  - skl-KPVMV2uB5rXM via skill:search
  - skl-eM1xP28pXiYA via skill:search
  - skl-oBaDO5CceKnr via skill:search
Offered, not fetched. These are **not** written as `fetched` — appearing in a
listing is the retrieval system doing its job, not the model taking the content.
They are recorded as `recalled` / `injected` by build-early-events.mjs.

Events written to evaluation/provenance/artifacts/provenance-events.jsonl
