/**
 * Reference regression test — owned by the verifier, written into the working
 * copy at acceptance time (as evaluation/attribution/collect-artifacts.exit-status.reference.test.mjs).
 * It is the functional acceptance for the exit-line-collect task and is
 * identical for the with-note and no-note arms. It says nothing about how the
 * fix is written or what the model's own test is called.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { outcomeOf } from "./collect-artifacts.mjs";

const result = (exitLine, { stdout = "", stderr = "(empty)" } = {}) => `Command: node --test evaluation/x.test.mjs\nStdout: ${stdout}\nStderr: ${stderr}\n${exitLine}`;

test("the exit status of a real tool result, as CodeBuddy spells it, is read", () => {
  assert.equal(outcomeOf(result("Exit Code: 28")).exit_code, 28);
});

test("exit 0 as CodeBuddy spells it reads 0, not null", () => {
  assert.equal(outcomeOf(result("Exit Code: 0")).exit_code, 0);
});

test("a non-zero status as CodeBuddy spells it is read", () => {
  assert.equal(outcomeOf(result("Exit Code: 52")).exit_code, 52);
  assert.equal(outcomeOf(result("Exit Code: 1")).exit_code, 1);
});

test("the lower-case spelling found in older records still reads", () => {
  assert.equal(outcomeOf(result("Exit code: 1")).exit_code, 1);
});

test("stderr is still read beside the status", () => {
  assert.equal(outcomeOf(result("Exit Code: 7", { stderr: "curl: (7) Failed to connect" })).stderr.startsWith("curl: (7) Failed to connect"), true);
});

test("a result with no exit line stays null", () => {
  assert.equal(outcomeOf("Stdout: x\nStderr: (empty)").exit_code, null);
});
