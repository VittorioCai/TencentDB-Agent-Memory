import { test } from "node:test";
import assert from "node:assert/strict";

import { summarizeRuns, renderRuns } from "./summarize-runs.mjs";

const run = (label, verdict, run_id) => ({ label, verdict, run_id });

test("an unjudgeable run stays in the denominator", () => {
  // Six runs, four broken, two passed. Over judged runs alone that reads 100%.
  const s = summarizeRuns([
    run("gate-off", "PASS", "r1"), run("gate-off", "PASS", "r2"),
    run("gate-off", "ERROR", "r3"), run("gate-off", "ERROR", "r4"),
    run("gate-off", "ERROR", "r5"), run("gate-off", "ERROR", "r6"),
  ]);
  const g = s.groups[0];
  assert.equal(g.started, 6);
  assert.equal(g.pass_rate, 2 / 6);
  assert.equal(g.pass_rate_of_judged, 1);
  assert.match(renderRuns(s), /4 of 6 could not be judged/);
});

test("both numbers are printed, so the gap is visible", () => {
  const out = renderRuns(summarizeRuns([run("x", "PASS", "r1"), run("x", "ERROR", "r2")]));
  assert.match(out, /50%/);
  assert.match(out, /it would read 100%/);
});

test("unjudgeable runs are named, not just counted", () => {
  const out = renderRuns(summarizeRuns([run("x", "PASS", "r1"), run("x", "ERROR", "broken-run")]));
  assert.match(out, /broken-run/);
});

test("no runs is not a result of zero", () => {
  assert.match(renderRuns(summarizeRuns([])), /nothing has been measured/);
});

test("labels are grouped so gate-on and gate-off stay comparable", () => {
  const s = summarizeRuns([
    run("gate-off", "FAIL", "a"), run("gate-off", "FAIL", "b"),
    run("gate-on", "PASS", "c"),
  ]);
  assert.deepEqual(s.groups.map((g) => [g.label, g.pass, g.fail]), [["gate-off", 0, 2], ["gate-on", 1, 0]]);
});
