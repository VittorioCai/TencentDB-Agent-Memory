/**
 * The repository acceptance: does it judge the model's working copy, and only
 * that?
 *
 * Each fixture is a small git repository shaped like the real one — a
 * `evaluation/tasks/bridge-addr/verify.mjs` exporting `outcomeOfAttempt` and a
 * couple of test files — with or without the defect. The verifier must write
 * its own reference test into the copy and run it, run the whole suite, refuse
 * a copy that deleted tests, and report what the diff touched.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { verifyRepo, PASS, FAIL, ERROR } from "./verify.mjs";

const BUGGY = `export function outcomeOfAttempt(resultText) {
  const s = String(resultText ?? "");
  const exit = /(?:^|\\n)Exit code:\\s*(\\d+)/.exec(s);
  const exitCode = exit ? Number(exit[1]) : null;
  if (exitCode === 28 || /Operation timed out|Connection timed out/.test(s)) return { ok: false, why: "timed out" };
  if (exitCode !== null && exitCode !== 0) return { ok: false, why: \`exit \${exitCode}\` };
  if (/Could not resolve host|Connection refused|Failed to connect/.test(s)) return { ok: false, why: "could not connect" };
  const i = s.indexOf("Stdout:"); const output = i < 0 ? s : s.slice(i + 7);
  const envelope = /"code"\\s*:\\s*(\\d+)/.exec(output);
  if (envelope) return Number(envelope[1]) === 0 ? { ok: true, why: "code 0" } : { ok: false, why: \`service code \${envelope[1]}\` };
  if (!output.trim()) return { ok: null, why: "no output" };
  return { ok: null, why: "outcome not readable" };
}
`;
const FIXED = BUGGY.replace("Exit code:", "Exit [Cc]ode:");
const OTHER_TEST = `import { test } from "node:test"; import assert from "node:assert/strict"; import { outcomeOfAttempt } from "./verify.mjs";
test("timeout by text", () => { assert.equal(outcomeOfAttempt("Stdout: \\nStderr: curl: (28) Operation timed out\\nExit code: 28").ok, false); });
`;

function git(repo, ...args) { const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" }); if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`); return r.stdout; }

function fixture({ verify = BUGGY } = {}) {
  const root = mkdtempSync(join(tmpdir(), "exit-code-fix-"));
  const repo = join(root, "repo");
  mkdirSync(join(repo, "evaluation/tasks/bridge-addr"), { recursive: true });
  writeFileSync(join(repo, "evaluation/tasks/bridge-addr/verify.mjs"), verify);
  writeFileSync(join(repo, "evaluation/tasks/bridge-addr/verify.test.mjs"), OTHER_TEST);
  writeFileSync(join(repo, "evaluation/README.md"), "fixture\n");
  git(repo, "init", "-q");
  git(repo, "-c", "user.name=fixture", "-c", "user.email=f@local", "add", "-A");
  git(repo, "-c", "user.name=fixture", "-c", "user.email=f@local", "commit", "-q", "-m", "start");
  return { root, repo };
}

test("the defective start fails: the verifier's own reference test does not pass", (t) => {
  const { root, repo } = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const r = verifyRepo(repo);
  assert.equal(r.verdict, FAIL);
  assert.ok(r.checks.reference_test.fail > 0, JSON.stringify(r.checks.reference_test));
  assert.match(r.reason, /reference/);
});

test("a copy with the defect fixed passes: reference test green, suite green, nothing deleted", (t) => {
  const { root, repo } = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(repo, "evaluation/tasks/bridge-addr/verify.mjs"), FIXED);
  const r = verifyRepo(repo);
  assert.equal(r.verdict, PASS, r.reason);
  assert.equal(r.checks.reference_test.fail, 0);
  assert.equal(r.checks.suite.fail, 0);
  assert.deepEqual(r.checks.diff.files.map((f) => f.file), ["evaluation/tasks/bridge-addr/verify.mjs"]);
  assert.deepEqual(r.checks.tests_kept.missing, []);
});

test("deleting an existing test to get green is a failure, and is named", (t) => {
  const { root, repo } = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(repo, "evaluation/tasks/bridge-addr/verify.mjs"), FIXED);
  unlinkSync(join(repo, "evaluation/tasks/bridge-addr/verify.test.mjs"));
  const r = verifyRepo(repo);
  assert.equal(r.verdict, FAIL);
  assert.deepEqual(r.checks.tests_kept.missing, ["evaluation/tasks/bridge-addr/verify.test.mjs"]);
});

test("changes outside the scope and to the verifier's own directory are flagged, not hidden", (t) => {
  const { root, repo } = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(repo, "evaluation/tasks/bridge-addr/verify.mjs"), FIXED);
  writeFileSync(join(repo, "evaluation/README.md"), "changed\n");
  mkdirSync(join(repo, "evaluation/tasks/exit-code-fix"), { recursive: true });
  writeFileSync(join(repo, "evaluation/tasks/exit-code-fix/verify.mjs"), "// tampered\n");
  const r = verifyRepo(repo);
  assert.deepEqual(r.checks.diff.out_of_scope, ["evaluation/README.md"]);
  assert.equal(r.checks.diff.touched_verifier, true);
});

test("the model's own new test is an attribution clue, never a pass condition: a marker in the diff becomes an attempt value", (t) => {
  const { root, repo } = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(repo, "evaluation/tasks/bridge-addr/verify.mjs"), FIXED);
  writeFileSync(join(repo, "evaluation/tasks/bridge-addr/verify.exit-status.bt-fixturemark.test.mjs"), `import { test } from "node:test"; test("bt-fixturemark: capital C", () => {});\n`);
  const r = verifyRepo(repo, { tokens: { "skl-note": { tokens: ["bt-fixturemark"] } } });
  assert.equal(r.verdict, PASS);
  assert.ok(r.attempts.some((a) => a.value === "bt-fixturemark"), JSON.stringify(r.attempts));
});

test("a fix with no marker still passes, and its attempt records that no marker was present, so absence is readable", (t) => {
  const { root, repo } = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(repo, "evaluation/tasks/bridge-addr/verify.mjs"), FIXED);
  const r = verifyRepo(repo, { tokens: { "skl-note": { tokens: ["bt-fixturemark"] } } });
  assert.equal(r.verdict, PASS);
  assert.equal(r.attempts.length, 1);
  assert.ok(r.attempts[0].value && !/bt-fixturemark/.test(r.attempts[0].value));
});

test("a missing working copy is an error, not a failure", () => {
  const r = verifyRepo("/nonexistent/path");
  assert.equal(r.verdict, ERROR);
});

// ── the start point itself may not be green ─────────────────────
// Three tests at the frozen commit read a session capture that is not under
// version control, so they fail in any copy made from tracked files. "The
// suite does not regress" means no NEW failure against the start point's own
// baseline, which selfcheck records; a baseline failure that still fails is
// noted, not counted.
const ENV_TEST = `import { test } from "node:test"; import { readFileSync } from "node:fs";
test("needs an artifact that is not under version control", () => { readFileSync("evaluation/gate0/artifacts/missing-capture.jsonl"); });
`;

test("a failure already present at the start point does not fail the copy; a new one does", (t) => {
  const { root, repo } = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(repo, "evaluation/env.test.mjs"), ENV_TEST);
  git(repo, "-c", "user.name=fixture", "-c", "user.email=f@local", "add", "-A");
  git(repo, "-c", "user.name=fixture", "-c", "user.email=f@local", "commit", "-q", "-m", "start with an environment-dependent test");
  writeFileSync(join(repo, "evaluation/tasks/bridge-addr/verify.mjs"), FIXED);
  const baseline = { failing_tests: ["needs an artifact that is not under version control"] };
  const r = verifyRepo(repo, { suiteBaseline: baseline });
  assert.equal(r.verdict, PASS, r.reason);
  assert.deepEqual(r.checks.suite.new_failures, []);
  assert.deepEqual(r.checks.suite.baseline_still_failing, ["needs an artifact that is not under version control"]);
  // the same copy with a new failing test is a failure
  writeFileSync(join(repo, "evaluation/tasks/bridge-addr/broken.test.mjs"), `import { test } from "node:test"; import assert from "node:assert/strict"; test("newly broken", () => { assert.equal(1, 2); });\n`);
  const r2 = verifyRepo(repo, { suiteBaseline: baseline });
  assert.equal(r2.verdict, FAIL);
  assert.deepEqual(r2.checks.suite.new_failures, ["newly broken"]);
});
