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

test("REPRO: when coverage is asserted, the model's own words are proof of NON-delivery", () => {
  // model_authored and model_echo both mean nothing reached the model. Filing
  // them as unsettled makes "the model dialled an address it was never given,
  // and the judge called it used" unmeasurable — which is precisely the false
  // positive the calibration exists to catch.
  for (const v of ["model_authored", "model_echo"]) {
    const c = classify({ judgedUsed: true, hidden: true, verdict: v, coverageAsserted: true });
    assert.equal(c.bucket, "false_positive", v);
    assert.equal(c.counts_toward_rate, true, v);
    // Not judged used and nothing arrived is an ordinary true negative.
    assert.equal(classify({ judgedUsed: false, hidden: true, verdict: v, coverageAsserted: true }).bucket, "true_negative", v);
  }
});

test("without asserted coverage the same verdicts stay unsettled — absence is not yet evidence", () => {
  const c = classify({ judgedUsed: true, hidden: true, verdict: "model_authored", coverageAsserted: false });
  assert.equal(c.bucket, "unsettled");
});

test("REPRO: an unknown isolation condition must not be rendered as `not hidden`", () => {
  // Batch 1 recorded no gate block, so hidden defaulted to false and three
  // gate-on runs were filed as true negatives. Had one of them leaked it
  // would have been a true negative too — which is why that batch's
  // "isolation failures: 0" was structurally guaranteed rather than measured.
  const c = classify({ judgedUsed: false, hidden: null, verdict: "delivered", coverageAsserted: true });
  assert.equal(c.bucket, "unsettled");
  assert.match(c.why, /whether it was hidden/);
  // Known-not-hidden is unaffected.
  assert.equal(classify({ judgedUsed: false, hidden: false, verdict: "delivered", coverageAsserted: true }).bucket, "false_negative");
});

// ---------------------------------------------------------------------------
// 按 (rules_version, 实验标识) 分组 —— 2026-09-10
//
// 只按 rules_version 分组,会把同一规则下的不同实验(不同 token、消费者、资产版本)
// 混成一行。批次四换了 token 和消费者,规则仍是 08f,若和批次三合成一行,读者会
// 以为反例问题在一个更大的样本上解决了——没有。所以再按实验标识分一层,旧批次
// 各自单独一行。
// ---------------------------------------------------------------------------

test("calibrate 同时按 (rules_version, experiment) 分组;旧批次各自成行", () => {
  const runs = [
    { run_id: "r1", rules_version: "08f", experiment: "batch3", assets: {
      a: { judgedUsed: true, hidden: false, verdict: "delivered" } } },              // TP
    { run_id: "r2", rules_version: "08f", experiment: "batch4", assets: {
      a: { judgedUsed: true, hidden: true, verdict: "not_delivered" } } },           // FP
    { run_id: "r3", rules_version: "unrecorded", experiment: "pre-batch (2026-09-05)", assets: {
      a: { judgedUsed: true, hidden: false, verdict: "delivered" } } },              // TP
  ];
  const r = calibrate(runs);
  // 同规则下,batch3 与 batch4 不并成一行
  assert.equal(r.by_experiment["08f · batch3"].true_positive, 1);
  assert.equal(r.by_experiment["08f · batch3"].false_positive, 0);
  assert.equal(r.by_experiment["08f · batch4"].false_positive, 1);
  assert.equal(r.by_experiment["08f · batch3"].accuracy, 1);
  assert.equal(r.by_experiment["08f · batch4"].accuracy, 0);
  // 旧批次单独一行
  assert.ok(r.by_experiment["unrecorded · pre-batch (2026-09-05)"]);
  // by_rules_version 仍在(向后兼容)
  assert.equal(r.by_rules_version["08f"].true_positive, 1);
  assert.equal(r.by_rules_version["08f"].false_positive, 1);
});

test("renderCalibration 打出实验分组表,每行标 rules 与实验", () => {
  const runs = [
    { run_id: "r1", rules_version: "08f", experiment: "batch3", assets: { a: { judgedUsed: true, hidden: false, verdict: "delivered" } } },
    { run_id: "r2", rules_version: "08f", experiment: "batch4", assets: { a: { judgedUsed: true, hidden: true, verdict: "not_delivered" } } },
  ];
  const md = renderCalibration(calibrate(runs), { frozenRules: "08f", byExperiment: true });
  assert.match(md, /batch3/);
  assert.match(md, /batch4/);
});

test("准备运行(标签 *-prep)单独成行:是证据基础,不是样本", () => {
  const runs = [
    { run_id: "p1", rules_version: "08f", experiment: "batch4-prep (evidence base, not a sample)", assets: { a: { judgedUsed: true, hidden: false, verdict: "delivered" } } },
    { run_id: "f1", rules_version: "08f", experiment: "batch4", assets: { a: { judgedUsed: true, hidden: false, verdict: "delivered" } } },
  ];
  const r = calibrate(runs);
  assert.ok(r.by_experiment["08f · batch4-prep (evidence base, not a sample)"]);
  assert.ok(r.by_experiment["08f · batch4"]);
  assert.equal(r.by_experiment["08f · batch4"].decisions_total, 1, "准备运行不进正式行");
});
