# Hard-evidence judgement

  0 used, 3 needs_review, from 1 content-bearing fetch(es)

  needs_review  skl-XAzqAgejM7O4                 v?  tool_call
       token bt-pu6nyfhmu2v; the token appears in a search command — the model was looking for it, not using it
       request(be71d24a-d8a7-48fe-9822-2b07afa2ec1b):msg[33]:call_00_8kCQHmHRIBXeoN7sbQKc2538:arguments
  needs_review  skl-XAzqAgejM7O4                 v?  tool_call
       token bt-pu6nyfhmu2v; the token first reached the model at message 6 via Command: curl -sSk -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/get -H 'content-type: application/json' -H 'x-tdai-service-id: default' -H 'x-conversatio, before the credited fetch — its use cannot be attributed to that fetch
       request(33bd9fee-b0ec-4b59-b886-0538d2851100):msg[44]:call_00_ET_qEO8tOFxZta7iXdh9lxN1438:arguments
  needs_review  skl-XAzqAgejM7O4                 v?  code_change
       token bt-pu6nyfhmu2v; the token first reached the model at message 6 via Command: curl -sSk -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/get -H 'content-type: application/json' -H 'x-tdai-service-id: default' -H 'x-conversatio, before the credited fetch — its use cannot be attributed to that fetch
       diff:evaluation/gate/fetch-resource.mjs:1-64

1 asset revision(s) were fetched and left no trace in the work:
  - eval-bridge-endpoint-b v4
They stay at `fetched`. Retrieval is not use, and an asset that was read and
ignored is a real outcome — arguably the one a team asset system most needs to
see — so it is reported rather than promoted.

Written to evaluation/attribution/artifacts/used-events.jsonl
