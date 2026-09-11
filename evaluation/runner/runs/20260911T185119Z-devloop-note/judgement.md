# Hard-evidence judgement

  2 used, 2 needs_review, from 1 content-bearing fetch(es)

  used          eval-tool-result-exit-line       v2  tool_call
       token bt-78yk9r3bfrm; content of v2 entered the context at message 6, before this operation at message 49
       request(65bf6d2d-6ec1-4499-9a4d-f80aa08cdb7c):msg[49]:call_00_CVWhmo1kFCv8Dfj2NfOQ0304:arguments
  used          eval-tool-result-exit-line       v2  test_action
       token bt-78yk9r3bfrm; content of v2 entered the context at message 6, before this operation at message 55
       request(fd491303-8b4d-48ad-96f4-966951281444):msg[55]:call_00_MjJXERZf6WwjUvmaDEq62067:arguments
  needs_review  eval-tool-result-exit-line       v?  tool_call
       token bt-78yk9r3bfrm; the token appears in a search command — the model was looking for it, not using it
       request(404f44b5-b63f-4d5f-9f59-25df692a9b9b):msg[29]:call_00_4qPaBfQr9qOfWo77heAe7302:arguments
  needs_review  eval-tool-result-exit-line       v?  code_change
       token bt-78yk9r3bfrm; the token first reached the model at message 6 via Command: curl -sSk -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/get-by-name -H 'content-type: application/json' -H 'x-tdai-service-id: default' -H 'x-con, before the credited fetch — its use cannot be attributed to that fetch
       diff:evaluation/attribution/collect-artifacts.exit-status.bt-78yk9r3bfrm.test.mjs:1-62

Written to evaluation/attribution/artifacts/used-events.jsonl
