/**
 * Counter-examples from the 2026-09-11 review of the repository acceptance.
 *
 * Each test reproduces one way the verifier committed in 41d8620 passed a copy
 * it should not have passed, credited a marker it should not have credited, or
 * compared against the wrong start. Written before the fix: every test here
 * fails on that verifier (recorded in counterexamples-before.txt) and passes
 * after it.
 *
 *   1  a suite failure the parser cannot name must not become PASS: the
 *      reporter is fixed, exit status / failure count / named failures must
 *      agree, and the baseline exemption is bound to (file, test name)
 *   2  the frozen start is what the copy is compared with, not the copy's own
 *      HEAD: a commit, a rewritten original test, a model-added test
 *   3  attribution clues come from the added test files' names and titles and
 *      the call that wrote them, not from every line of the diff
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import * as V from "./verify.mjs";

const { verifyRepo, PASS, FAIL, ERROR } = V;

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
// A "fix" that also drops the timeout phrase: the reference test still passes
// (every case carries an exit line) but an original test that relies on the
// phrase alone breaks.
const FIXED_NO_PHRASE = FIXED.replace(" || /Operation timed out|Connection timed out/.test(s)", "");
// The original test depends on the phrase only — no exit line in its input.
const PHRASE_TEST = `import { test } from "node:test"; import assert from "node:assert/strict"; import { outcomeOfAttempt } from "./verify.mjs";
test("timeout by text", () => { assert.equal(outcomeOfAttempt("Stdout: \\nStderr: curl: (28) Operation timed out").ok, false); });
`;
const OTHER = "evaluation/tasks/bridge-addr/verify.test.mjs";

function git(repo, ...args) { const r = spawnSync("git", ["-c", "user.name=fixture", "-c", "user.email=f@local", ...args], { cwd: repo, encoding: "utf8" }); if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`); return r.stdout; }

/** A small repository at its frozen start: the harness freezes it before the "model" touches anything. */
function fixture({ verify = BUGGY, tests = { [OTHER]: PHRASE_TEST } } = {}) {
  const root = mkdtempSync(join(tmpdir(), "exit-code-ce-"));
  const repo = join(root, "repo");
  mkdirSync(join(repo, "evaluation/tasks/bridge-addr"), { recursive: true });
  writeFileSync(join(repo, "evaluation/tasks/bridge-addr/verify.mjs"), verify);
  for (const [f, src] of Object.entries(tests)) { mkdirSync(dirname(join(repo, f)), { recursive: true }); writeFileSync(join(repo, f), src); }
  writeFileSync(join(repo, "evaluation/README.md"), "fixture\n");
  git(repo, "init", "-q"); git(repo, "add", "-A"); git(repo, "commit", "-q", "-m", "start");
  const start = typeof V.freezeStart === "function" ? V.freezeStart(repo, { out: join(root, "start.json") }) : null;
  return { root, repo, start };
}
const cleanup = (t, root) => t.after(() => rmSync(root, { recursive: true, force: true }));
const has = (list, file, name) => (list ?? []).some((f) => f.file === file && f.name === name);

// ── 1. a failure the parser cannot name is not a pass ────────────

test("1a. with the test reporter set from outside (TAP), a broken original test is still a named new failure, never PASS", (t) => {
  const { root, repo, start } = fixture();
  cleanup(t, root);
  writeFileSync(join(repo, "evaluation/tasks/bridge-addr/verify.mjs"), FIXED_NO_PHRASE);
  const saved = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = "--test-reporter=tap --test-reporter-destination=stdout";
  let r;
  try { r = verifyRepo(repo, { start }); } finally { if (saved === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = saved; }
  assert.equal(r.verdict, FAIL, r.reason);
  assert.ok(has(r.checks.suite.new_failures, OTHER, "timeout by text"), JSON.stringify(r.checks.suite));
});

test("1b. TAP `not ok` lines are parsed with their file; counts that the named failures cannot explain make the suite UNEXPLAINED", () => {
  const tap = [
    "TAP version 13", "# Subtest: plain fail", "not ok 1 - plain fail", "  ---", "  duration_ms: 0.3", "  type: 'test'",
    "  location: '/r/evaluation/a.test.mjs:3:1'", "  failureType: 'testCodeFailure'", "  error: |-", "    location: 'not this one'", "  ...",
    "# Subtest: group", "    # Subtest: child fails", "    not ok 1 - child fails", "      ---", "      type: 'test'",
    "      location: '/r/evaluation/b.test.mjs:4:5'", "      ...", "    1..1", "not ok 2 - group", "  ---", "  type: 'suite'",
    "  location: '/r/evaluation/b.test.mjs:4:1'", "  ...", "1..2", "# tests 2", "# suites 1", "# pass 0", "# fail 2", "# cancelled 0", "",
  ].join("\n");
  const p = V.parseTap(tap, "/r");
  assert.deepEqual(p.failures.map((f) => [f.file, f.name]), [["evaluation/a.test.mjs", "plain fail"], ["evaluation/b.test.mjs", "child fails"]]);
  assert.equal(p.suites.length, 1, "a describe block is reported not ok but is not a counted test");
  assert.equal(p.fail, 2);
  // the same counts with no failure named: not explained, so not OK and not REGRESSED
  const unexplained = V.assessSuite({ exit: 1, tests: 3, pass: 2, fail: 1, cancelled: 0, failures: [], problems: [] }, []);
  assert.equal(unexplained.state, "UNEXPLAINED");
  // exit 0 with a failure counted is also unexplained
  assert.equal(V.assessSuite({ exit: 0, tests: 3, pass: 2, fail: 1, cancelled: 0, failures: [{ file: "x", name: "y" }], problems: [] }, []).state, "UNEXPLAINED");
  // a fully explained regression is REGRESSED with the failure named
  const reg = V.assessSuite({ exit: 1, tests: 3, pass: 2, fail: 1, cancelled: 0, failures: [{ file: "x", name: "y" }], problems: [] }, []);
  assert.equal(reg.state, "REGRESSED");
  assert.deepEqual(reg.new_failures.map((f) => [f.file, f.name]), [["x", "y"]]);
});

test("1c. the baseline exemption is bound to (file, name): a same-named test in another file that newly fails is a regression", (t) => {
  const A = "evaluation/a.test.mjs", B = "evaluation/b.test.mjs";
  const { root, repo, start } = fixture({ tests: {
    [A]: `import { test } from "node:test"; import assert from "node:assert/strict";\ntest("same name", () => { assert.equal(1, 2); });\n`,
    [B]: `import { test } from "node:test"; import assert from "node:assert/strict"; import { outcomeOfAttempt } from "./tasks/bridge-addr/verify.mjs";\ntest("same name", () => { assert.equal(outcomeOfAttempt("Stdout: \\nStderr: curl: (28) Operation timed out").ok, false); });\n`,
  } });
  cleanup(t, root);
  writeFileSync(join(repo, "evaluation/tasks/bridge-addr/verify.mjs"), FIXED_NO_PHRASE);
  // the old verifier's name-only baseline would exempt B's failure because A's failure has the same name
  const r = verifyRepo(repo, { start, suiteBaseline: { failing_tests: ["same name"] } });
  assert.equal(r.verdict, FAIL, r.reason);
  assert.ok(has(r.checks.suite.new_failures, B, "same name"), JSON.stringify(r.checks.suite));
  assert.ok(has(r.checks.suite.baseline_still_failing, A, "same name"), JSON.stringify(r.checks.suite));
});

// ── 2. the frozen start, not the copy's HEAD ─────────────────────

test("2a. a copy the model committed is still compared with the frozen start: a test deleted in that commit is missing", (t) => {
  const { root, repo, start } = fixture();
  cleanup(t, root);
  writeFileSync(join(repo, "evaluation/tasks/bridge-addr/verify.mjs"), FIXED);
  unlinkSync(join(repo, OTHER));
  git(repo, "add", "-A"); git(repo, "commit", "-q", "-m", "model: fix and drop a test");
  const r = verifyRepo(repo, { start });
  assert.equal(r.verdict, FAIL, r.reason);
  assert.deepEqual(r.checks.tests_kept.missing, [OTHER]);
  assert.ok(r.checks.diff.files.some((f) => f.file === OTHER && f.status.startsWith("D")), JSON.stringify(r.checks.diff.files));
  assert.equal(r.checks.history.commits_after_start, 1);
});

test("2b. an original test the model rewrote runs with its original content: the rewrite cannot hide a regression", (t) => {
  const { root, repo, start } = fixture();
  cleanup(t, root);
  writeFileSync(join(repo, "evaluation/tasks/bridge-addr/verify.mjs"), FIXED_NO_PHRASE);
  // the model makes its own suite green by changing what the original test expects
  writeFileSync(join(repo, OTHER), PHRASE_TEST.replace(".ok, false)", ".ok, null)"));
  const r = verifyRepo(repo, { start });
  assert.equal(r.verdict, FAIL, r.reason);
  assert.deepEqual(r.checks.tests_kept.modified, [OTHER]);
  assert.ok(has(r.checks.suite.new_failures, OTHER, "timeout by text"), JSON.stringify(r.checks.suite));
});

test("2c. a test file the model added is recorded on its own, not folded into the regression check", (t) => {
  const { root, repo, start } = fixture();
  cleanup(t, root);
  writeFileSync(join(repo, "evaluation/tasks/bridge-addr/verify.mjs"), FIXED);
  const MINE = "evaluation/tasks/bridge-addr/mine.test.mjs";
  writeFileSync(join(repo, MINE), `import { test } from "node:test"; import assert from "node:assert/strict"; test("my own, broken", () => { assert.equal(1, 2); });\n`);
  const r = verifyRepo(repo, { start });
  assert.equal(r.verdict, PASS, r.reason);
  assert.deepEqual(r.checks.tests_kept.added, [MINE]);
  assert.equal(r.checks.model_tests.fail, 1, JSON.stringify(r.checks.model_tests));
  assert.deepEqual(r.checks.suite.new_failures, []);
});

test("2d. without a frozen start record the acceptance is an ERROR, not a verdict against the copy's own HEAD", (t) => {
  const { root, repo } = fixture();
  cleanup(t, root);
  writeFileSync(join(repo, "evaluation/tasks/bridge-addr/verify.mjs"), FIXED);
  const r = verifyRepo(repo, {});
  assert.equal(r.verdict, ERROR, r.reason);
});

// ── 3. attribution clues: added tests and the call that wrote them ──

test("3a. a marker that only appears in a deleted line of the diff is not an attempt", (t) => {
  const { root, repo, start } = fixture({ verify: `// history: see bt-oldmarker1\n${BUGGY}` });
  cleanup(t, root);
  writeFileSync(join(repo, "evaluation/tasks/bridge-addr/verify.mjs"), FIXED); // the comment goes: the marker is now a "-" line
  const r = verifyRepo(repo, { start, tokens: { "skl-note": { tokens: ["bt-oldmarker1"] } } });
  assert.equal(r.verdict, PASS, r.reason);
  assert.ok(!r.attempts.some((a) => a.value === "bt-oldmarker1"), JSON.stringify(r.attempts));
  assert.deepEqual(r.attempts.map((a) => a.value), ["none: no test file was added"]);
  assert.ok(r.checks.markers_elsewhere.some((m) => m.value === "bt-oldmarker1"), JSON.stringify(r.checks.markers_elsewhere));
});

const ADDED = "evaluation/tasks/bridge-addr/verify.exit-status.bt-fixturemark.test.mjs";
const ADDED_SRC = `import { test } from "node:test"; test("bt-fixturemark: capital C", () => {});\n`;
const call = (id, name, args, index) => ({ id, index, function: { name, arguments: JSON.stringify(args) } });
function capture(repo, calls) {
  // one request carrying every call, as the capture would after the last turn
  return [{ event: "http.request", timestamp: "2026-09-11T00:00:00Z", body: { json: { messages: calls.map((c) => ({ role: "assistant", tool_calls: [{ id: c.id, function: c.function }] })) } } }];
}

test("3b. the attempt names the call that actually wrote the added test, not the first call that mentioned the marker", (t) => {
  const { root, repo, start } = fixture();
  cleanup(t, root);
  writeFileSync(join(repo, "evaluation/tasks/bridge-addr/verify.mjs"), FIXED);
  writeFileSync(join(repo, ADDED), ADDED_SRC);
  const rows = capture(repo, [
    call("call_1", "Grep", { pattern: "bt-fixturemark", path: repo }),
    call("call_2", "Bash", { command: "grep -rn bt-fixturemark evaluation" }),
    call("call_3", "Write", { file_path: join(repo, ADDED), content: ADDED_SRC }),
    call("call_4", "Bash", { command: "node --test " + ADDED }),
  ]);
  const r = verifyRepo(repo, { start, capture: rows, tokens: { "skl-note": { tokens: ["bt-fixturemark"] } } });
  assert.equal(r.verdict, PASS, r.reason);
  const a = r.attempts.find((x) => x.value === "bt-fixturemark");
  assert.ok(a, JSON.stringify(r.attempts));
  assert.equal(a.call_id, "call_3");
  assert.equal(a.needs_review, false);
  assert.equal(a.file, ADDED);
});

test("3c. an added test whose writing call cannot be found keeps the marker but is marked for review", (t) => {
  const { root, repo, start } = fixture();
  cleanup(t, root);
  writeFileSync(join(repo, "evaluation/tasks/bridge-addr/verify.mjs"), FIXED);
  writeFileSync(join(repo, ADDED), ADDED_SRC);
  const rows = capture(repo, [call("call_1", "Grep", { pattern: "bt-fixturemark", path: repo })]);
  const r = verifyRepo(repo, { start, capture: rows, tokens: { "skl-note": { tokens: ["bt-fixturemark"] } } });
  const a = r.attempts.find((x) => x.value === "bt-fixturemark");
  assert.ok(a, JSON.stringify(r.attempts));
  assert.equal(a.call_id, null);
  assert.equal(a.needs_review, true);
});
