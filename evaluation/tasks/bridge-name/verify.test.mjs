import test from "node:test";
import assert from "node:assert/strict";
import { attempts, outcomeOfAttempt, valueOf, verify } from "./verify.mjs";

const H = "-H 'x-eval-task: team-checklist-lookup'";
const cmd = (id, marker = true) => `curl -sSk -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/get -H 'content-type: application/json' ${marker ? H : ""} -d '{"skill_id": "${id}", "include_content": true}'`;
const req = (messages) => ({ event: "http.request", timestamp: "t", headers: { "x-conversation-id": "c1" }, body: { json: { messages } } });
const call = (id, command) => ({ role: "assistant", tool_calls: [{ id, function: { name: "Bash", arguments: JSON.stringify({ command }) } }] });
const result = (id, text) => ({ role: "tool", tool_call_id: id, content: `Command: x\nStdout: ${text}\nExit Code: 0` });

test("the value of an attempt is the skill_id in its body", () => {
  assert.equal(valueOf(JSON.stringify({ command: cmd("skl-abc") })), "skl-abc");
  assert.equal(valueOf("curl … -d '{\"skill_id\":\"skl-x1\"}'"), "skl-x1");
});

test("success needs code 0 and the checklist marker; refusals fail on content, timeouts on the environment", () => {
  assert.deepEqual(outcomeOfAttempt('Stdout: {"code":0,"data":{"content":"# steps\\nchecklist-marker: qz7-abc12\\n"}}\nExit Code: 0'), { ok: true, why: "code 0, marker qz7-abc12" });
  assert.deepEqual(outcomeOfAttempt('Stdout: {"code":0,"data":{"content":"# steps only"}}\nExit Code: 0'), { ok: false, why: "code 0 but the content carries no checklist-marker" });
  assert.deepEqual(outcomeOfAttempt('Stdout: {"code":40401,"message":"SKILL_NOT_FOUND"}\nExit Code: 0'), { ok: false, why: "service code 40401" });
  assert.deepEqual(outcomeOfAttempt('Stdout: {"code":40301,"message":"not_visible"}\nExit Code: 0'), { ok: false, why: "service code 40301" });
  assert.equal(outcomeOfAttempt("curl: (28) Operation timed out\nExit code: 28").why, "timed out");
});

test("only marked skill/get calls are attempts; get-by-name and discovery calls are not", () => {
  const events = [req([
    { role: "user", content: "go" },
    call("c0", "curl -sSk -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/search -d '{\"query\":\"deploy checklist\"}'"),
    result("c0", '{"code":0,"data":{"items":[]}}'),
    call("c1", cmd("skl-wrong")),
    result("c1", '{"code":40401,"message":"SKILL_NOT_FOUND"}'),
    call("c2", cmd("skl-right", false)),
    result("c2", '{"code":0,"data":{"content":"checklist-marker: qz7-zzz"}}'),
    call("c3", "curl -sSk -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/get-by-name -H 'x-eval-task: team-checklist-lookup' -d '{\"skill_name\":\"x\"}'"),
    result("c3", '{"code":0}'),
    call("c4", cmd("skl-right")),
    result("c4", '{"code":0,"data":{"content":"# steps\\nchecklist-marker: qz7-zzz\\n"}}'),
  ])];
  const tried = attempts(events);
  assert.deepEqual(tried.map((a) => [a.value, a.ok, a.why]), [["skl-wrong", false, "service code 40401"], ["skl-right", true, "code 0, marker qz7-zzz"]]);
  const v = verify(events);
  assert.equal(v.verdict, "PASS");
  assert.match(v.reason, /final get of skl-right succeeded .* after 1 earlier failure/);
});

test("no marked attempt is ERROR, never FAIL", () => {
  assert.equal(verify([req([call("c1", cmd("skl-x", false)), result("c1", '{"code":0}')])]).verdict, "ERROR");
});
