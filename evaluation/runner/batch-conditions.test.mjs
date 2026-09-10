/**
 * --freeze 不得清空已有的证据与判定 —— 2026-09-11 审阅
 *
 * 冻结条件是一回事,冻结闸门证据是另一回事(由 build-baseline.mjs 从准备运行生成)。
 * 原来 --freeze 每次都把 gate_baseline 的 events/decisions 写成空,准备运行之后再冻结
 * 条件就把证据抹了。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { gateBaselineToWrite } from "./batch-conditions.mjs";

const fresh = { schema_version: "gate-baseline-v1", batch: 4, frozen_at: "2026-09-11T00:00:00Z", assets: { a: { version: 4 } }, decisions: [], events: [], rules_version: "r" };

test("没有已有基线 → 写新的", () => {
  const w = gateBaselineToWrite(null, fresh);
  assert.equal(w.write, true);
  assert.deepEqual(w.doc.decisions, []);
});

test("已有基线没有证据 → 可以覆盖", () => {
  const w = gateBaselineToWrite({ ...fresh, decisions: [], events: [] }, fresh);
  assert.equal(w.write, true);
});

test("已有基线带证据与判定 → 不覆盖,只报保留", () => {
  const existing = { ...fresh, frozen_at: "2026-09-10T00:00:00Z", decisions: [{ asset_id: "a", decision: "reject" }], events: [{ e: 1 }], source_runs: ["r1"] };
  const w = gateBaselineToWrite(existing, fresh);
  assert.equal(w.write, false);
  assert.match(w.why, /证据|decisions/);
  assert.equal(w.doc, existing);
});
