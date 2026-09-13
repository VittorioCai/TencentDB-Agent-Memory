import { test } from "node:test";
import assert from "node:assert/strict";
import { missingFromSnapshot } from "./check-pool-snapshot.mjs";

const snap = { assets: [{ asset_id: "skl-a" }, { asset_id: "skl-b" }] };

test("登记了判别值的资产不在冻结池快照里 —— 点名", () => {
  assert.deepEqual(missingFromSnapshot(snap, { "skl-a": { version: 1 } }), []);
  assert.deepEqual(missingFromSnapshot(snap, { "skl-z": { version: 2 } }), ["skl-z"]);
});

test("下划线开头的是说明字段,不是资产", () => {
  assert.deepEqual(missingFromSnapshot(snap, { _note: "x", _history: [] }), []);
});

test("快照读不出来 = 未知,按缺处理(§2:未知不当通过)", () => {
  assert.deepEqual(missingFromSnapshot(null, { "skl-a": {} }), ["skl-a"]);
  assert.deepEqual(missingFromSnapshot({}, { "skl-a": {} }), ["skl-a"]);
});

// 2026-09-13:第三任务的笔记从来不在快照里,build-events 对它 continue,
// 三批 18 次有笔记运行一次 used 都没有,而 runner 只打了一行 warn。
test("只要有一个缺,就要拦住 —— 这正是那 18 次的根因", () => {
  const r = missingFromSnapshot({ assets: [{ asset_id: "skl-other" }] }, { "skl-XAzqAgejM7O4": { version: 2 } });
  assert.deepEqual(r, ["skl-XAzqAgejM7O4"]);
});
