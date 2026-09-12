/**
 * 登记簿的保留规则(2026-09-12 审阅):只保留已交付批次的条目,新批次前归档旧条目,
 * 不做永久累积——否则轮换几次之后,登记簿就成了"历史判别值大全"。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitStale, keyOf } from "./build-burned-registry.mjs";

const reg = () => ({
  _meta: { what: "test" },
  "skl-a": { burned: { 3: { tokens: ["bt-old3"] }, 4: { tokens: ["bt-new4"] } } },
  "skl-b": { burned: { 1: { tokens: ["bt-onlyold"] } } },
  "skl-c": { burned: { 2: { tokens: ["bt-kept"] } } },
});

test("keyOf: 条目由「资产 + 版本」定位(登记簿新增的正是这个映射)", () => {
  assert.equal(keyOf("skl-a", 4), "skl-a@4");
  assert.equal(keyOf("skl-a", "4"), "skl-a@4");
});

test("本批次引用的版本留下,其余移入归档;整条资产都过期就整条移走", () => {
  const keep = new Set([keyOf("skl-a", 4), keyOf("skl-c", 2)]);
  const { kept, stale, staleCount } = splitStale(reg(), keep);
  assert.deepEqual(Object.keys(kept).sort(), ["_meta", "skl-a", "skl-c"]);
  assert.deepEqual(Object.keys(kept["skl-a"].burned), ["4"]);
  assert.equal(staleCount, 2);
  assert.deepEqual(Object.keys(stale).sort(), ["skl-a", "skl-b"]);
  assert.deepEqual(Object.keys(stale["skl-a"].burned), ["3"]);
  assert.deepEqual(Object.keys(stale["skl-b"].burned), ["1"]);
});

test("本批次引用了全部条目 → 没有旧条目,登记簿原样(不因为跑了一次就变动)", () => {
  const keep = new Set([keyOf("skl-a", 3), keyOf("skl-a", 4), keyOf("skl-b", 1), keyOf("skl-c", 2)]);
  const { kept, staleCount } = splitStale(reg(), keep);
  assert.equal(staleCount, 0);
  assert.deepEqual(Object.keys(kept["skl-a"].burned).sort(), ["3", "4"]);
});

test("_meta 不算条目,永远留在保留侧,不进归档", () => {
  const { kept, stale } = splitStale(reg(), new Set());
  assert.ok(kept._meta);
  assert.equal(stale._meta, undefined);
  assert.deepEqual(Object.keys(kept).filter((k) => k !== "_meta"), []);
});

test("归档合并:已有归档文件里的条目不被覆盖,新旧并存", () => {
  const existing = { "skl-a": { burned: { 2: { tokens: ["bt-older"] } } } };
  const { stale } = splitStale(reg(), new Set([keyOf("skl-a", 4), keyOf("skl-b", 1), keyOf("skl-c", 2)]), existing);
  assert.deepEqual(Object.keys(stale["skl-a"].burned).sort(), ["2", "3"]);
});
