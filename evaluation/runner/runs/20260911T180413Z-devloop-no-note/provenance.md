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
| wire_only | 2 |

Cross-person reuse rate: **50.0%** (cross_user / attributable events).

3 asset/session pair(s) appeared in the capture but were never retrieved:
  - skl-KPVMV2uB5rXM via skill:search
  - skl-sZFb3KatWY6m via no bridge command
  - skl-MyrdnecjeYSb via skill:get-by-name
Offered, not fetched. These are **not** written as `fetched` — appearing in a
listing is the retrieval system doing its job, not the model taking the content.
They are recorded as `recalled` / `injected` by build-early-events.mjs.

2 response(s) could not be paired with a service-side row:
  - skl-eM1xP28pXiYA: 1 response(s), 0 row(s) — no service row carries this request
  - skl-oBaDO5CceKnr: 1 response(s), 0 row(s) — no service row carries this request
Left unpaired rather than matched by position. Borrowing another call's row
would give one event evidence it did not earn and report the other as a gap.

Events written to evaluation/provenance/artifacts/provenance-events.jsonl
