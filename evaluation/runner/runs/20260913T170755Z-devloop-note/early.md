note: no candidate-log entries read from /Users/vittoriocai/Desktop/Tecent_agentmemory-project4/.claude/worktrees/topic4-gate0/evaluation/provenance/artifacts/candidate-log.jsonl; selected will be absent.
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

38 reference(s) named an asset absent from the frozen snapshot:
  - listing:skl-XAzqAgejM7O4 ×19
  - listing:skl-pXLc38dex6Zt ×19
These are reported rather than dropped — an asset the snapshot does not know
is either created after the freeze or of a type the snapshot does not cover.

Events written to evaluation/provenance/artifacts/early-events.jsonl
