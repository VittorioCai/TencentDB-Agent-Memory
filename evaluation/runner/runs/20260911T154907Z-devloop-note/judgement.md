# Hard-evidence judgement

  2 used, 1 needs_review, from 1 content-bearing fetch(es)

  used          eval-tool-result-exit-line       v1  tool_call
       token bt-imczk9p69e3; content of v1 entered the context at message 6, before this operation at message 37
       request(55bfa5d9-8bb1-4c32-82f1-837cb9fed906):msg[37]:call_00_RHmV4S1O5LcgS05ZIxxI6538:arguments
  used          eval-tool-result-exit-line       v1  test_action
       token bt-imczk9p69e3; content of v1 entered the context at message 6, before this operation at message 39
       request(9572ac62-0815-46c5-87a6-c8d33597c020):msg[39]:call_00_KPRFvvOTwslSEGh2Z7gk0929:arguments
  needs_review  eval-tool-result-exit-line       v?  code_change
       token bt-imczk9p69e3; the token first reached the model at message 6 via Command: curl -sSk -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/get-by-name -H 'content-type: application/json' -H 'x-tdai-service-id: default' -H 'x-con, before the credited fetch — its use cannot be attributed to that fetch
       diff:evaluation/tasks/bridge-addr/verify.exit-status.bt-imczk9p69e3.test.mjs:1-33

Written to evaluation/attribution/artifacts/used-events.jsonl
