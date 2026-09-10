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
import { baselineFindings, batchIsolation, isolationVerdict, onlyAgent } from "./isolation-check.mjs";

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

// ---------------------------------------------------------------------------
// 扫不到 ≠ 干净 —— 2026-09-09 独立审阅 D2 / D4
//
// 这两条是同一族:检查本身没跑成,结果却渲染成"通过"。本项目已经犯过四次。
// ---------------------------------------------------------------------------

test("watch 模式编译失败 → 不得报干净,要报未知并点名", () => {
  const r = baselineFindings([file("p.md", "任意内容")], [], ["(unclosed["]);
  assert.notEqual(r.clean, true, "唯一的模式根本没编译成功,却报了基线干净");
  assert.equal(r.clean, null, "没扫成是未知,不是扫过了没发现");
  assert.deepEqual(r.invalid_patterns, ["(unclosed["]);
});

test("合法模式仍然照常工作,不受非法模式牵连", () => {
  const r = baselineFindings([file("p.md", "probe every documented candidate")], [], ["(unclosed[", "probe every documented candidate"]);
  assert.equal(r.clean, false, "有确定的命中就是不干净");
  assert.equal(r.hits.length, 1);
  assert.equal(r.invalid_patterns.length, 1);
});

test("有文件没被扫到 → 同样是未知,不是干净", () => {
  const r = baselineFindings([{ path: "huge.md", text: null, skipped_bytes: 2_100_000 }], ["47318"], []);
  assert.equal(r.clean, null, "跳过的文件里可能正好写着答案");
  assert.equal(r.unscanned.length, 1);
  assert.equal(r.unscanned[0].path, "huge.md");
});

test("既有命中又有没扫到的 → 判不干净:已发现的污染是确定的", () => {
  const r = baselineFindings([file("p.md", "47318"), { path: "huge.md", text: null, skipped_bytes: 3_000_000 }], ["47318"], []);
  assert.equal(r.clean, false);
});

test("baseline_clean 未知时,总判决不通过,也不谎称失败", () => {
  const v = isolationVerdict({
    baseline: { clean: null, hits: [], invalid_patterns: ["(x["], unscanned: [] },
    batch: { same_baseline: true, rolled_back: true, unknown: [] },
  });
  assert.equal(v.ok, false);
  assert.ok(!v.failed.includes("baseline_clean"), "未知不是未过");
  assert.ok(v.unknown.some((u) => String(u).includes("baseline_clean")), "未知要单列出来");
});

test("基线按 agent 限定范围:别人的记忆到不了本次运行的模型", () => {
  const files = [
    file("team%3At1%7Cagent%3Aagt-old/persona.md", "上次 47318 成功"),
    file("team%3At1%7Cagent%3Aagt-new/persona.md", "空白"),
  ];
  assert.equal(onlyAgent(files, "agt-new").length, 1);
  assert.equal(baselineFindings(onlyAgent(files, "agt-new"), ["47318"], []).clean, true);
  assert.equal(baselineFindings(onlyAgent(files, "agt-old"), ["47318"], []).clean, false);
  assert.equal(onlyAgent(files, "").length, 2, "不指定 agent 时不过滤");
});

// ---------------------------------------------------------------------------
// 起点一致要按消费者自己的那份记忆比 —— 2026-09-10
//
// 快照的是整棵 profiles/,里面还有别的 agent。实测:批次三隔离重跑之后 73 分钟,
// 记忆流水线又往旧消费者的 profile 里写了四个文件(2026-09-08T23:20:56–59Z),
// 整树哈希从 7d7f4b44 变成 637768bf,而那些文件到不了新消费者的模型。整树哈希
// 一漂,same_baseline 就会把一批本来独立的运行判成不独立。所以 run.json 里若记了
// consumer_scope(只算消费者那一份的哈希),起点一致就按它比;没记的仍按整树。
// ---------------------------------------------------------------------------

test("记了 consumer_scope 的运行,起点一致按消费者范围的哈希比", () => {
  const r = batchIsolation([
    { run_id: "r1", agent_memory: { hash_before: "tree-A", hash_after: "tree-A", consumer_scope: { agent_id: "agt-new", hash_before: "scope-X", hash_after: "scope-X" } } },
    { run_id: "r2", agent_memory: { hash_before: "tree-B", hash_after: "tree-B", consumer_scope: { agent_id: "agt-new", hash_before: "scope-X", hash_after: "scope-X" } } },
  ]);
  assert.equal(r.same_baseline, true, "整树漂了,消费者那份没变——起点一致");
  assert.equal(r.scope, "consumer", "要说明比的是哪一层");
});

test("消费者范围的哈希不同 → 起点不一致,哪怕整树相同", () => {
  const r = batchIsolation([
    { run_id: "r1", agent_memory: { hash_before: "tree-A", hash_after: "tree-A", consumer_scope: { agent_id: "agt-new", hash_before: "scope-X", hash_after: "scope-X" } } },
    { run_id: "r2", agent_memory: { hash_before: "tree-A", hash_after: "tree-A", consumer_scope: { agent_id: "agt-new", hash_before: "scope-Y", hash_after: "scope-Y" } } },
  ]);
  assert.equal(r.same_baseline, false);
});

test("一部分运行记了 consumer_scope、一部分没记 → 不能混比,起点一致为未知", () => {
  const r = batchIsolation([
    { run_id: "r1", agent_memory: { hash_before: "tree-A", hash_after: "tree-A", consumer_scope: { agent_id: "agt-new", hash_before: "scope-X", hash_after: "scope-X" } } },
    { run_id: "r2", agent_memory: { hash_before: "tree-A", hash_after: "tree-A" } },
  ]);
  assert.equal(r.same_baseline, null, "两种口径的哈希不可比");
  assert.ok(r.unknown.includes("r2"));
});

test("没有任何运行记 consumer_scope → 仍按整树比,行为不变", () => {
  const r = batchIsolation([
    { run_id: "r1", agent_memory: { hash_before: "tree-A", hash_after: "tree-A" } },
    { run_id: "r2", agent_memory: { hash_before: "tree-A", hash_after: "tree-A" } },
  ]);
  assert.equal(r.same_baseline, true);
  assert.equal(r.scope, "tree");
});

// ---------------------------------------------------------------------------
// "运行期间写过" ≠ "没回滚" —— 2026-09-10 冒烟运行
//
// run.json 的 hash_after 是**还原之前**量的:它回答"这次运行写了什么"。还原成功与否
// 是另一个问题,由还原之后再量一次的 hash_restored 回答。冒烟运行里记忆流水线在
// 会话内就写了 4 个文件,还原成功(profile 目录已不存在),isolation-check 却报
// rolled_back 未过——它拿 hash_after 当还原结果。有 hash_restored 就按它比;
// 没有的老运行仍按 hash_after,并说明比的是哪个。
// ---------------------------------------------------------------------------

test("记了 hash_restored 的运行:还原后等于起点就是已回滚,哪怕运行期间写过", () => {
  const r = batchIsolation([
    { run_id: "r1", agent_memory: { hash_before: "A", hash_after: "B", hash_restored: "A", written_during_run: true } },
  ]);
  assert.equal(r.rolled_back, true, "写过、但还原回了 A");
  assert.equal(r.rolled_back_by, "hash_restored");
});

test("hash_restored 不等于起点 → 没回滚", () => {
  const r = batchIsolation([
    { run_id: "r1", agent_memory: { hash_before: "A", hash_after: "B", hash_restored: "C" } },
  ]);
  assert.equal(r.rolled_back, false);
  assert.deepEqual(r.not_rolled_back, ["r1"]);
});

test("没记 hash_restored 的老运行仍按 hash_after 比,并说明", () => {
  const r = batchIsolation([
    { run_id: "r1", agent_memory: { hash_before: "A", hash_after: "A" } },
  ]);
  assert.equal(r.rolled_back, true);
  assert.equal(r.rolled_back_by, "hash_after");
});

test("consumer_scope 也一样:有 hash_restored 按它比", () => {
  const r = batchIsolation([
    { run_id: "r1", agent_memory: { hash_before: "T1", hash_after: "T2", hash_restored: "T1",
      consumer_scope: { agent_id: "agt-new", hash_before: "S1", hash_after: "S2", hash_restored: "S1" } } },
  ]);
  assert.equal(r.scope, "consumer");
  assert.equal(r.rolled_back, true);
});
