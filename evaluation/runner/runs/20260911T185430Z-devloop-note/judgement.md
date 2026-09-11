# Hard-evidence judgement

  0 used, 2 needs_review, from 1 content-bearing fetch(es)

  needs_review  eval-tool-result-exit-line       v?  tool_call
       token bt-78yk9r3bfrm; the token appears in a search command — the model was looking for it, not using it
       request(b79b406e-8248-4f60-ad29-1b355ee2c410):msg[44]:call_00_wFQ86d95Szp0AQZgfwbP6195:arguments
  needs_review  eval-tool-result-exit-line       v?  code_change
       token bt-78yk9r3bfrm; the token first reached the model at message 6 via Command: curl -sSk -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/get-by-name -H 'content-type: application/json' -H 'x-tdai-service-id: default' -H 'x-con, before the credited fetch — its use cannot be attributed to that fetch
       diff:evaluation/attribution/collect-artifacts.test.mjs:1-74

1 asset revision(s) were fetched and left no trace in the work:
  - eval-tool-result-exit-line v2
They stay at `fetched`. Retrieval is not use, and an asset that was read and
ignored is a real outcome — arguably the one a team asset system most needs to
see — so it is reported rather than promoted.

Written to evaluation/attribution/artifacts/used-events.jsonl
