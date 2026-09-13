# Hard-evidence judgement

  0 used, 5 needs_review, from 1 content-bearing fetch(es)

  needs_review  skl-XAzqAgejM7O4                 v?  tool_call
       token bt-pu6nyfhmu2v; the token appears in a search command — the model was looking for it, not using it
       request(447c7c85-98c4-4874-8f60-1fb05d5bb3a9):msg[34]:call_00_mBrwkVoZyPc8ZPsi2EUY7771:arguments
  needs_review  skl-XAzqAgejM7O4                 v?  tool_call
       token bt-pu6nyfhmu2v; the token first reached the model at message 6 via Command: curl -sfk -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/get -H 'content-type: application/json' -H 'x-tdai-service-id: default' -H 'x-conversatio, before the credited fetch — its use cannot be attributed to that fetch
       request(9ebae1c5-6c93-4d79-bad9-1f5afac6863f):msg[45]:call_00_mYNMip7KpTZHVsuSVIF73333:arguments
  needs_review  skl-XAzqAgejM7O4                 v?  tool_call
       token bt-pu6nyfhmu2v; the token first reached the model at message 6 via Command: curl -sfk -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/get -H 'content-type: application/json' -H 'x-tdai-service-id: default' -H 'x-conversatio, before the credited fetch — its use cannot be attributed to that fetch
       request(db170bd9-cad3-4551-9b2f-ffd65b0575f3):msg[47]:call_00_w0cH1uHbQ1yF75H2txiR1109:arguments
  needs_review  skl-XAzqAgejM7O4                 v?  code_change
       token bt-pu6nyfhmu2v; the token first reached the model at message 6 via Command: curl -sfk -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/get -H 'content-type: application/json' -H 'x-tdai-service-id: default' -H 'x-conversatio, before the credited fetch — its use cannot be attributed to that fetch
       diff:evaluation/gate/fetch-resource.mjs:1-74
  needs_review  skl-XAzqAgejM7O4                 v?  code_change
       token bt-pu6nyfhmu2v; the token first reached the model at message 6 via Command: curl -sfk -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/get -H 'content-type: application/json' -H 'x-tdai-service-id: default' -H 'x-conversatio, before the credited fetch — its use cannot be attributed to that fetch
       diff:evaluation/gate/fetch-resource.test.mjs:1-104

1 asset revision(s) were fetched and left no trace in the work:
  - eval-bridge-endpoint-b v4
They stay at `fetched`. Retrieval is not use, and an asset that was read and
ignored is a real outcome — arguably the one a team asset system most needs to
see — so it is reported rather than promoted.

Written to evaluation/attribution/artifacts/used-events.jsonl
