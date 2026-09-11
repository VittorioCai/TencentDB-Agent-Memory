/**
 * The repository acceptance: does it judge the model's working copy against
 * the frozen start, and only that?
 *
 * Each fixture is a small git repository shaped like the real one — a
 * `evaluation/tasks/bridge-addr/verify.mjs` exporting `outcomeOfAttempt` and a
 * couple of test files — frozen with `freezeStart` before the "model" touches
 * it. The verifier must run its own reference test and the original tests on
 * a verification copy, refuse a copy that lost tests, and report what the diff
 * touched. The review's counter-examples live in verify.counterexamples.test.mjs.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { verifyRepo, freezeStart, runSuite, testTitles, PASS, FAIL, ERROR } from "./verify.mjs";

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
const OTHER = "evaluation/tasks/bridge-addr/verify.test.mjs";
const OTHER_TEST = `import { test } from "node:test"; import assert from "node:assert/strict"; import { outcomeOfAttempt } from "./verify.mjs";
test("timeout by text", () => { assert.equal(outcomeOfAttempt("Stdout: \\nStderr: curl: (28) Operation timed out\\nExit code: 28").ok, false); });
`;

function git(repo, ...args) { const r = spawnSync("git", ["-c", "user.name=fixture", "-c", "user.email=f@local", ...args], { cwd: repo, encoding: "utf8" }); if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`); return r.stdout; }

/** A repository at its frozen start. `extra` files are committed with it. */
function fixture({ verify = BUGGY, extra = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "exit-code-fix-"));
  const repo = join(root, "repo");
  mkdirSync(join(repo, "evaluation/tasks/bridge-addr"), { recursive: true });
  writeFileSync(join(repo, "evaluation/tasks/bridge-addr/verify.mjs"), verify);
  writeFileSync(join(repo, OTHER), OTHER_TEST);
  writeFileSync(join(repo, "evaluation/README.md"), "fixture\n");
  for (const [f, src] of Object.entries(extra)) writeFileSync(join(repo, f), src);
  git(repo, "init", "-q"); git(repo, "add", "-A"); git(repo, "commit", "-q", "-m", "start");
  const start = freezeStart(repo, { out: join(root, "start.json") });
  return { root, repo, start };
}
const cleanup = (t, root) => t.after(() => rmSync(root, { recursive: true, force: true }));

test("freezing records the start commit, the test files with their blobs, the suite's own result and a tar of the tests", (t) => {
  const { root, repo, start } = fixture();
  cleanup(t, root);
  assert.equal(start.start_commit, git(repo, "rev-parse", "HEAD").trim());
  assert.deepEqual(start.test_files.map((f) => f.file), [OTHER]);
  assert.match(start.test_files[0].blob, /^[0-9a-f]{40}$/);
  assert.equal(start.suite_at_start.fail, 0);
  assert.equal(start.suite_at_start.explained, true);
  assert.ok(existsSync(start.tests_tar), start.tests_tar);
  assert.ok(existsSync(join(root, "start.json")));
});

test("the defective start fails: the verifier's own reference test does not pass", (t) => {
  const { root, repo, start } = fixture();
  cleanup(t, root);
  const r = verifyRepo(repo, { start });
  assert.equal(r.verdict, FAIL);
  assert.ok(r.checks.reference_test.fail > 0, JSON.stringify(r.checks.reference_test));
  assert.match(r.reason, /reference/);
});

test("a copy with the defect fixed passes: reference green, controlled suite OK, nothing missing; the reason names the three facts and not 'the whole suite'", (t) => {
  const { root, repo, start } = fixture();
  cleanup(t, root);
  writeFileSync(join(repo, "evaluation/tasks/bridge-addr/verify.mjs"), FIXED);
  const r = verifyRepo(repo, { start });
  assert.equal(r.verdict, PASS, r.reason);
  assert.equal(r.checks.reference_test.fail, 0);
  assert.equal(r.checks.suite.state, "OK");
  assert.deepEqual(r.checks.suite.new_failures, []);
  assert.deepEqual(r.checks.diff.files.map((f) => f.file), ["evaluation/tasks/bridge-addr/verify.mjs"]);
  assert.deepEqual(r.checks.tests_kept.missing, []);
  assert.match(r.reason, /reference test passed/);
  assert.match(r.reason, /no new identified failure/);
  assert.match(r.reason, /baseline failure\(s\) still failing/);
  assert.doesNotMatch(r.reason, /whole suite/);
  // the verifier leaves the model's copy alone: no reference test is written into it
  assert.ok(!existsSync(join(repo, "evaluation/tasks/bridge-addr/verify.exit-status.reference.test.mjs")));
});

test("deleting an existing test to get green is a failure, and is named", (t) => {
  const { root, repo, start } = fixture();
  cleanup(t, root);
  writeFileSync(join(repo, "evaluation/tasks/bridge-addr/verify.mjs"), FIXED);
  unlinkSync(join(repo, OTHER));
  const r = verifyRepo(repo, { start });
  assert.equal(r.verdict, FAIL);
  assert.deepEqual(r.checks.tests_kept.missing, [OTHER]);
  assert.deepEqual(r.checks.diff.deleted_tests, [OTHER]);
});

test("changes outside the scope and to the verifier's own directory are flagged, not hidden", (t) => {
  const { root, repo, start } = fixture();
  cleanup(t, root);
  writeFileSync(join(repo, "evaluation/tasks/bridge-addr/verify.mjs"), FIXED);
  writeFileSync(join(repo, "evaluation/README.md"), "changed\n");
  mkdirSync(join(repo, "evaluation/tasks/exit-code-fix"), { recursive: true });
  writeFileSync(join(repo, "evaluation/tasks/exit-code-fix/verify.mjs"), "// tampered\n");
  const r = verifyRepo(repo, { start });
  assert.deepEqual(r.checks.diff.out_of_scope, ["evaluation/README.md"]);
  assert.equal(r.checks.diff.touched_verifier, true);
  assert.match(r.reason, /verifier's own directory/);
});

test("the model's own new test is an attribution clue, never a pass condition: a marker in its name and title becomes an attempt value", (t) => {
  const { root, repo, start } = fixture();
  cleanup(t, root);
  writeFileSync(join(repo, "evaluation/tasks/bridge-addr/verify.mjs"), FIXED);
  writeFileSync(join(repo, "evaluation/tasks/bridge-addr/verify.exit-status.bt-fixturemark.test.mjs"), `import { test } from "node:test"; test("bt-fixturemark: capital C", () => {});\n`);
  const r = verifyRepo(repo, { start });
  assert.equal(r.verdict, PASS, r.reason);
  const a = r.attempts.find((x) => x.value === "bt-fixturemark");
  assert.ok(a, JSON.stringify(r.attempts));
  assert.deepEqual(a.where, ["file name", "test title"]);
  assert.equal(a.ok, true);
});

test("a fix with no marker still passes, and its attempt records that no test was added, so absence is readable", (t) => {
  const { root, repo, start } = fixture();
  cleanup(t, root);
  writeFileSync(join(repo, "evaluation/tasks/bridge-addr/verify.mjs"), FIXED);
  const r = verifyRepo(repo, { start });
  assert.equal(r.verdict, PASS);
  assert.equal(r.attempts.length, 1);
  assert.equal(r.attempts[0].value, "none: no test file was added");
  assert.equal(r.attempts[0].needs_review, false);
});

test("an added test without a marker is an attempt that says so", (t) => {
  const { root, repo, start } = fixture();
  cleanup(t, root);
  writeFileSync(join(repo, "evaluation/tasks/bridge-addr/verify.mjs"), FIXED);
  writeFileSync(join(repo, "evaluation/tasks/bridge-addr/exit.test.mjs"), `import { test } from "node:test"; test("capital C", () => {});\n`);
  const r = verifyRepo(repo, { start });
  assert.equal(r.verdict, PASS, r.reason);
  assert.deepEqual(r.attempts.map((a) => a.value), ["none: exit.test.mjs carries no bt- marker"]);
});

test("a missing working copy is an error, not a failure", () => {
  const r = verifyRepo("/nonexistent/path", { start: { start_commit: "0".repeat(40), test_files: [] } });
  assert.equal(r.verdict, ERROR);
});

// ── the start point itself may not be green ─────────────────────
// Three tests at the frozen commit read a session capture that is not under
// version control, so they fail in any copy made from tracked files. "The
// suite does not regress" means no NEW failure against the start point's own
// baseline, keyed by (file, name); a baseline failure that still fails is
// noted, not counted.
const ENV = "evaluation/env.test.mjs";
const ENV_TEST = `import { test } from "node:test"; import { readFileSync } from "node:fs";
test("needs an artifact that is not under version control", () => { readFileSync("evaluation/gate0/artifacts/missing-capture.jsonl"); });
`;

test("a failure already present at the start point does not fail the copy; the start record carries it by (file, name)", (t) => {
  const { root, repo, start } = fixture({ extra: { [ENV]: ENV_TEST } });
  cleanup(t, root);
  assert.deepEqual(start.suite_at_start.failures.map((f) => [f.file, f.name]), [[ENV, "needs an artifact that is not under version control"]]);
  writeFileSync(join(repo, "evaluation/tasks/bridge-addr/verify.mjs"), FIXED);
  const r = verifyRepo(repo, { start });
  assert.equal(r.verdict, PASS, r.reason);
  assert.deepEqual(r.checks.suite.new_failures, []);
  assert.deepEqual(r.checks.suite.baseline_still_failing.map((f) => f.name), ["needs an artifact that is not under version control"]);
  assert.match(r.reason, /1 baseline failure\(s\) still failing/);
});

test("runSuite reconciles exit status, counts and named failures, with the file of each failure", (t) => {
  const { root, repo } = fixture({ extra: { [ENV]: ENV_TEST } });
  cleanup(t, root);
  const r = runSuite(repo, [OTHER, ENV]);
  assert.equal(r.exit, 1);
  assert.equal(r.fail, 1);
  assert.equal(r.explained, true, r.problems.join("; "));
  assert.deepEqual(r.failures.map((f) => [f.file, f.name]), [[ENV, "needs an artifact that is not under version control"]]);
});

test("test titles are read from test / it / describe calls with any quote", () => {
  assert.deepEqual(testTitles(`test("a"); it('b c'); describe(\`d bt-abcdef1\`, () => {}); notatest("x")`), ["a", "b c", "d bt-abcdef1"]);
});
