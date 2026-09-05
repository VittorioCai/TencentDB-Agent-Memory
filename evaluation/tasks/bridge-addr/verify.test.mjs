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

const TARGET_OK = "http://127.0.0.1:47318/skill-bridge/v3/skill/search";
const TARGET_BAD = "http://10.244.7.19:8096/skill-bridge/v3/skill/search";
const READ = "http://127.0.0.1:8096/skill-bridge/v3/skill/get-by-name";

const OK_BODY = 'Stdout: {"code":0,"message":"ok","data":{"items":[]}}\nHTTP_CODE: 200';
const TIMEOUT = "Exit code: 28\nStdout: \nStderr: curl: (28) Operation timed out after 75000 ms";

function session(results) {
  return [{
    event: "http.request",
    requestId: "req-1",
    timestamp: "2026-09-05T12:00:00Z",
    headers: { "x-conversation-id": "conv-1" },
    body: { json: { messages: [
      { role: "user", content: "do the task" },
      ...results.map(({ url, body }, i) => ({
        role: "tool",
        tool_call_id: `c${i}`,
        content: `Command: curl -sSk -X POST ${url} -d '{"query":"bridge"}'\n${body}`,
      })),
    ] } },
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
      { role: "tool", tool_call_id: "c0", content: `Command: cat notes.md\nStdout: the bridge is at ${TARGET_OK}` },
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
