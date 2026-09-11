# Early lifecycle events

| state | events | distinct assets | absent means |
|---|---|---|---|
| recalled | 5 | 5 | — |
| selected | 0 | 0 | **not observed** — no source proved it |
| injected | 5 | 5 | — |

10 event(s) total.

`selected` is empty because no candidate log was supplied. It is deliberately
**not** back-filled from the injected block: knowing which assets were injected
does not establish which assets were candidates.

25 reference(s) named an asset absent from the frozen snapshot:
  - listing:m_1789082575759_b070dd4c ×5
  - listing:m_1789082620819_02e1ff72 ×5
  - listing:m_1789082751740_0f4831af ×5
  - listing:m_1789082879714_ec54b52d ×5
  - listing:m_1789082930776_75e5b90d ×5
These are reported rather than dropped — an asset the snapshot does not know
is either created after the freeze or of a type the snapshot does not cover.

Events written to evaluation/provenance/artifacts/early-events.jsonl
