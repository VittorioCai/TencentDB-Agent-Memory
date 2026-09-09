/**
 * 隔离验收:哈希相同只说明**起点一致**,不说明起点**干净**。
 *
 * 批次三的 gate-on 臂重跑过一次,五次都报 `isolated: true`、`hash_before` 与
 * `hash_after` 相同。那证明了五次从同一个记忆状态出发——但那个状态里含着
 * `47318`(4 个文件)、`10.244.7.19`(4 个文件)和这次任务的 SOP 结论。
 * 五次运行彼此独立,而且**一致地被污染**。
 *
 * 所以隔离要分开验三件事:
 *
 *   1. 基线里没有答案            —— 内容检查,不是哈希检查
 *   2. 每次运行从同一基线出发    —— hash_before 一致
 *   3. 运行写下的东西不会传给下一次 —— hash_after == hash_before
 *
 * 第 1 条是新的,也是原来缺的那条。未记录 `agent_memory` 的运行是**未知**,
 * 既不算通过也不算失败。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { baselineFindings, batchIsolation, isolationVerdict } from "./isolation-check.mjs";

const file = (path, text) => ({ path, text });

test("基线含 token → 不干净,并指出是哪个文件", () => {
  const r = baselineFindings(
    [file("agt-x/persona.md", "上次 47318 成功"), file("agt-x/scene_blocks/a.md", "无关")],
    ["47318", "10.244.7.19"], [],
  );
  assert.equal(r.clean, false);
  assert.equal(r.hits.length, 1);
  assert.equal(r.hits[0].path, "agt-x/persona.md");
  assert.equal(r.hits[0].needle, "47318");
});

test("基线含被观察的结论行 → 也不干净,即使没有 token", () => {
  const r = baselineFindings(
    [file("agt-x/scene_blocks/sop.md", "probe every documented candidate under bounded timeout")],
    ["rk-abc"], ["probe every documented candidate"],
  );
  assert.equal(r.clean, false, "答案不只以 token 形态存在,结论本身也是答案");
  assert.equal(r.hits[0].kind, "watch");
});

test("基线既无 token 也无结论行 → 干净", () => {
  const r = baselineFindings([file("agt-x/persona.md", "偏好简洁回答")], ["rk-abc"], ["probe every"]);
  assert.equal(r.clean, true);
  assert.deepEqual(r.hits, []);
});

test("哈希一致只回答第二个问题,不回答第一个", () => {
  const runs = [
    { run_id: "r1", agent_memory: { hash_before: "aaa", hash_after: "aaa" } },
    { run_id: "r2", agent_memory: { hash_before: "aaa", hash_after: "aaa" } },
  ];
  const b = batchIsolation(runs);
  assert.equal(b.same_baseline, true);
  assert.equal(b.rolled_back, true);
  assert.equal(b.baseline_clean, null, "这个函数看不到内容,不得替内容检查作答");
});

test("起点不同 → 不是同一基线", () => {
  const b = batchIsolation([
    { run_id: "r1", agent_memory: { hash_before: "aaa", hash_after: "aaa" } },
    { run_id: "r2", agent_memory: { hash_before: "bbb", hash_after: "bbb" } },
  ]);
  assert.equal(b.same_baseline, false);
  assert.deepEqual(b.baselines.sort(), ["aaa", "bbb"]);
});

test("运行写下的东西没回滚 → 会传给下一次", () => {
  const b = batchIsolation([
    { run_id: "r1", agent_memory: { hash_before: "aaa", hash_after: "zzz" } },
  ]);
  assert.equal(b.rolled_back, false);
  assert.deepEqual(b.not_rolled_back, ["r1"]);
});

test("没记 agent_memory 的运行是未知,不是通过也不是失败", () => {
  const b = batchIsolation([
    { run_id: "r1", agent_memory: { hash_before: "aaa", hash_after: "aaa" } },
    { run_id: "r2" },
  ]);
  assert.deepEqual(b.unknown, ["r2"]);
  assert.equal(b.same_baseline, null, "有未知项时不得断言起点一致");
});

test("总判决要三条全过才通过,并说明是哪一条没过", () => {
  const pass = isolationVerdict({
    baseline: { clean: true, hits: [] },
    batch: { same_baseline: true, rolled_back: true, unknown: [], baselines: ["aaa"], not_rolled_back: [] },
  });
  assert.equal(pass.ok, true);

  const dirty = isolationVerdict({
    baseline: { clean: false, hits: [{ path: "p", needle: "47318", kind: "token" }] },
    batch: { same_baseline: true, rolled_back: true, unknown: [], baselines: ["aaa"], not_rolled_back: [] },
  });
  assert.equal(dirty.ok, false);
  assert.ok(dirty.failed.includes("baseline_clean"),
    "哈希都对但基线含答案,仍然不算隔离——这正是批次三那次重跑的情形");
});

test("有未知项时总判决不通过,也不谎称失败", () => {
  const v = isolationVerdict({
    baseline: { clean: true, hits: [] },
    batch: { same_baseline: null, rolled_back: true, unknown: ["r2"], baselines: ["aaa"], not_rolled_back: [] },
  });
  assert.equal(v.ok, false);
  assert.ok(v.unknown.includes("r2"));
  assert.ok(!v.failed.includes("same_baseline"), "未知不是失败,要单列");
});
