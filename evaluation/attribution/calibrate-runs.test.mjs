/**
 * Which row a run lands in.
 *
 * The formal sample is the manifest (`batch4-runs.json`), not "every run whose
 * baseline says batch 4": the trial pair and the preparation runs carry the
 * same baseline and were being counted into the batch-4 row (28 decisions
 * instead of 20). The manifest decides membership; labels only name the
 * non-sample rows.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { experimentOf } from "./calibrate-runs.mjs";

const manifest = { batch: 4, runs: [{ run_id: "f1" }, { run_id: "f2" }] };

test("a run named in the manifest is the formal sample, whatever its label", () => {
  assert.equal(experimentOf({ label: "gate-off", run_id: "f1", base: "batch4", manifest }), "batch4");
  assert.equal(experimentOf({ label: "gate-on", run_id: "f2", base: "batch4", manifest }), "batch4");
});

test("the trial pair is its own row, not a sample", () => {
  assert.equal(experimentOf({ label: "trial-gate-off", run_id: "t1", base: "batch4", manifest }), "batch4-trial (checkpoint pair, not a sample)");
  assert.equal(experimentOf({ label: "trial-gate-on", run_id: "t2", base: "batch4", manifest: null }), "batch4-trial (checkpoint pair, not a sample)");
});

test("preparation runs stay the evidence-base row", () => {
  assert.equal(experimentOf({ label: "b4-prep", run_id: "p1", base: "batch4", manifest }), "batch4-prep (evidence base, not a sample)");
});

test("a batch-4 run that is neither in the manifest nor labelled prep/trial is listed apart, never folded into the sample", () => {
  assert.equal(experimentOf({ label: "gate-off", run_id: "stray", base: "batch4", manifest }), "batch4-other (not in the formal manifest)");
});

test("the manifest only governs its own batch; older batches keep their row", () => {
  assert.equal(experimentOf({ label: "gate-on-core", run_id: "old", base: "batch3", manifest }), "batch3");
});

// ── the same run passed twice is one run ──────────────────────────
// `runs/2026*-gate-*/` also matches `…-trial-gate-off`, so a call that lists
// the trial pair separately fed it twice (8 decisions from 2 runs, 2026-09-11).
import { uniqueDirs } from "./calibrate-runs.mjs";

test("a run directory named twice on the command line is analysed once", () => {
  assert.deepEqual(uniqueDirs(["runs/a/", "runs/b", "runs/a", "runs/b/"]), ["runs/a", "runs/b"]);
});
