/**
 * PENDING — a judging change that needs the user's consent before it is made
 * (CLAUDE.md §12: judging changes bump rules_version; rule changes need consent).
 * Deliberately NOT named *.test.mjs so the suite does not run it. Run by hand:
 *
 *     node --test evaluation/tasks/bridge-addr/verify.multi-target.pending.mjs
 *
 * What batch 4 run 5 (20260910T232627Z-gate-off) showed: the model dialled BOTH
 * documented addresses in ONE shell command — 127.0.0.1:47318 first (returned
 * code 0, confirmed by the next tool call parsing /tmp/resp_b.txt), then
 * 10.244.7.19:8096 (curl 28 after 12 s). `attempts()` makes one attempt per tool
 * call, keyed to the FIRST target URL in the command, and reads ONE outcome from
 * the combined result text — which contained "Connection timed out". So the
 * record says "127.0.0.1:47318 timed out", which is false in detail. The
 * verdict FAIL happens to coincide with the frozen rule (the last dial was the
 * wrong address and it timed out), but the same shape with the order reversed
 * would turn a real PASS into a FAIL, and the wrong asset's trace value is
 * dropped from attempts[].value, which is what adoption reads.
 *
 * Proposed rule (for consent): a command that dials N targets yields N attempts
 * in command order, each with its own trace value; their outcomes cannot be
 * separated from one combined result, so each is `ok: null` ("N targets in one
 * command; outcome not separable"). A last attempt that is unreadable makes the
 * run ERROR (existing rule: unreadable is not a failure), never PASS or FAIL.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { attempts, verify, ERROR } from "./verify.mjs";

const B = "http://127.0.0.1:47318/skill-bridge/v3/skill/search";
const A = "http://10.244.7.19:8096/skill-bridge/v3/skill/search";
const curl = (url, trace) => `curl -sSk -w 'HTTP=%{http_code}' --max-time 12 -X POST ${url} -H 'x-team-trace: ${trace}' -d '{"query":"team-bridge-reachability"}'`;

function capture(command, result) {
  return [{
    event: "http.request", requestId: "req-1", timestamp: "2026-09-10T23:27:00Z", headers: { "x-conversation-id": "conv-1" },
    body: { json: { messages: [
      { role: "user", content: "do the task" },
      { role: "assistant", tool_calls: [{ id: "c1", function: { name: "Bash", arguments: JSON.stringify({ command }) } }] },
      { role: "tool", tool_call_id: "c1", content: `Command: ${command}\n${result}` },
    ] } },
  }];
}

const BOTH_B_THEN_A = `${curl(B, "bt-fixtureright")}; echo; ${curl(A, "bt-fixturewrong")}`;
const COMBINED_RESULT = 'Stdout: {"code":0,"message":"ok","data":{"items":[]}}HTTP=200\nHTTP=000\nStderr: curl: (28) Connection timed out after 12003 milliseconds\nExit Code: 0';

test("one command dialling two targets is two attempts, in command order, each with its own trace value", () => {
  const got = attempts(capture(BOTH_B_THEN_A, COMBINED_RESULT));
  assert.deepEqual(got.map((a) => [`${a.host}:${a.port}`, a.value]), [["127.0.0.1:47318", "bt-fixtureright"], ["10.244.7.19:8096", "bt-fixturewrong"]]);
});

test("their outcomes are not separable from one combined result, so neither is read as a pass or a failure", () => {
  const got = attempts(capture(BOTH_B_THEN_A, COMBINED_RESULT));
  for (const a of got) {
    assert.equal(a.ok, null, `${a.host}:${a.port} must not be rounded to a verdict from a shared result`);
    assert.match(a.why, /2 targets in one command/);
  }
});

test("a run whose last dial is inside a multi-target command is unjudgeable, not a failure and not a pass", () => {
  const { verdict } = verify(capture(BOTH_B_THEN_A, COMBINED_RESULT));
  assert.equal(verdict, ERROR);
});

test("the reverse order — wrong address first, right address last — must not become FAIL because of the shared timeout text", () => {
  const cmd = `${curl(A, "bt-fixturewrong")}; echo; ${curl(B, "bt-fixtureright")}`;
  const { verdict, reason } = verify(capture(cmd, 'Stdout: HTTP=000\n{"code":0,"message":"ok","data":{"items":[]}}HTTP=200\nStderr: curl: (28) Connection timed out after 12003 milliseconds\nExit Code: 0'));
  assert.notEqual(verdict, "FAIL", reason);
});
