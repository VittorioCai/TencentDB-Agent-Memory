import { test } from "node:test";
import assert from "node:assert/strict";
import { calibrate, actedOn, renderCalibration, loadRun } from "./loo.mjs";

const W = "skl-wrong", R = "skl-right";
const run = (id, { visible, used = [], review = [], acted = [] }) => ({
  run_id: id, label: "x", verdict: "PASS",
  visible, judged_used: new Set(used), judged_review: new Set(review), acted: new Set(acted),
});
const both = { [W]: true, [R]: true };
const noW = { [W]: false, [R]: true };
const noR = { [W]: true, [R]: false };

test("mainline shape: wrong determined from the gate-on runs, right undetermined without an ablation run", () => {
  const runs = [
    run("off1", { visible: both, used: [W, R], acted: [W, R] }),
    run("off2", { visible: both, used: [W, R], acted: [W, R] }),
    run("off3", { visible: both, used: [W], review: [R], acted: [W, R] }),
    run("on1", { visible: noW, used: [R], acted: [R] }),
    run("on2", { visible: noW, review: [R], acted: [R] }),
    run("on3", { visible: noW, used: [R], acted: [R] }),
  ];
  const c = calibrate(runs, [W, R]);
  const w = c.rows.find((r) => r.asset_id === W), r = c.rows.find((x) => x.asset_id === R);
  assert.equal(w.status, "needed");
  assert.deepEqual([w.tp, w.fp, w.fn], [3, 0, 0]);
  assert.equal(w.precision, 1); assert.equal(w.recall, 1);
  assert.equal(r.status, "undetermined");
  assert.equal(r.precision, null);
  assert.match(r.note, /truth unknown, not assumed/);
  assert.equal(c.overall.assets_determined, 1);
  const text = renderCalibration(c);
  assert.match(text, /skl-right .* undetermined/);
  assert.match(text, /not 100%/);
});

test("with ablation runs for right: the withheld needs_review runs count as recall misses, not precision misses", () => {
  const runs = [
    run("off1", { visible: both, used: [W, R], acted: [W, R] }),
    run("off2", { visible: both, used: [W], review: [R], acted: [W, R] }),
    run("on1", { visible: noW, used: [R], acted: [R] }),
    run("on2", { visible: noW, review: [R], acted: [R] }),
    run("loo1", { visible: noR, used: [W], acted: [W] }),
    run("loo2", { visible: noR, used: [W], acted: [W] }),
  ];
  const r = calibrate(runs, [W, R]).rows.find((x) => x.asset_id === R);
  assert.equal(r.status, "needed");
  assert.equal(r.present, 4); assert.equal(r.absent, 2); assert.equal(r.acted_absent, 0);
  assert.deepEqual([r.tp, r.fp, r.fn], [2, 0, 2]);
  assert.equal(r.precision, 1);
  assert.equal(r.recall, 0.5);
  assert.match(r.note, /2 present run\(s\) acted on it without a used claim/);
});

test("leak: the token appears with the asset hidden → every used on it is a false positive", () => {
  const runs = [
    run("p1", { visible: both, used: [R], acted: [R] }),
    run("p2", { visible: both, used: [R], acted: [R] }),
    run("a1", { visible: noR, acted: [R] }), // acted without the asset
    run("a2", { visible: noR, acted: [] }),
  ];
  const r = calibrate(runs, [R]).rows[0];
  assert.equal(r.status, "leak");
  assert.deepEqual([r.tp, r.fp, r.fn], [0, 2, 0]);
  assert.equal(r.precision, 0);
  assert.match(r.note, /knew it from elsewhere/);
});

test("judged used but not acted in that run is a false positive; never acted on at all is 'not acted on'", () => {
  const runs = [
    run("p1", { visible: both, used: [R], acted: [] }),
    run("p2", { visible: both, used: [R], acted: [R] }),
    run("a1", { visible: noR, acted: [] }),
  ];
  const r = calibrate(runs, [R]).rows[0];
  assert.deepEqual([r.tp, r.fp, r.fn], [1, 1, 0]);
  assert.equal(r.precision, 0.5);
  const never = calibrate([run("p1", { visible: both, acted: [] }), run("a1", { visible: noR, acted: [] })], [R]).rows[0];
  assert.equal(never.status, "not acted on");
});

test("runs without a recorded gate state are left out and counted, not assumed visible", () => {
  const runs = [run("old", { visible: null, used: [R], acted: [R] }), run("p1", { visible: both, used: [R], acted: [R] }), run("a1", { visible: noR, acted: [] })];
  const c = calibrate(runs, [R]);
  assert.equal(c.runs_without_gate_state, 1);
  assert.equal(c.rows[0].present, 1);
  assert.match(renderCalibration(c), /1 run\(s\) recorded no gate state/);
});

test("actedOn reads tool-call arguments and dialled addresses, never the judge", () => {
  const ops = [{ kind: "tool_call", text: 'curl http://127.0.0.1:47318/x' }, { kind: "diff", text: "10.244.7.19" }];
  assert.equal(actedOn({ operations: ops, attempts: [] }, ["47318"]), true);
  assert.equal(actedOn({ operations: ops, attempts: [] }, ["10.244.7.19"]), false); // only in a diff, not a call
  assert.equal(actedOn({ operations: [], attempts: [{ host: "10.244.7.19", port: "8096" }] }, ["10.244.7.19"]), true);
  assert.equal(actedOn({ operations: [], attempts: [] }, []), false);
});

test("loadRun returns null for a non-run directory", () => {
  assert.equal(loadRun("/nonexistent", {}), null);
});
