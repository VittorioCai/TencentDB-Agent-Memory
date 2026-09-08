/**
 * The rules the review fixed, each as the case that would otherwise be
 * counted wrong.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { classify, calibrate, renderCalibration } from "./calibration.mjs";

test("hidden, confirmed undelivered, judged used — that is the judge's false positive", () => {
  const c = classify({ judgedUsed: true, hidden: true, verdict: "not_delivered" });
  assert.equal(c.bucket, "false_positive");
  assert.equal(c.counts_toward_rate, true);
});

test("hidden yet delivered is an isolation failure, and NOT a judging error", () => {
  // Calling it used was right — the content did reach the model. What failed
  // is the setup. Counting this against the judge would hide a real hole and
  // make the judge look worse than it is.
  const c = classify({ judgedUsed: true, hidden: true, verdict: "delivered" });
  assert.equal(c.bucket, "isolation_failure");
  assert.equal(c.counts_toward_rate, false);
  // Same verdict whether or not the judge called it used: the leak is the fact.
  assert.equal(classify({ judgedUsed: false, hidden: true, verdict: "delivered" }).bucket, "isolation_failure");
});

test("the ordinary right answers", () => {
  assert.equal(classify({ judgedUsed: true, hidden: false, verdict: "delivered" }).bucket, "true_positive");
  assert.equal(classify({ judgedUsed: false, hidden: false, verdict: "not_delivered" }).bucket, "true_negative");
  assert.equal(classify({ judgedUsed: false, hidden: false, verdict: "delivered" }).bucket, "false_negative");
});

test("content that arrived after the operation cannot have been used by it", () => {
  const c = classify({ judgedUsed: true, hidden: false, verdict: "after_operation" });
  assert.equal(c.bucket, "false_positive");
  assert.match(c.why, /after_operation/);
});

test("anything the audit could not settle counts for neither side", () => {
  for (const v of ["ambiguous_source", "not_seen_in_capture", "source_unknown", "delivered_order_unknown", "model_echo"]) {
    const c = classify({ judgedUsed: true, hidden: true, verdict: v });
    assert.equal(c.bucket, "unsettled", v);
    assert.equal(c.counts_toward_rate, false, v);
  }
});

test("rule sets are tallied apart, and the unmeasurable share is shown beside the rate", () => {
  const runs = [
    { run_id: "r1", label: "gate-on", rules_version: "old", assets: {
      a: { judgedUsed: true, hidden: true, verdict: "not_delivered" },      // FP
      b: { judgedUsed: true, hidden: false, verdict: "delivered" } } },      // TP
    { run_id: "r2", label: "gate-on", rules_version: "frozen", assets: {
      a: { judgedUsed: false, hidden: true, verdict: "not_delivered" },      // TN
      b: { judgedUsed: true, hidden: false, verdict: "delivered" },          // TP
      c: { judgedUsed: true, hidden: true, verdict: "ambiguous_source" } } }, // unsettled
  ];
  const r = calibrate(runs);
  assert.equal(r.by_rules_version.old.false_positive, 1);
  assert.equal(r.by_rules_version.old.accuracy, 0.5);
  assert.equal(r.by_rules_version.frozen.false_positive, 0);
  assert.equal(r.by_rules_version.frozen.accuracy, 1);
  assert.equal(r.by_rules_version.frozen.unsettled, 1);
  // Two of three frozen decisions were measurable.
  assert.equal(r.by_rules_version.frozen.decisions_rated, 2);
  assert.equal(r.by_rules_version.frozen.decisions_total, 3);
  // Cumulative mixes rule sets, so it describes history and verifies nothing.
  assert.equal(r.cumulative.decisions_total, 5);
  const md = renderCalibration(r, { frozenRules: "frozen" });
  assert.match(md, /rules frozen \(frozen\)/);
  assert.match(md, /isolation failure is not a judging error/);
});

test("every row carries what it was measured under", () => {
  const r = calibrate([{ run_id: "r1", label: "gate-on", rules_version: "v", started_at: "t",
    baseline_frozen_at: "b", model: "m", assets: { a: { judgedUsed: true, hidden: false, verdict: "delivered", asset_version: 2 } } }]);
  assert.deepEqual(
    (({ run_id, rules_version, baseline_frozen_at, model, asset_version }) => ({ run_id, rules_version, baseline_frozen_at, model, asset_version }))(r.rows[0]),
    { run_id: "r1", rules_version: "v", baseline_frozen_at: "b", model: "m", asset_version: 2 });
});

test("REPRO: a hidden asset delivered from a known other source is an isolation failure, not unmeasurable", () => {
  // The one real leak in batch 3 was filed as "unsettled" and vanished from
  // the table — the row the table exists to show. Content that arrived, by a
  // route that is identified, is an arrival.
  const c = classify({ judgedUsed: false, hidden: true, verdict: "delivered_from_other_source" });
  assert.equal(c.bucket, "isolation_failure");
  // Not judged used, and still an isolation failure: the leak is the fact,
  // independent of what the judge said about it.
  assert.equal(c.counts_toward_rate, false);
  assert.equal(classify({ judgedUsed: true, hidden: true, verdict: "delivered_from_other_source" }).bucket, "isolation_failure");
});

test("the same delivery on a NOT-hidden asset is an ordinary arrival, judged as such", () => {
  assert.equal(classify({ judgedUsed: true, hidden: false, verdict: "delivered_from_other_source" }).bucket, "true_positive");
  assert.equal(classify({ judgedUsed: false, hidden: false, verdict: "delivered_from_other_source" }).bucket, "false_negative");
});

test("source_unknown remains unmeasurable — the record does not reach", () => {
  assert.equal(classify({ judgedUsed: true, hidden: true, verdict: "source_unknown" }).bucket, "unsettled");
});
