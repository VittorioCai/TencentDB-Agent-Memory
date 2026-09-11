# Early lifecycle events

| state | events | distinct assets | absent means |
|---|---|---|---|
| recalled | 4 | 4 | — |
| selected | 0 | 0 | **not observed** — no source proved it |
| injected | 4 | 4 | — |

8 event(s) total.

`selected` is empty because no candidate log was supplied. It is deliberately
**not** back-filled from the injected block: knowing which assets were injected
does not establish which assets were candidates.

24 reference(s) named an asset absent from the frozen snapshot:
  - listing:m_1789081556879_7a8dded2 ×3
  - listing:m_1789082054972_74dc24bd ×3
  - listing:m_1789082620819_02e1ff72 ×3
  - listing:m_1789082620819_d2668fbf ×3
  - listing:m_1789082697604_81afce07 ×3
  - listing:m_1789082697604_f08fb410 ×3
  - listing:m_1789082713595_34bfa35f ×3
  - listing:m_1789082751740_0f4831af ×3
These are reported rather than dropped — an asset the snapshot does not know
is either created after the freeze or of a type the snapshot does not cover.

Events written to evaluation/provenance/artifacts/early-events.jsonl
