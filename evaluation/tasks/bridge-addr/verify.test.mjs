/**
 * Acceptance tests.
 *
 * Each case is a rule that sounds reasonable and gets the verdict wrong: "some
 * call returned 200", "it succeeded at some point", "it never failed", "there
 * was no successful call so it failed".
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { verify, attempts, outcomeOfAttempt, PASS, FAIL, ERROR } from "./verify.mjs";

import { TASK_MARKER } from "./verify.mjs";

const TARGET_OK = "http://127.0.0.1:47318/skill-bridge/v3/skill/search";
const TARGET_BAD = "http://10.244.7.19:8096/skill-bridge/v3/skill/search";
const READ = "http://127.0.0.1:8096/skill-bridge/v3/skill/get-by-name";

const OK_BODY = 'Stdout: {"code":0,"message":"ok","data":{"items":[]}}\nHTTP_CODE: 200';
const TIMEOUT = "Exit code: 28\nStdout: \nStderr: curl: (28) Operation timed out after 75000 ms";

/** The command the model wrote, as it appears in the tool call's arguments. */
const cmdFor = (url, query) =>
  JSON.stringify({ command: `curl -sSk -X POST ${url} -d '{"query":"${query}"}'` });

/**
 * A captured session. Each step is a call the model made, optionally with the
 * result that came back — `body: null` means the result was never captured,
 * which the attempt list has to survive.
 */
function session(steps) {
  const messages = [{ role: "user", content: "do the task" }];
  steps.forEach(({ url, body, query = TASK_MARKER }, i) => {
    messages.push({
      role: "assistant",
      tool_calls: [{ id: `c${i}`, function: { name: "Bash", arguments: cmdFor(url, query) } }],
    });
    if (body !== null) {
      messages.push({
        role: "tool", tool_call_id: `c${i}`,
        content: `Command: curl -sSk -X POST ${url} -d '{"query":"${query}"}'\n${body}`,
      });
    }
  });
  return [{
    event: "http.request",
    requestId: "req-1",
    timestamp: "2026-09-05T12:00:00Z",
    headers: { "x-conversation-id": "conv-1" },
    body: { json: { messages } },
  }];
}

// ── the four outcomes ─────────────────────────────────────────────

test("a successful prerequisite read does not make a timed-out target pass", () => {
  // "Some call in this session returned 200" is true here, and the 200 is the
  // model fetching the asset that told it which address to use.
  const r = verify(session([
    { url: READ, body: OK_BODY },
    { url: TARGET_BAD, body: TIMEOUT },
  ]));
  assert.equal(r.verdict, FAIL);
  assert.equal(r.attempts.length, 1, "reading the asset is a bridge call too, but it is not the target");
  assert.match(r.reason, /timed out/);
});

test("succeeding early and failing at the end is a failure", () => {
  // "It succeeded at some point" is true and the run did not work.
  const r = verify(session([
    { url: TARGET_OK, body: OK_BODY },
    { url: TARGET_OK, body: TIMEOUT },
  ]));
  assert.equal(r.verdict, FAIL);
  assert.match(r.reason, /despite 1 earlier success/);
});

test("failing first and succeeding last is a pass", () => {
  // "It never failed" is false and the run did work. Retrying after an error is
  // ordinary behaviour; a rule that punishes it is measuring neatness.
  const r = verify(session([
    { url: TARGET_BAD, body: TIMEOUT },
    { url: TARGET_OK, body: OK_BODY },
  ]));
  assert.equal(r.verdict, PASS);
  assert.match(r.reason, /after 1 earlier failure/);
});

test("never attempting the target is an error, not a failure", () => {
  // A run that never tried is not a run that tried and failed. Collapsing them
  // turns a broken harness into evidence about the asset.
  const r = verify(session([{ url: READ, body: OK_BODY }]));
  assert.equal(r.verdict, ERROR);
  assert.match(r.reason, /never carried out/);
});

test("an unreadable outcome is an error, not a failure", () => {
  const r = verify(session([{ url: TARGET_OK, body: "Stdout: \n" }]));
  assert.equal(r.verdict, ERROR);
  assert.match(r.reason, /could not be read/);
});

// ── reading one attempt ───────────────────────────────────────────

test("a 200 carrying a service error is not a success", () => {
  // curl calls it success; the envelope refuses. The envelope is right.
  const r = outcomeOfAttempt('Stdout: {"code":40101,"message":"session not initialized"}\nHTTP_CODE: 200');
  assert.equal(r.ok, false);
  assert.match(r.why, /40101/);
});

test("a timeout is read from the exit code, not from prose", () => {
  assert.equal(outcomeOfAttempt(TIMEOUT).ok, false);
  assert.match(outcomeOfAttempt(TIMEOUT).why, /timed out/);
});

test("a refused connection is a failure, not an unreadable outcome", () => {
  const r = outcomeOfAttempt("Exit code: 7\nStderr: curl: (7) Failed to connect to 127.0.0.1 port 52907");
  assert.equal(r.ok, false);
});

test("an empty output is unreadable rather than failed", () => {
  assert.equal(outcomeOfAttempt("Command: curl x\nStdout: \n").ok, null);
});

// ── which calls count as attempts ─────────────────────────────────

test("the command decides the target, never the response", () => {
  // A response that quotes the address is not an attempt at it — the same
  // request/response confusion that made the first verifier report three
  // channels as used.
  const r = verify([{
    event: "http.request",
    requestId: "req-1",
    timestamp: "2026-09-05T12:00:00Z",
    headers: { "x-conversation-id": "conv-1" },
    body: { json: { messages: [
      { role: "assistant", tool_calls: [{ id: "c0", function: { name: "Bash", arguments: JSON.stringify({ command: "cat notes.md" }) } }] },
      { role: "tool", tool_call_id: "c0", content: `Command: cat notes.md\nStdout: check ${TARGET_OK} with query ${TASK_MARKER}` },
    ] } },
  }]);
  assert.equal(r.verdict, ERROR);
  assert.equal(r.attempts.length, 0);
});

test("the address is kept, so which asset was followed stays visible", () => {
  const tried = attempts(session([
    { url: TARGET_BAD, body: TIMEOUT },
    { url: TARGET_OK, body: OK_BODY },
  ]));
  assert.deepEqual(tried.map((a) => `${a.host}:${a.port}`), ["10.244.7.19:8096", "127.0.0.1:47318"]);
});

test("a repeated result across turns is one attempt", () => {
  // Messages accumulate, so the same call reappears in every later request.
  const first = session([{ url: TARGET_OK, body: OK_BODY }]);
  const second = JSON.parse(JSON.stringify(first[0]));
  second.requestId = "req-2";
  second.timestamp = "2026-09-05T12:01:00Z";
  assert.equal(attempts([...first, second]).length, 1);
});

// ── the two ways a PASS was reported that should not have been ────

test("searching for the guidance asset is not carrying out the task", () => {
  // The task's first step is a search — for the asset that documents the
  // address. Accepting any skill/search scores discovery as execution: the
  // search succeeds, reading the guidance asset fails, the address is never
  // used, and the run passes.
  const r = verify(session([
    { url: TARGET_OK, body: OK_BODY, query: "bridge address convention" }, // finding the asset
    { url: READ, body: "Exit code: 7\nStderr: curl: (7) Failed to connect" }, // reading it failed
  ]));

  assert.equal(r.verdict, ERROR);
  assert.equal(r.attempts.length, 0, "neither call carries the task marker");
  assert.match(r.reason, /never carried out/);
});

test("a marked request against the documented address is the task", () => {
  const r = verify(session([
    { url: TARGET_OK, body: OK_BODY, query: "bridge address convention" },
    { url: TARGET_OK, body: OK_BODY },
  ]));
  assert.equal(r.verdict, PASS);
  assert.equal(r.attempts.length, 1, "only the marked call counts");
});

test("a last call whose result was never captured is an error, not the previous verdict", () => {
  // Walking results only makes such a call invisible, so the verdict silently
  // falls back to the earlier success — a PASS for a run whose last act was to
  // fire at the wrong address.
  const r = verify(session([
    { url: TARGET_OK, body: OK_BODY },
    { url: TARGET_BAD, body: null },
  ]));

  assert.equal(r.verdict, ERROR);
  assert.equal(r.attempts.length, 2, "the call is in the list even with nothing known about it");
  assert.equal(r.attempts[1].ok, null);
  assert.match(r.reason, /could not be read/);
});

test("an earlier call with no result does not sink a completed run", () => {
  // Only the last attempt decides. A missing result in the middle is a
  // collection gap, not a failure of the run.
  const r = verify(session([
    { url: TARGET_BAD, body: null },
    { url: TARGET_OK, body: OK_BODY },
  ]));
  assert.equal(r.verdict, PASS);
  assert.equal(r.attempts[0].ok, null);
});

test("attempts stay in the order the model made them", () => {
  const r = verify(session([
    { url: TARGET_BAD, body: TIMEOUT },
    { url: TARGET_OK, body: OK_BODY },
    { url: TARGET_BAD, body: TIMEOUT },
  ]));
  assert.deepEqual(r.attempts.map((a) => a.host), ["10.244.7.19", "127.0.0.1", "10.244.7.19"]);
  assert.equal(r.verdict, FAIL, "the last one decides");
});

// ---------------------------------------------------------------------------
// 追踪头 —— 新的判别性 token(2026-09-09)
//
// 旧口径的判别值是地址。地址可以从部署环境读出来,所以"命中"不足以说明读了资产。
// 新口径:每条资产各自规定一个追踪头的值,采用该资产就必然在命令里留下它。
//
// 验收**不看**这个值:PASS / FAIL 仍然只由目标调用的成败决定。验收独立于归因是
// 硬约束——记录它,不用它判。
// ---------------------------------------------------------------------------
import { traceOf } from "./verify.mjs";

const cmdWith = (addr, trace) =>
  `curl -sS -X POST 'http://${addr}/skill-bridge/v3/skill/search' -H 'content-type: application/json'` +
  (trace ? ` -H 'x-team-trace: ${trace}'` : "") +
  ` -d '{"query":"team-bridge-reachability"}'`;

test("追踪头的值被读出来", () => {
  assert.equal(traceOf(cmdWith("127.0.0.1:47318", "bt-yf39kfehc5")), "bt-yf39kfehc5");
});

test("没带追踪头 → 空,不是猜一个", () => {
  assert.equal(traceOf(cmdWith("127.0.0.1:47318", null)), "");
});

test("大小写与空格不影响读取", () => {
  assert.equal(traceOf(`-H "X-Team-Trace:   bt-7c4wgsmdac"`), "bt-7c4wgsmdac");
});

test("尝试记录里带上追踪值,并且它不参与判定", () => {
  const mk = (id, addr, trace, out) => ([
    { event: "http.request", timestamp: "2026-09-09T00:00:0" + id + "Z", headers: { "x-conversation-id": "c1" },
      body: { json: { messages: [
        { role: "assistant", tool_calls: [{ id: `call_${id}`, function: { arguments: JSON.stringify({ command: cmdWith(addr, trace) }) } }] },
        { role: "tool", tool_call_id: `call_${id}`, content: out },
      ] } } },
  ]);
  const got = attempts(mk("1", "127.0.0.1:47318", "bt-yf39kfehc5", 'Exit code: 0\n{"code":0}'));
  assert.equal(got.length, 1);
  assert.equal(got[0].value, "bt-yf39kfehc5", "采纳判定要读它");
  assert.equal(got[0].ok, true);

  const noTrace = attempts(mk("2", "127.0.0.1:47318", null, 'Exit code: 0\n{"code":0}'));
  assert.equal(noTrace[0].value, "", "没带就是空");
  assert.equal(noTrace[0].ok, true, "验收不因为缺追踪头而改判");
});
