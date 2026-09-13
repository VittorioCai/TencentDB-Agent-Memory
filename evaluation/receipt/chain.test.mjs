/**
 * 闭环展示:把一次真实运行按「原始经验 → 笔记与适用条件 → 检索与取回 → 实际新增的测试/代码
 * → 独立验收 → Core 判定 → 新候选」七环串起来,每一环都能打开看证据。
 *
 * 第六轮复核要的是"评委沿着最终主张追下去,能找到证据,或明确知道断在哪里"。所以这里的硬规则是:
 * **某一环没有证据,就显示为「未证明」并说明为什么,绝不拿相邻证据顶替。**
 * 两个反例同样重要:送达了却没采用(证明系统不把送达当使用)、采用了却被保守漏判
 * (证明系统如实展示自己的边界)。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildChain, renderChain, LINKS } from "./chain.mjs";

const src = {
  events: [{ state: "fetched", asset_id: "skl-note", asset_name: "eval-tool-result-exit-line",
             asset_version: 2, event_id: "evt-1", run_id: "R" }],
  candidateLog: [{ trigger: "prewarm", hits: [], listing: "<available_skills>\n(none)\n</available_skills>" }],
  verdict: { verdict: "PASS", acceptance_version: "repo-2026-09-11c",
             reason: "reference test passed (7/7)", attempts: [{ kind: "added_test", value: "bt-x", ok: true }] },
  outcomes: { posted: [{ outcome_id: "o-1", state: "validated", asset_id: "skl-note" }], trusted: 1 },
  gate: { decision: "admit", status_target: "approved", rules_version: "gate-rules-2026-09-08f" },
  note: { path: "evaluation/tasks/exit-code-fix/assets/note.md", applies_when: "工具结果只给退出码时" },
  candidates: [{ asset_id: "skl-new", status: "candidate" }],
};

test("七环齐全,顺序固定", () => {
  assert.equal(LINKS.length, 7);
  const c = buildChain("R", src);
  assert.deepEqual(c.links.map((l) => l.n), [1, 2, 3, 4, 5, 6, 7]);
});

test("每一环都要指名证据文件 —— 没有出处的环节不允许出现", () => {
  for (const l of buildChain("R", src).links) {
    if (l.proven) assert.ok(l.evidence.length > 0 && l.evidence.every((e) => e.file), `第 ${l.n} 环缺出处`);
  }
});

test("缺证据的环节显示为「未证明」并说明原因,不拿相邻证据顶替", () => {
  const c = buildChain("R", { ...src, outcomes: null });
  const link = c.links.find((l) => l.n === 6);
  assert.equal(link.proven, false);
  assert.match(link.why_not, /core-outcomes/);
  assert.equal(link.evidence.length, 0);
  assert.equal(c.complete, false);
});

test("注入清单为空时,如实说明送达来自模型自己的检索,而不是注入", () => {
  const l = buildChain("R", src).links.find((x) => x.n === 3);
  assert.match(l.said, /注入清单为空|模型自己检索/);
});

test("反例一:送达多次、采用一次 —— 明说系统不把送达当使用", () => {
  const many = { ...src, events: [1,2,3,4,5].map((i) => ({ state: "fetched", asset_id: `skl-${i}`, event_id: `e${i}`, run_id: "R" })) };
  const c = buildChain("R", many, { case: "delivered_not_adopted" });
  assert.match(c.headline, /送达 5 次.*采用 1 次/);
  assert.match(c.headline, /送达不等于使用|不把送达当使用/);
});

test("反例二:采用成立但判定器未产出 used —— 记为假阴性且计入分母", () => {
  const fn = { ...src, judged_used: false, reference_adopted: true };
  const c = buildChain("R", fn, { case: "adopted_but_flagged" });
  assert.match(c.headline, /假阴性/);
  assert.match(c.headline, /计入分母/);
  assert.match(c.headline, /不是弃权/, "要明说它不是弃权");
  assert.doesNotMatch(c.headline, /记一次弃权|按弃权|不计入分母/);
});

test("渲染:先给人话,再按需展开证据", () => {
  const c = buildChain("R", src);
  const plain = renderChain(c, { expand: false });
  const full = renderChain(c, { expand: true });
  assert.ok(plain.split("\n").length < full.split("\n").length);
  assert.match(plain, /操作实际改了东西/);
  assert.doesNotMatch(plain, /证据 evaluation/, "不展开时不该印证据行");
  assert.match(full, /evaluation\/runner\/runs/);
});

// ── 2026-09-13 第十一轮复核:展示里出现 attempts[].undefined 与「判据版本 ?」──
// 不影响计算,但看着像半成品。确实未知就写「未记录」,不适用就写明,不许把 undefined 印出来。
test("attempts 没有 kind 字段时,证据引用不许出现 undefined", () => {
  const src = { verdict: { verdict: "PASS", attempts: [{ value: "bt-x", ok: true, call_id: "call_1" }] } };
  const md = renderChain(buildChain("R", src), { expand: true });
  assert.ok(!/undefined/.test(md), `不许出现 undefined:\n${md}`);
  assert.match(md, /attempts\[0\]/, "没有 kind 就按下标定位");
});

test("判据版本缺失写「未记录」,不是问号", () => {
  const md = renderChain(buildChain("R", { verdict: { verdict: "PASS", attempts: [] } }), { expand: true });
  assert.ok(!/判据版本 \?/.test(md), "问号读起来像坏了");
  assert.match(md, /判据版本未记录/);
});
