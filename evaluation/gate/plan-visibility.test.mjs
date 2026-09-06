import { test } from "node:test";
import assert from "node:assert/strict";
import { planVisibility, renderPlan, HIDDEN } from "./plan-visibility.mjs";

const WRONG = "skl-sZFb3KatWY6m", RIGHT = "skl-oBaDO5CceKnr", PEND = "skl-pending";

const baseline = {
  assets: {
    [WRONG]: { baseline_visibility: "team" },
    [RIGHT]: { baseline_visibility: "team" },
    [PEND]: { baseline_visibility: "team" },
  },
  decisions: [
    { asset_id: WRONG, decision: "reject", reasons: ["rule reject: a corrected record exists (reason=wrong)"] },
    { asset_id: RIGHT, decision: "admit", reasons: ["rule admit"] },
    { asset_id: PEND, decision: "pending", reasons: ["cold start"] },
  ],
};

test("apply from the baseline: only the rejected asset changes, to private", () => {
  const plan = planVisibility({ mode: "apply", baseline, current: { [WRONG]: "team", [RIGHT]: "team", [PEND]: "team" } });
  assert.deepEqual(plan.changes.map((c) => [c.asset_id, c.from, c.to]), [[WRONG, "team", HIDDEN]]);
  assert.match(plan.changes[0].because, /reject → private/);
  assert.equal(plan.unchanged.length, 2);
  assert.ok(plan.unchanged.find((u) => u.asset_id === PEND).because.includes("does not hide what it could not judge"));
  assert.deepEqual(plan.unreadable, []);
});

test("apply is idempotent: already-private rejected asset is unchanged", () => {
  const plan = planVisibility({ mode: "apply", baseline, current: { [WRONG]: HIDDEN, [RIGHT]: "team", [PEND]: "team" } });
  assert.deepEqual(plan.changes, []);
});

test("reset restores the baseline regardless of decisions", () => {
  const plan = planVisibility({ mode: "reset", baseline, current: { [WRONG]: HIDDEN, [RIGHT]: HIDDEN, [PEND]: "team" } });
  const byId = (a, b) => a[0].localeCompare(b[0]);
  assert.deepEqual(plan.changes.map((c) => [c.asset_id, c.to]).sort(byId), [[WRONG, "team"], [RIGHT, "team"]].sort(byId));
  assert.ok(plan.changes.every((c) => /reset to baseline/.test(c.because)));
});

test("an asset whose visibility could not be read is reported, not planned", () => {
  const plan = planVisibility({ mode: "apply", baseline, current: { [WRONG]: null, [RIGHT]: "team" } });
  assert.deepEqual(plan.unreadable.sort(), [PEND, WRONG].sort());
  assert.deepEqual(plan.changes, []);
  assert.match(renderPlan(plan), /could not be read — NOT planned/);
});

test("an asset in the baseline with no decision keeps the baseline and is listed as undecided", () => {
  const b = { assets: { [RIGHT]: { baseline_visibility: "team" } }, decisions: [] };
  const plan = planVisibility({ mode: "apply", baseline: b, current: { [RIGHT]: HIDDEN } });
  assert.deepEqual(plan.undecided, [RIGHT]);
  assert.deepEqual(plan.changes.map((c) => [c.asset_id, c.to]), [[RIGHT, "team"]]);
});

test("unknown mode throws", () => {
  assert.throws(() => planVisibility({ mode: "nuke", baseline, current: {} }), /mode must be/);
});

test("render lists changes and unchanged, or says nothing to change", () => {
  const plan = planVisibility({ mode: "reset", baseline, current: { [WRONG]: "team", [RIGHT]: "team", [PEND]: "team" } });
  assert.match(renderPlan(plan), /nothing to change/);
});

test("hide mode: named assets private, everything else at baseline, decisions ignored", () => {
  const plan = planVisibility({ mode: "hide", baseline, current: { [WRONG]: "team", [RIGHT]: "team", [PEND]: "team" }, hide: [RIGHT] });
  assert.deepEqual(plan.changes.map((c) => [c.asset_id, c.from, c.to]), [[RIGHT, "team", HIDDEN]]);
  assert.match(plan.changes[0].because, /leave-one-out: hidden/);
  // the rejected asset is NOT hidden in hide mode — decisions are not applied
  assert.ok(plan.unchanged.find((u) => u.asset_id === WRONG));
});

test("hide mode refuses an empty list or an id outside the baseline", () => {
  assert.throws(() => planVisibility({ mode: "hide", baseline, current: {}, hide: [] }), /at least one/);
  assert.throws(() => planVisibility({ mode: "hide", baseline, current: {}, hide: ["skl-nope"] }), /not in the baseline/);
});
