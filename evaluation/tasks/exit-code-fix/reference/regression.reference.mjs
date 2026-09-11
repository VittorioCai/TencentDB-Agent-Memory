/**
 * Reference regression test — owned by the verifier, written into the working
 * copy at acceptance time (as evaluation/tasks/bridge-addr/verify.exit-status.reference.test.mjs). It is the functional acceptance for the exit-code
 * task and is identical for the with-note and no-note arms. It says nothing
 * about how the fix is written or what the model's own test is called.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { outcomeOfAttempt } from "./verify.mjs";

const result = (exitLine, { stdout = "", stderr = "(empty)" } = {}) => `Command: curl -s -X POST http://127.0.0.1:47318/skill-bridge/v3/skill/search\nStdout: ${stdout}\nStderr: ${stderr}\n${exitLine}`;

test("a timed-out call whose only signal is the exit status line, as CodeBuddy spells it, is a timeout", () => {
  assert.deepEqual(outcomeOfAttempt(result("Exit Code: 28")), { ok: false, why: "timed out" });
});

test("a non-zero exit status, as CodeBuddy spells it, is a failure", () => {
  assert.equal(outcomeOfAttempt(result("Exit Code: 52")).ok, false);
  assert.equal(outcomeOfAttempt(result("Exit Code: 56")).ok, false);
});

test("the lower-case spelling found in older records still reads", () => {
  assert.deepEqual(outcomeOfAttempt(result("Exit code: 52")), { ok: false, why: "exit 52" });
  assert.deepEqual(outcomeOfAttempt(result("Exit code: 28")), { ok: false, why: "timed out" });
});

test("a successful call is unchanged: exit 0 with a code-0 envelope is ok", () => {
  assert.deepEqual(outcomeOfAttempt(result("Exit Code: 0", { stdout: '{"code":0,"message":"ok","data":{"items":[]}}' })), { ok: true, why: "code 0" });
});

test("a refusal is unchanged: exit 0 with a non-zero envelope code is a failure", () => {
  assert.equal(outcomeOfAttempt(result("Exit Code: 0", { stdout: '{"code":40101,"message":"refused"}' })).ok, false);
});

test("exit 0 with nothing to read stays unreadable, not a failure", () => {
  assert.equal(outcomeOfAttempt(result("Exit Code: 0")).ok, null);
});

test("a connection failure named in stderr is a failure whichever way the exit line is spelt", () => {
  assert.equal(outcomeOfAttempt(result("Exit Code: 7", { stderr: "curl: (7) Failed to connect to 10.244.7.19 port 8096" })).ok, false);
});
