/**
 * 使用检测的参考判定,必须来自独立的操作证据。
 *
 * 现有的校准把**送达**当成"判定器说 used"的真值:内容到了就算判对,没到就算判错。
 * 那测的是送达一致性,不是实际使用。两者在这批数据里恰好高度重合,所以差别一直没
 * 暴露——但"模型读了资产、操作却没采用它"正是本课题要区分的情形,而在送达口径下
 * 它会被记成假阴性,把判定器的一次正确判断算成错误。
 *
 * 采纳的证据只能来自**操作本身**:`verdict.json` 的 attempts 记着任务被判定的那次
 * 尝试用了哪个地址、成功与否,它既不来自 delivery,也不来自待测的判定器。
 *
 * 三件事分开:
 *   送达 —— 内容是否到达模型      (capture)
 *   采纳 —— 操作是否实际用了它    (verdict.json attempts)
 *   收益 —— 用了以后是否奏效      (attempt.ok)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { adoptionFromAcceptance } from "./adoption.mjs";
import { classifyUsage, calibrateUsage } from "./calibration.mjs";

const TOKENS = {
  "skl-a": { tokens: ["10.244.7.19"] },
  "skl-b": { tokens: ["47318"] },
};

const attempt = (host, port, ok) => ({ host, port, endpoint: "skill:search", ok, call_id: `call_${port}` });

test("采纳来自操作证据:尝试用了该资产记录的地址,就是采纳", () => {
  const v = { verdict: "PASS", attempts: [attempt("127.0.0.1", "47318", true)] };
  const a = adoptionFromAcceptance(v, TOKENS);
  assert.equal(a["skl-b"].adopted, true, "操作用了 47318,skl-b 被采纳");
  assert.equal(a["skl-b"].benefited, true, "该次尝试 ok");
});

test("尝试失败仍然是采纳——收益是另一个问题", () => {
  const v = { verdict: "PASS", attempts: [attempt("10.244.7.19", "8096", false), attempt("127.0.0.1", "47318", true)] };
  const a = adoptionFromAcceptance(v, TOKENS);
  assert.equal(a["skl-a"].adopted, true, "地址被拨过就是采纳了它的内容");
  assert.equal(a["skl-a"].benefited, false, "但没奏效");
  assert.equal(a["skl-b"].adopted, true);
  assert.equal(a["skl-b"].benefited, true);
});

test("有尝试、且识别出用的是另一个资产,才可以判未采纳", () => {
  const v = { verdict: "PASS", attempts: [attempt("127.0.0.1", "47318", true)] };
  const a = adoptionFromAcceptance(v, TOKENS);
  assert.equal(a["skl-a"].adopted, false, "操作identifiably用了 skl-b 的地址,没用 skl-a 的");
  assert.equal(a["skl-a"].benefited, null, "没采纳就谈不上收益");
});

test("没有尝试记录 → 采纳未知,不能当作未采纳", () => {
  for (const v of [null, {}, { verdict: "ERROR", attempts: [] }]) {
    const a = adoptionFromAcceptance(v, TOKENS);
    assert.equal(a["skl-a"].adopted, null, `${JSON.stringify(v)} 应为 unknown`);
    assert.equal(a["skl-b"].adopted, null);
  }
});

test("有尝试但一个池内资产都对不上 → 未知,不是未采纳", () => {
  const v = { verdict: "PASS", attempts: [attempt("192.0.2.1", "9999", true)] };
  const a = adoptionFromAcceptance(v, TOKENS);
  assert.equal(a["skl-a"].adopted, null, "证据没有区分力时不得下判断");
  assert.equal(a["skl-b"].adopted, null);
});

// ---------------------------------------------------------------------------
// 四条分类规则 —— 参考判定是采纳,不是送达
// ---------------------------------------------------------------------------

test("已读但未采用、判未使用 → 真阴性,不是假阴性", () => {
  const c = classifyUsage({ judgedUsed: false, adopted: false });
  assert.equal(c.bucket, "true_negative",
    "送达口径会把这判成假阴性,那是把判定器的一次正确判断算成错误");
  assert.equal(c.counts_toward_rate, true);
});

test("已读但未采用、判已使用 → 假阳性", () => {
  const c = classifyUsage({ judgedUsed: true, adopted: false });
  assert.equal(c.bucket, "false_positive");
  assert.equal(c.counts_toward_rate, true);
});

test("确已采用、判未使用 → 假阴性", () => {
  const c = classifyUsage({ judgedUsed: false, adopted: true });
  assert.equal(c.bucket, "false_negative");
  assert.equal(c.counts_toward_rate, true);
});

test("确已采用、判已使用 → 真阳性", () => {
  const c = classifyUsage({ judgedUsed: true, adopted: true });
  assert.equal(c.bucket, "true_positive");
  assert.equal(c.counts_toward_rate, true);
});

test("采纳未知 → 不得塞进任何确定类别", () => {
  for (const judgedUsed of [true, false]) {
    const c = classifyUsage({ judgedUsed, adopted: null });
    assert.equal(c.bucket, "unknown_adoption", "未知就是未知");
    assert.equal(c.counts_toward_rate, false, "不能进分母");
  }
});

test("汇总单独报告未知数量与覆盖率", () => {
  const runs = [
    { run_id: "r1", assets: { "skl-a": { judgedUsed: true, adopted: true }, "skl-b": { judgedUsed: false, adopted: false } } },
    { run_id: "r2", assets: { "skl-a": { judgedUsed: true, adopted: null }, "skl-b": { judgedUsed: false, adopted: null } } },
  ];
  const r = calibrateUsage(runs);
  assert.equal(r.cumulative.true_positive, 1);
  assert.equal(r.cumulative.true_negative, 1);
  assert.equal(r.cumulative.unknown_adoption, 2, "未知单独一类");
  assert.equal(r.cumulative.decisions_rated, 2);
  assert.equal(r.cumulative.decisions_total, 4);
  assert.equal(r.cumulative.adoption_coverage, 0.5, "有采纳证据的比例要报出来");
});

test("没有任何可评样本时不产出准确率", () => {
  const r = calibrateUsage([
    { run_id: "r1", assets: { "skl-a": { judgedUsed: true, adopted: null } } },
  ]);
  assert.equal(r.cumulative.decisions_rated, 0);
  assert.equal(r.cumulative.accuracy, null, "分母为 0 时不得给出准确率");
});
