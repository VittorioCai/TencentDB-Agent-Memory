/**
 * `conditions-check` 那 20 项 FAIL 原来在交付里整块写成"按设计如此"。第六轮复核指出:
 * 里面至少混着三种性质,而**记录缺口不能被"按设计"概括** —— 其中一项 FAIL 的原因是
 * `20260911T175839Z-devloop-smoke` 缺 `capture.jsonl`,来源扫描因此不完整。
 *
 * 这里把允许出现的 FAIL 逐项登记(性质 + 原因),并规定:**未登记的 FAIL 一律阻断**,
 * 登记了却不再失败的项要报出来清掉(否则登记簿会变成永不失效的免罪符)。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, CLASSES } from "./conditions-classify.mjs";

const reg = {
  allowed: [
    { item: "甲", class: "post_batch", why: "批次后状态变了" },
    { item: "乙", class: "known_limitation", why: "已载明的隔离缺口" },
    { item: "丙", class: "record_gap", why: "某次运行缺 capture.jsonl" },
  ],
};

test("三种性质都要有,且 record_gap 不属于「按设计」", () => {
  assert.deepEqual(Object.keys(CLASSES).sort(), ["known_limitation", "post_batch", "record_gap"]);
  assert.equal(CLASSES.record_gap.by_design, false);
  assert.equal(CLASSES.post_batch.by_design, true);
});

test("全部 FAIL 都已登记 → 通过,并按性质分组", () => {
  const r = classify(["甲", "乙", "丙"], reg);
  assert.equal(r.ok, true);
  assert.deepEqual(r.by_class.post_batch.map((x) => x.item), ["甲"]);
  assert.deepEqual(r.by_class.record_gap.map((x) => x.item), ["丙"]);
  assert.equal(r.record_gaps.length, 1, "记录缺口要单独拿出来,不能混进「按设计」");
});

test("出现未登记的 FAIL → 阻断", () => {
  const r = classify(["甲", "丁"], reg);
  assert.equal(r.ok, false);
  assert.deepEqual(r.unregistered, ["丁"]);
});

test("登记了却不再失败 → 报为过期,提示清掉", () => {
  const r = classify(["甲"], reg);
  assert.deepEqual(r.stale.sort(), ["丙", "乙"]);
  assert.equal(r.ok, true, "过期项不阻断,但必须报出来");
});

test("摘要句把三类分开,并单独点出记录缺口", () => {
  const s = classify(["甲", "乙", "丙"], reg).line;
  assert.match(s, /批次后/);
  assert.match(s, /已知限制/);
  assert.match(s, /记录缺口 1 项/);
  assert.doesNotMatch(s, /全部按设计/);
});
