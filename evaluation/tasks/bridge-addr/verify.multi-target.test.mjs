/**
 * Acceptance when one tool call carries more than one request, and when the
 * final requests were issued together.
 *
 * Batch 4 run 5 (20260910T232627Z-gate-off): one Bash command dialled
 * 127.0.0.1:47318 (code 0, confirmed by the next tool call parsing
 * /tmp/resp_b.txt) and then 10.244.7.19:8096 (curl 28 after 12 s). The old
 * parser made one attempt keyed to the first URL and read one outcome from the
 * combined text: "127.0.0.1:47318 timed out" — false in detail. Runs 1 and 3
 * issued the wrong and the right dial as two tool calls in ONE model message;
 * the service log shows the right one answered 53 ms after the message while
 * the wrong one ran into its 20 s timeout, so "the last attempt" cannot be
 * read off the text order.
 *
 * Four boundaries (2026-09-11):
 *   1. every actual request binds its own address, trace and outcome; one tool
 *      call may hold several;
 *   2. an outcome confirmed by an independent response (the service's own log)
 *      or by a file the model read back is judged normally; an outcome that
 *      cannot be separated stays unknown;
 *   3. `&&`, conditionals, loops and concurrently issued calls do not let the
 *      text order stand in for execution order or for "the last one";
 *   4. a task request is recognised from the parsed action and request fields
 *      (POST to the search path with the task query), never from the whole
 *      command containing the marker, and never only when the address or the
 *      trace happens to be the right one.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { attempts, verify, PASS, FAIL, ERROR, TASK_MARKER } from "./verify.mjs";

const B = "http://127.0.0.1:47318/skill-bridge/v3/skill/search";
const A = "http://10.244.7.19:8096/skill-bridge/v3/skill/search";
const curl = (url, trace, extra = "") => `curl -sSk ${extra} -X POST ${url} -H 'content-type: application/json' -H 'x-team-trace: ${trace}' -d '{"query": "${TASK_MARKER}"}'`;
const OK_ENVELOPE = '{"code":0,"message":"ok","request_id":"req-1","data":{"items":[]}}';

/**
 * A captured session. Each step is one assistant message; `calls` are the tool
 * calls it issued together, each with the command and the result text that came
 * back. Timestamps follow batch 4: message k is produced at T0 + 10k seconds
 * and its results are sent back 12 seconds later.
 */
function session(steps) {
  const rows = [];
  const messages = [{ role: "user", content: "do the task" }];
  let t = Date.parse("2026-09-10T23:26:30Z");
  let n = 0;
  rows.push({ event: "http.request", requestId: "r0", timestamp: new Date(t).toISOString(), headers: { "x-conversation-id": "conv-1" }, body: { json: { messages: [...messages] } } });
  for (const step of steps) {
    t += 2000;
    rows.push({ event: "http.response", requestId: `r${n}`, timestamp: new Date(t).toISOString(), body: { text: "" } });
    const calls = step.calls.map((c, i) => ({ id: c.id ?? `c${n}_${i}`, ...c }));
    messages.push({ role: "assistant", tool_calls: calls.map((c) => ({ id: c.id, function: { name: "Bash", arguments: JSON.stringify({ command: c.command }) } })) });
    for (const c of calls) if (c.result !== undefined) messages.push({ role: "tool", tool_call_id: c.id, content: `Command: ${c.command}\n${c.result}` });
    t += step.took ?? 12000; n += 1;
    rows.push({ event: "http.request", requestId: `r${n}`, timestamp: new Date(t).toISOString(), headers: { "x-conversation-id": "conv-1" }, body: { json: { messages: [...messages] } } });
  }
  return rows;
}

/** Service-side rows, in the log's own local clock (UTC+8 on the batch host). */
const local = (isoUtc, plusMs = 0) => {
  const d = new Date(Date.parse(isoUtc) + plusMs + 8 * 3600 * 1000);
  return d.toISOString().replace("T", " ").replace("Z", "");
};
const intentRow = (isoUtc, command) => ({ timestamp: local(isoUtc), kind: "model_intent", initiated_tool: "Bash", request_body: JSON.stringify({ command }) });
const answeredRow = (isoUtc, plusMs, query = TASK_MARKER, status = 200) => ({ timestamp: local(isoUtc, plusMs), kind: "bridge_call", executed_endpoint: "search", upstream_status: status, elapsed_ms: 4, request_body: JSON.stringify({ query, team_id: "t" }) });
const REACH = { targets: { "127.0.0.1:47318": { ok: true, why: "tcp connect ok" }, "10.244.7.19:8096": { ok: false, why: "timed out" } } };

// ── boundary 1 & 4: what counts as a request ─────────────────────

test("one command, two dials: two attempts in shell order, each with its own address and trace", () => {
  const cmd = `${curl(B, "bt-fixtureright")}\necho\n${curl(A, "bt-fixturewrong")}`;
  const got = attempts(session([{ calls: [{ command: cmd, result: `Stdout: ${OK_ENVELOPE}\nStderr: curl: (28) Connection timed out after 12003 milliseconds\nExit Code: 0` }] }]));
  assert.deepEqual(got.map((a) => [`${a.host}:${a.port}`, a.value, a.request_index]), [["127.0.0.1:47318", "bt-fixtureright", 0], ["10.244.7.19:8096", "bt-fixturewrong", 1]]);
  assert.ok(got.every((a) => a.call_id === got[0].call_id));
});

test("a search whose query merely contains the marker is not the task request; the task request is the one whose query IS the marker", () => {
  const search = `curl -sSk -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/search -d '{"query": "reachability check ${TASK_MARKER}"}'`;
  assert.equal(attempts(session([{ calls: [{ command: search, result: `Stdout: ${OK_ENVELOPE}\nExit Code: 0` }] }])).length, 0);
  assert.equal(attempts(session([{ calls: [{ command: curl(B, "bt-x"), result: `Stdout: ${OK_ENVELOPE}\nExit Code: 0` }] }])).length, 1);
});

test("a loop with a variable body is not identifiable as the task request and is reported, not counted", () => {
  const loop = `for q in "a" "${TASK_MARKER}"; do curl -sSk -X POST ${B} -d "{\\"query\\": \\"$q\\"}"; done`;
  const r = verify(session([{ calls: [{ command: loop, result: `Stdout: ${OK_ENVELOPE}\nExit Code: 0` }] }]));
  assert.equal(r.attempts.length, 0);
  assert.equal(r.verdict, ERROR);
  assert.ok(r.problems.some((p) => /loop|not literal/i.test(p)), JSON.stringify(r.problems));
});

test("a request to the wrong address with the wrong trace is still a request — nothing filters on being right", () => {
  const got = attempts(session([{ calls: [{ command: curl(A, "bt-fixturewrong"), result: "Stdout: \nStderr: curl: (28) Connection timed out after 20001 milliseconds\nExit code: 28" }] }]));
  assert.equal(got.length, 1);
  assert.equal(got[0].ok, false);
});

// ── boundary 2: outcomes only from evidence that separates them ──

test("with nothing to separate them, two dials in one command are both unknown and the run is unjudgeable", () => {
  const cmd = `${curl(B, "bt-r")}\n${curl(A, "bt-w")}`;
  const r = verify(session([{ calls: [{ command: cmd, result: `Stdout: ${OK_ENVELOPE}\nStderr: curl: (28) Connection timed out after 12003 milliseconds\nExit Code: 0` }] }]));
  assert.deepEqual(r.attempts.map((a) => a.ok), [null, null]);
  assert.equal(r.verdict, ERROR);
  assert.match(r.reason, /not separable/);
});

test("a file the model wrote with -o and read back in a later call confirms that request's outcome", () => {
  const cmd = `${curl(B, "bt-r", "-o /tmp/resp_b.txt")}\n${curl(A, "bt-w", "-o /tmp/resp_a.txt")}`;
  const cap = session([
    { calls: [{ command: cmd, result: "Stdout: HTTP=200\nHTTP=000\nStderr: curl: (28) Connection timed out\nExit Code: 0" }] },
    { calls: [{ command: `python3 -c 'import json; print(json.load(open("/tmp/resp_b.txt")))'`, result: `Stdout: ${OK_ENVELOPE}\nExit Code: 0` }] },
  ]);
  const got = attempts(cap);
  assert.equal(got[0].ok, true);
  assert.match(got[0].evidence.join(" "), /resp_b\.txt/);
  assert.equal(got[1].ok, null);
});

test("the service's own log separates them: one answered row in the call's window binds the envelope to the only reachable address, the curl 28 to the only unreachable one, and shell order makes the last one decide", () => {
  const cmd = `${curl(B, "bt-r")}\necho\n${curl(A, "bt-w")}`;
  const cap = session([{ calls: [{ command: cmd, result: `Stdout: ${OK_ENVELOPE}\nHTTP=000\nStderr: curl: (28) Connection timed out after 12003 milliseconds\nExit Code: 0` }] }]);
  const t0 = cap.find((e) => e.event === "http.response").timestamp;
  const rows = [intentRow(t0, cmd), answeredRow(t0, 100)];
  const r = verify(cap, { serviceRows: rows, reachability: REACH });
  assert.deepEqual(r.attempts.map((a) => [`${a.host}:${a.port}`, a.ok, a.why]), [["127.0.0.1:47318", true, "code 0"], ["10.244.7.19:8096", false, "timed out"]]);
  assert.ok(r.attempts[0].executed_at, "the answered request carries the service time");
  assert.equal(r.verdict, FAIL);
  assert.match(r.reason, /10\.244\.7\.19:8096/);
});

test("two answered requests with the same body: when every answer and every envelope agree they are both confirmed; when they disagree neither can be attributed", () => {
  const cmd = `${curl(B, "bt-r")}\n${curl("http://127.0.0.1:8096/skill-bridge/v3/skill/search", "bt-r2")}`;
  const reach = { targets: { "127.0.0.1:47318": { ok: true }, "127.0.0.1:8096": { ok: true } } };
  const agree = session([{ calls: [{ command: cmd, result: `Stdout: ${OK_ENVELOPE}${OK_ENVELOPE}\nExit Code: 0` }] }]);
  const t0 = agree.find((e) => e.event === "http.response").timestamp;
  const ra = verify(agree, { serviceRows: [intentRow(t0, cmd), answeredRow(t0, 50), answeredRow(t0, 90)], reachability: reach });
  assert.deepEqual(ra.attempts.map((a) => a.ok), [true, true]);
  const mixed = session([{ calls: [{ command: cmd, result: `Stdout: ${OK_ENVELOPE}{"code":40101,"message":"refused"}\nExit Code: 0` }] }]);
  const t1 = mixed.find((e) => e.event === "http.response").timestamp;
  const rm = verify(mixed, { serviceRows: [intentRow(t1, cmd), answeredRow(t1, 50), answeredRow(t1, 90)], reachability: reach });
  assert.deepEqual(rm.attempts.map((a) => a.ok), [null, null]);
  assert.equal(rm.verdict, ERROR);
});

test("one request per call keeps the whole result as its outcome, as before", () => {
  const r = verify(session([{ calls: [{ command: curl(B, "bt-r"), result: `Stdout: ${OK_ENVELOPE}\nExit Code: 0` }] }]));
  assert.equal(r.verdict, PASS);
  assert.equal(r.attempts[0].ok, true);
});

// ── boundary 3: order is not the text order ──────────────────────

test("two calls issued in one model message with different outcomes have no last one: unjudgeable, with both outcomes on record", () => {
  const cap = session([{ calls: [
    { command: curl(A, "bt-w", "-m 20"), result: "Stdout: \nStderr: curl: (28) Connection timed out after 20001 milliseconds\nExit code: 28" },
    { command: curl(B, "bt-r"), result: `Stdout: ${OK_ENVELOPE}\nExit Code: 0` },
  ], took: 20200 }]);
  const r = verify(cap);
  assert.deepEqual(r.attempts.map((a) => a.ok), [false, true]);
  assert.equal(r.verdict, ERROR);
  assert.match(r.reason, /issued together|concurrent/);
  assert.deepEqual(r.final_batch, { ok: 1, failed: 1, unknown: 0 });
});

test("two calls issued together whose outcomes agree are decided by that outcome", () => {
  const cap = session([{ calls: [
    { command: curl(B, "bt-r"), result: `Stdout: ${OK_ENVELOPE}\nExit Code: 0` },
    { command: curl(B, "bt-r"), result: `Stdout: ${OK_ENVELOPE}\nExit Code: 0` },
  ] }]);
  assert.equal(verify(cap).verdict, PASS);
});

test("a later message is later: a failure in an earlier message and a success in the last one is a pass", () => {
  const cap = session([
    { calls: [{ command: curl(A, "bt-w"), result: "Stdout: \nStderr: curl: (28) Connection timed out\nExit code: 28" }] },
    { calls: [{ command: curl(B, "bt-r"), result: `Stdout: ${OK_ENVELOPE}\nExit Code: 0` }] },
  ]);
  const r = verify(cap);
  assert.equal(r.verdict, PASS);
  assert.match(r.reason, /after 1 earlier failure/);
});

test("a backgrounded request in the final call has no order even when its outcome is known", () => {
  const cmd = `${curl(A, "bt-w")} &\n${curl(B, "bt-r")}\nwait`;
  const r = verify(session([{ calls: [{ command: cmd, result: `Stdout: ${OK_ENVELOPE}\nStderr: curl: (28) Connection timed out\nExit Code: 0` }] }]));
  assert.equal(r.verdict, ERROR);
});

test("the verdict names its parser version", () => {
  const r = verify(session([{ calls: [{ command: curl(B, "bt-r"), result: `Stdout: ${OK_ENVELOPE}\nExit Code: 0` }] }]));
  assert.match(r.acceptance_version, /^attempts-2026-09-11/);
});
