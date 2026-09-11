# Provenance summary

1 event(s) across 1 asset(s)

| relation | count | meaning |
|---|---|---|
| self | 0 | used one's own asset; not team value |
| cross_agent | 0 | same person, different agent |
| cross_user | 1 | another identity used it — this is team value |
| unknown | 0 | identity missing on one side; undecidable |

| observation | count |
|---|---|
| wire_only | 1 |

Cross-person reuse rate: **100.0%** (cross_user / attributable events).

2 asset/session pair(s) appeared in the capture but were never retrieved:
  - skl-ImeA29HL3Djj via no bridge command
  - skl-sZFb3KatWY6m via no bridge command
Offered, not fetched. These are **not** written as `fetched` — appearing in a
listing is the retrieval system doing its job, not the model taking the content.
They are recorded as `recalled` / `injected` by build-early-events.mjs.

1 response(s) could not be paired with a service-side row:
  - skl-pXLc38dex6Zt: 1 response(s), 0 row(s) — no service row carries this request
Left unpaired rather than matched by position. Borrowing another call's row
would give one event evidence it did not earn and report the other as a gap.

Events written to evaluation/provenance/artifacts/provenance-events.jsonl
