/**
 * 报告正文也是结论,所以正文也必须由计算结果生成。
 *
 * 表格早已由脚本生成,正文却还是写死的散文——里面有"FP 0、FN 0,一个反例都没有"
 * "假阴性一列是 0""真实错误率不会被低估"这样的断言。只要换一批数据,表格会变,
 * 这些句子不会变,于是报告会一边列出反例、一边宣称没有反例。
 *
 * 写死的结论比写错的数字更难发现:数字有人核,散文没人核。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { report } from "./calibrate-runs.mjs";

/** 一个最小的送达汇总,数字可控。 */
const tally = (o = {}) => ({
  true_positive: 0, false_positive: 0, true_negative: 0, false_negative: 0,
  isolation_failure: 0, unsettled: 0, decisions_rated: 0, decisions_total: 0,
  accuracy: null, unmeasurable_share: null, ...o,
});

const deliveryWith = (t) => ({
  rows: [], cumulative: t, by_rules_version: { "rules-x": t }, table: "(表格)",
});

const usageWith = (t) => ({
  rows: [], cumulative: { ...t, unknown_adoption: t.unknown_adoption ?? 0, adoption_coverage: t.adoption_coverage ?? null },
  by_rules_version: { "rules-x": { ...t, unknown_adoption: t.unknown_adoption ?? 0, adoption_coverage: t.adoption_coverage ?? null } },
  table: "(使用表格)",
});

const FORBIDDEN_WHEN_NONZERO = ["FP 0、FN 0", "一个反例都没有", "假阴性一列是 0", "至今没有任何反例"];

test("输入含非零假阳性时,正文不得仍宣称零", () => {
  const t = tally({ true_positive: 3, false_positive: 2, decisions_rated: 5, decisions_total: 5, accuracy: 0.6 });
  const text = report(deliveryWith(t), { frozen: "rules-x", runs: [], usage: usageWith(t) });
  for (const claim of FORBIDDEN_WHEN_NONZERO) {
    assert.ok(!text.includes(claim), `有 2 个假阳性,正文却仍写着「${claim}」`);
  }
  assert.ok(/假阳性[^0-9]{0,8}2/.test(text), "正文要说出实际的假阳性个数");
});

test("输入含非零假阴性时,正文不得仍宣称零", () => {
  const t = tally({ true_positive: 3, false_negative: 1, decisions_rated: 4, decisions_total: 4, accuracy: 0.75 });
  const text = report(deliveryWith(t), { frozen: "rules-x", runs: [], usage: usageWith(t) });
  for (const claim of FORBIDDEN_WHEN_NONZERO) {
    assert.ok(!text.includes(claim), `有 1 个假阴性,正文却仍写着「${claim}」`);
  }
  assert.ok(/假阴性[^0-9]{0,8}1/.test(text), "正文要说出实际的假阴性个数");
});

test("确实为零时,才可以说零", () => {
  const t = tally({ true_positive: 5, true_negative: 5, decisions_rated: 10, decisions_total: 10, accuracy: 1 });
  const text = report(deliveryWith(t), { frozen: "rules-x", runs: [], usage: usageWith(t) });
  assert.ok(/没有.{0,12}假阳性|假阳性.{0,6}0/.test(text), "零的时候要如实说零");
});

test("没有可评样本时,不得输出准确率或错误率保证", () => {
  const t = tally({ unsettled: 6, decisions_rated: 0, decisions_total: 6, accuracy: null });
  const text = report(deliveryWith(t), { frozen: "rules-x", runs: [], usage: usageWith({ ...t, unknown_adoption: 6, adoption_coverage: 0 }) });
  assert.ok(!text.includes("不会低估"), "没有可评样本,谈不上低不低估");
  assert.ok(!/准确率\s*(是\s*)?1(\.0+)?\b/.test(text) && !text.includes("准确率 100%"), "不得给出 100% 准确率");
  assert.ok(/没有.{0,10}可评|无可评样本|可评样本.{0,4}0/.test(text), "要明说这批没有可评样本");
});

test("使用检测与送达一致性必须分开命名", () => {
  const t = tally({ true_positive: 4, decisions_rated: 4, decisions_total: 4, accuracy: 1 });
  const text = report(deliveryWith(t), { frozen: "rules-x", runs: [], usage: usageWith(t) });
  assert.ok(text.includes("送达一致性"), "送达那张表要叫送达一致性");
  assert.ok(!/送达一致性[^\n]{0,20}使用准确率/.test(text), "不得把送达一致性称作使用准确率");
  assert.ok(/采纳|实际使用/.test(text), "要有独立的采纳/实际使用一节");
});

test("未知采纳的数量与覆盖率必须出现在正文里", () => {
  const t = tally({ true_positive: 2, decisions_rated: 2, decisions_total: 6, accuracy: 1 });
  const u = usageWith({ ...t, unknown_adoption: 4, adoption_coverage: 0.333 });
  const text = report(deliveryWith(t), { frozen: "rules-x", runs: [], usage: u });
  assert.ok(text.includes("4"), "未知项个数要写出来");
  assert.ok(/覆盖率|coverage/i.test(text), "覆盖率要写出来");
});

test("三件事在正文里各自命名,不互相顶替", () => {
  const t = tally({ true_positive: 1, decisions_rated: 1, decisions_total: 1, accuracy: 1 });
  const text = report(deliveryWith(t), { frozen: "rules-x", runs: [], usage: usageWith(t) });
  for (const word of ["送达", "采纳", "收益"]) {
    assert.ok(text.includes(word), `正文缺少「${word}」这一项`);
  }
});
