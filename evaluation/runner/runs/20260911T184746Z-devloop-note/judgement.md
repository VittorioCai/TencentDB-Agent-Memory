# Hard-evidence judgement

  1 used, 2 needs_review, from 1 content-bearing fetch(es)

  used          eval-tool-result-exit-line       v2  tool_call
       token bt-78yk9r3bfrm; content of v2 entered the context at message 6, before this operation at message 39
       request(64763d1c-bbda-4370-9540-e514ac82f5e6):msg[39]:call_00_NKUFu2qWxVXTlBsiWqFF9183:arguments
  needs_review  eval-tool-result-exit-line       v?  test_action
       token bt-78yk9r3bfrm; the token appears in a search command — the model was looking for it, not using it
       request(4c3708b8-7348-4790-b0cf-f1aff1fd2b2b):msg[43]:call_00_qNZkwI2y5Vjw66RCQeR73033:arguments
  needs_review  eval-tool-result-exit-line       v?  code_change
       token bt-78yk9r3bfrm; the token first reached the model at message 6 via Command: curl -sSk -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/get-by-name -H 'content-type: application/json' -H 'x-tdai-service-id: default' -H 'x-con, before the credited fetch — its use cannot be attributed to that fetch
       diff:evaluation/tasks/bridge-addr/verify.exit-status.bt-78yk9r3bfrm.test.mjs:1-61

Written to evaluation/attribution/artifacts/used-events.jsonl
