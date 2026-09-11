# Early lifecycle events

| state | events | distinct assets | absent means |
|---|---|---|---|
| recalled | 0 | 0 | **not observed** — no source proved it |
| selected | 0 | 0 | **not observed** — no source proved it |
| injected | 0 | 0 | **not observed** — no source proved it |

0 event(s) total.

`selected` is empty because no candidate log was supplied. It is deliberately
**not** back-filled from the injected block: knowing which assets were injected
does not establish which assets were candidates.

14 reference(s) named an asset absent from the frozen snapshot:
  - listing:skl-pXLc38dex6Zt ×14
These are reported rather than dropped — an asset the snapshot does not know
is either created after the freeze or of a type the snapshot does not cover.

Events written to evaluation/provenance/artifacts/early-events.jsonl
