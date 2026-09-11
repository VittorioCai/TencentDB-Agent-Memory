# Early lifecycle events

| state | events | distinct assets | absent means |
|---|---|---|---|
| recalled | 1 | 1 | — |
| selected | 0 | 0 | **not observed** — no source proved it |
| injected | 1 | 1 | — |

2 event(s) total.

`selected` is empty because no candidate log was supplied. It is deliberately
**not** back-filled from the injected block: knowing which assets were injected
does not establish which assets were candidates.

Pool moved on since these events (normal; recorded so the difference is visible):
  - skl-pXLc38dex6Zt: event v2, snapshot v1

Events written to evaluation/provenance/artifacts/early-events.jsonl
