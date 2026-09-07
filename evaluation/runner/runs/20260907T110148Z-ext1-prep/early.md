# Early lifecycle events

| state | events | distinct assets | absent means |
|---|---|---|---|
| recalled | 24 | 2 | — |
| selected | 23 | 1 | — |
| injected | 2 | 2 | — |

49 event(s) total.

85 reference(s) named an asset absent from the frozen snapshot:
  - listing:m_1788622665051_f4b343bb ×17
  - listing:m_1788694374616_f1eaa1ee ×17
  - listing:m_1788774426366_fc0fad6e ×17
  - listing:m_1788778974133_43a9b8ee ×17
  - listing:m_1788778974134_e46e5ac2 ×17
These are reported rather than dropped — an asset the snapshot does not know
is either created after the freeze or of a type the snapshot does not cover.

Pool moved on since these events (normal; recorded so the difference is visible):
  - skl-lUWmwEYqsZDZ: event v2, snapshot v3

Events written to evaluation/provenance/artifacts/early-events.jsonl
