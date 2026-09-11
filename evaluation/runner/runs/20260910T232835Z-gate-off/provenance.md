# Provenance summary

5 event(s) across 5 asset(s)

| relation | count | meaning |
|---|---|---|
| self | 0 | used one's own asset; not team value |
| cross_agent | 0 | same person, different agent |
| cross_user | 5 | another identity used it — this is team value |
| unknown | 0 | identity missing on one side; undecidable |

| observation | count |
|---|---|
| bridge_only | 3 |
| wire_only | 2 |

Cross-person reuse rate: **100.0%** (cross_user / attributable events).

3 response(s) could not be paired with a service-side row:
  - skl-oBaDO5CceKnr: 1 response(s), 0 row(s) — no service row carries this request
  - skl-sZFb3KatWY6m: 1 response(s), 0 row(s) — no service row carries this request
  - skl-MyrdnecjeYSb: 1 response(s), 0 row(s) — no service row carries this request
Left unpaired rather than matched by position. Borrowing another call's row
would give one event evidence it did not earn and report the other as a gap.

Events written to evaluation/provenance/artifacts/provenance-events.jsonl
