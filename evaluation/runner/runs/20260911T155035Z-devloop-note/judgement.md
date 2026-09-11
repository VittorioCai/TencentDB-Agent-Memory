# Hard-evidence judgement

  2 used, 1 needs_review, from 1 content-bearing fetch(es)

  used          eval-tool-result-exit-line       v1  tool_call
       token bt-imczk9p69e3; content of v1 entered the context at message 6, before this operation at message 18
       request(7a82aaec-c196-4c73-99b5-dae97b2c0877):msg[18]:call_00_FyIgEjn7omrGZtlb2DKJ4738:arguments
  used          eval-tool-result-exit-line       v1  test_action
       token bt-imczk9p69e3; content of v1 entered the context at message 6, before this operation at message 20
       request(f37aff64-5369-4bf1-9732-606e0fef5c32):msg[20]:call_00_NkcZfb0Uq36JNewscK1e8738:arguments
  needs_review  eval-tool-result-exit-line       v?  code_change
       token bt-imczk9p69e3; the token first reached the model at message 6 via Command: curl -sSk -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/get-by-name -H 'content-type: application/json' -H 'x-tdai-service-id: default' -H 'x-con, before the credited fetch — its use cannot be attributed to that fetch
       diff:evaluation/tasks/bridge-addr/verify.exit-status.bt-imczk9p69e3.test.mjs:1-41

Written to evaluation/attribution/artifacts/used-events.jsonl
