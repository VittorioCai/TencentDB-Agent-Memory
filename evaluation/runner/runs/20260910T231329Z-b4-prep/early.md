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

7 reference(s) named an asset absent from the frozen snapshot:
  - listing:m_1789081556879_7a8dded2 ×7
These are reported rather than dropped — an asset the snapshot does not know
is either created after the freeze or of a type the snapshot does not cover.

Pool moved on since these events (normal; recorded so the difference is visible):
  - skl-oBaDO5CceKnr: event v4, snapshot v3
  - skl-sZFb3KatWY6m: event v4, snapshot v3

Events written to evaluation/provenance/artifacts/early-events.jsonl
