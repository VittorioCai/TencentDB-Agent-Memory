# Provenance summary

1 event(s) across 1 asset(s)

| relation | count | meaning |
|---|---|---|
| self | 1 | used one's own asset; not team value |
| cross_agent | 0 | same person, different agent |
| cross_user | 0 | another identity used it — this is team value |
| unknown | 0 | identity missing on one side; undecidable |

| observation | count |
|---|---|
| wire_only | 1 |

Cross-person reuse rate: **0.0%** (cross_user / attributable events).

Zero here is a finding, not an omission: the system has **never produced
a single cross-person reuse record**. It logs who created an asset but never
logs whose asset someone else successfully used.

2 asset/session pair(s) appeared in the capture but were never retrieved:
  - skl-eM1xP28pXiYA via skill:search
  - skl-oBaDO5CceKnr via skill:search
Offered, not fetched. These are **not** written as `fetched` — appearing in a
listing is the retrieval system doing its job, not the model taking the content.
They are recorded as `recalled` / `injected` by build-early-events.mjs.

1 response(s) could not be paired with a service-side row:
  - skl-KPVMV2uB5rXM: 1 response(s), 0 row(s) — no service row carries this request
Left unpaired rather than matched by position. Borrowing another call's row
would give one event evidence it did not earn and report the other as a gap.

Events written to evaluation/provenance/artifacts/provenance-events.jsonl
