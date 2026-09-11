# Provenance summary

2 event(s) across 0 asset(s)

| relation | count | meaning |
|---|---|---|
| self | 0 | used one's own asset; not team value |
| cross_agent | 0 | same person, different agent |
| cross_user | 0 | another identity used it — this is team value |
| unknown | 2 | identity missing on one side; undecidable |

| observation | count |
|---|---|
| bridge_only | 2 |

Cross-person reuse rate: **not computable** (no event has both identities).

**1 asset(s) were retrieved that the frozen snapshot does not hold:**
  - skl-pXLc38dex6Zt (eval-tool-result-exit-line) v2, first at message 6
The pool moved after it was frozen — most likely the system auto-extracted a skill
from a finished session. Nothing above attributes to these assets, and nothing
above *screens* against them either; the judge's earliest-delivery rule does. If
one of them carried a token before a credited fetch, that token's use is not
evidence for the credited asset.

Events written to evaluation/provenance/artifacts/provenance-events.jsonl
