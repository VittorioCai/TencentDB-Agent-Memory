/**
 * 一次真实运行的闭环,按七环展开,每一环指名证据。
 *
 * 为什么要有这一份:按次回执(`build-receipt.mjs` / `render-cli.mjs`)回答的是"这次用了哪些资产、
 * 状态如何";它回答不了评委真正会追的那条线——**这条经验是从哪来的、怎么被找到的、
 * 到底改了什么、谁独立验收的、产品据此判了什么、又产生了什么新东西**。
 *
 * 硬规则,来自第六轮复核("评委沿着最终主张追下去,能找到证据,或明确知道断在哪里"):
 * **某一环没有证据就显示为「未证明」并说明为什么,绝不拿相邻证据顶替。** 链条允许断,
 * 不允许糊。断在哪里本身就是要展示的信息。
 */
export const LINKS = [
  { n: 1, key: "origin",     title: "原始经验" },
  { n: 2, key: "note",       title: "笔记与适用条件" },
  { n: 3, key: "retrieval",  title: "检索与取回" },
  { n: 4, key: "adoption",   title: "实际新增的测试 / 代码" },
  { n: 5, key: "acceptance", title: "独立验收" },
  { n: 6, key: "decision",   title: "结果回写 Core" },   // 这一环展示的是结果状态(validated),不是准入判定(admit/reject/pending)——两者混淆过一次(第十二轮复核)

  { n: 7, key: "candidate",  title: "新产生的候选" },
];

const ev = (file, field, value) => ({ file, field, value: String(value ?? "") });
const runDir = (r) => `evaluation/runner/runs/${r}`;

export function buildChain(runId, src = {}, opts = {}) {
  const L = [];
  const push = (n, said, evidence, why_not) =>
    L.push({ ...LINKS[n - 1], said, proven: !why_not, evidence: why_not ? [] : evidence, why_not });

  // ① 原始经验
  // 来源句必须随案例走:替一次运行说出它没有的来源,正是这套东西要防的错误。
  if (src.note?.path && src.note?.origin) push(1, src.note.origin,
    [ev(src.note.path, "资产正文", src.note.origin)]);
  else if (src.note?.path) push(1, "", [], "没有给这次案例写明资产来源,不替它编一个");
  else push(1, "", [], "没有拿到笔记文件,无法说明它的来源");

  // ② 笔记与适用条件
  if (src.note?.applies_when) push(2, `适用条件写在笔记里:${src.note.applies_when}。`,
    [ev(src.note.path, "applies_when", src.note.applies_when)]);
  else push(2, "", [], "笔记里没有可机读的适用条件");

  // ③ 检索与取回 —— 注入清单为空是这个产品的真实行为,要如实说
  const fetched = (src.events ?? []).filter((e) => e.state === "fetched");
  const emptyListing = (src.candidateLog ?? []).some((c) => (c.hits ?? []).length === 0 || /\(none\)/.test(c.listing ?? ""));
  if (fetched.length) {
    push(3, `送达 ${fetched.length} 次(状态 fetched)。` +
      (emptyListing ? "注意:注入清单对这个新 agent 是空的,所以送达不是注入来的,是**模型自己检索**拿到的。" : ""),
      [ev(`${runDir(runId)}/events.jsonl`, "state=fetched", fetched.map((e) => e.event_id).join(", ")),
       ...(emptyListing ? [ev(`${runDir(runId)}/candidate-log.jsonl`, "listing", "(none)")] : [])]);
  } else push(3, "", [], "events.jsonl 里没有 fetched 事件");

  // ④ 采用
  const att = src.verdict?.attempts ?? [];
  // 「1 次尝试」说不出解决了什么。有 final.diff 就把改了哪些文件、多少行摆出来,
  // 并在同一环里写明采用证据支持到哪一步 —— 不写的话读者会把它读成「修复思路来自笔记」(第十二轮复核)。
  const ch = src.change;
  const what = ch?.files?.length
    ? `操作实际改了东西:${ch.files.length} 个文件(+${ch.added ?? "?"}/−${ch.removed ?? "?"}),`
      + `${att.length} 次尝试中带判别值的 ${att.filter((a) => a.value).length} 次。`
      + `采用证据支持的是**笔记约定进入了这次改动**,不单独证明修复思路来自笔记。`
    : `操作实际改了东西:${att.length} 次尝试,其中带判别值的 ${att.filter((a) => a.value).length} 次。`;
  if (att.length) push(4, what,
    [...(ch?.files?.length ? [ev(`${runDir(runId)}/final.diff`, "改动文件", ch.files.join(", "))] : []),
    // 批次四那时的 attempt 没有 `kind`(字段是 call_id / host / port),直接拼会印出
    // `attempts[].undefined` —— 不影响计算,但看着像半成品(第十一轮复核指出)。按下标定位,
    // 有 kind 才加上它;`ok` 未记时写「未记录」,不折成 false。
    ...att.map((a, i) => ev(`${runDir(runId)}/verdict.json`, `attempts[${i}]${a.kind ? `.${a.kind}` : ""}`,
      `${a.value ?? "(无判别值)"} ok=${a.ok ?? "未记录"}`))]);
  else push(4, "", [], "verdict.json 里没有 attempts,说明没有可归因的改动");

  // ⑤ 独立验收
  // 判据版本缺失时原来印「判据版本 ?」,问号读起来像坏了 —— 早期批次的 verdict.json 本来就没有这个字段。
  if (src.verdict?.verdict) push(5, `独立验收:${src.verdict.verdict}(${src.verdict.acceptance_version ? `判据版本 ${src.verdict.acceptance_version}` : "判据版本未记录 —— 该批次的 verdict.json 尚无此字段"})。`,
    [ev(`${runDir(runId)}/verdict.json`, "verdict / reason", `${src.verdict.verdict} — ${(src.verdict.reason ?? "").slice(0, 80)}`)]);
  else push(5, "", [], "没有 verdict.json,验收结果不可考");

  // ⑥ Core 判定
  const posted = src.outcomes?.posted ?? [];
  if (posted.length) push(6, `结果已回写产品:${posted.length} 条,状态 ${[...new Set(posted.map((p) => p.state))].join("/")}` +
    (src.gate?.decision ? `;闸门判 ${src.gate.decision} → ${src.gate.status_target}(规则 ${src.gate.rules_version})。` : "。"),
    [ev(`${runDir(runId)}/core-outcomes.json`, "posted[].state", posted.map((p) => `${p.outcome_id}:${p.state}`).join(", ")),
     ...(src.gate?.decision ? [ev("evaluation/tasks/exit-code-fix/gate-evaluations.jsonl", "decision", src.gate.decision)] : [])]);
  else push(6, "", [], "没有 core-outcomes.json,无法说明产品侧是否收到结果");

  // ⑦ 新候选
  if ((src.candidates ?? []).length) push(7, `回流产生 ${src.candidates.length} 项候选,进入复核队列。`,
    src.candidates.slice(0, 3).map((c) => ev("evaluation/tasks/exit-code-fix/pool-after-writeback.json", "asset_id", `${c.asset_id} ${c.status}`)));
  else push(7, "", [], "本次没有观察到新候选");

  const complete = L.every((l) => l.proven);
  let headline = `运行 ${runId}:七环中已证 ${L.filter((l) => l.proven).length} 环` + (complete ? "。" : `,断在第 ${L.filter((l) => !l.proven).map((l) => l.n).join("、")} 环。`);

  if (opts.case === "delivered_not_adopted") {
    const a = (src.verdict?.attempts ?? []).length;
    headline = `反例一 —— 送达 ${fetched.length} 次,采用 ${a} 次:**送达不等于使用**。` +
      `系统按"操作是否实际用了它"判定,不按"内容是否到过模型"判定,所以多送达的那几次不会被算成使用。`;
  }
  if (opts.case === "adopted_but_flagged") {
    headline = `反例二 —— 参考采纳成立(reference_adopted=${src.reference_adopted}),而判定器未产出 used` +
      `(judged_used=${src.judged_used}):按现行校准记一次**假阴性,且计入分母**,不是弃权。` +
      `needs_review 说明的是它为什么保守拒判,不是把它移出分母的理由。`;
  }
  return { runId, links: L, complete, headline };
}

export function renderChain(chain, { expand = false } = {}) {
  const out = [chain.headline, ""];
  for (const l of chain.links) {
    out.push(`${l.n}. ${l.title} — ${l.proven ? l.said : `**未证明**:${l.why_not}`}`);
    if (expand && l.evidence.length) for (const e of l.evidence) out.push(`      证据 ${e.file} · ${e.field} · ${e.value}`);
  }
  if (!chain.complete) out.push("", "断开的环节按原样保留 —— 链条允许断,不允许糊。");
  return out.join("\n");
}
