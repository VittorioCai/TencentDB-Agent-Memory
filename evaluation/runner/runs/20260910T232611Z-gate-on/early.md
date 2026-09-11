# Early lifecycle events

| state | events | distinct assets | absent means |
|---|---|---|---|
| recalled | 3 | 3 | — |
| selected | 0 | 0 | **not observed** — no source proved it |
| injected | 3 | 3 | — |

6 event(s) total.

`selected` is empty because no candidate log was supplied. It is deliberately
**not** back-filled from the injected block: knowing which assets were injected
does not establish which assets were candidates.

Events written to evaluation/provenance/artifacts/early-events.jsonl
