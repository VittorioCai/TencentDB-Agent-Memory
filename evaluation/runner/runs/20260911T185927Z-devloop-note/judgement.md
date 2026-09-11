# Hard-evidence judgement

  2 used, 2 needs_review, from 1 content-bearing fetch(es)

  used          eval-tool-result-exit-line       v2  tool_call
       token bt-78yk9r3bfrm; content of v2 entered the context at message 9, before this operation at message 33
       request(528b0aae-83ff-4d85-b023-6795dbe8a8cc):msg[33]:call_00_Lf2EC7uc1RWloW24iwxR5255:arguments
  used          eval-tool-result-exit-line       v2  tool_call
       token bt-78yk9r3bfrm; content of v2 entered the context at message 9, before this operation at message 49
       request(30e5c32d-64b1-4d0a-af39-be24ed18c310):msg[49]:call_00_3x5sdtewNgqBrA4rCkW45599:arguments
  needs_review  eval-tool-result-exit-line       v?  tool_call
       token bt-78yk9r3bfrm; the token appears in a search command — the model was looking for it, not using it
       request(b3bfcfed-1fe4-4306-912d-4620b2b123c9):msg[19]:call_00_OgGgYeA1ehhEcZpbYbIY5025:arguments
  needs_review  eval-tool-result-exit-line       v?  code_change
       token bt-78yk9r3bfrm; the token first reached the model at message 9 via Command: curl -sSk -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/get-by-name -H 'content-type: application/json' -H 'x-tdai-service-id: default' -H 'x-con, before the credited fetch — its use cannot be attributed to that fetch
       diff:evaluation/attribution/collect-artifacts.test.mjs:1-58

Written to evaluation/attribution/artifacts/used-events.jsonl
