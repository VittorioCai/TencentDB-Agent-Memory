/**
 * Receipt CLI rendering (P3-2). Terminal text for a receipt.json, in English
 * or Chinese (`--lang=zh`). The shape follows the topic's own sample:
 *
 *   本次应用 N 项团队资产
 *   - <类型>：<用途>
 *   效果状态
 *   - M 项已通过测试验证
 *   - K 项仅作为背景参考，效果待验证
 *
 * Wording rules, from the contract:
 *   - "related test X passed", never "verified: test passed" — the latter
 *     reads as a causal claim the evidence does not support
 *   - used_soft gets its own mark, never a plain check
 *   - author confidence null renders as "no cross-person validation yet",
 *     never as 0
 *
 * Usage:
 *   node evaluation/receipt/render-cli.mjs <receipt.json> [--lang=zh|en]
 */

import { readFileSync } from "node:fs";

export const MARK = { validated: "✓", corrected: "✗", used: "●", used_soft: "◐", fetched: "○", provided: "·" };

const T = {
  en: {
    title: (r) => `# Receipt — run ${r.run_id ?? "?"} · session ${String(r.session_key).slice(0, 8)} · task ${r.task_id ?? "?"} · ${r.generated_at}`,
    applied: (n) => `applied ${n} team asset(s)`,
    none: "no team assets appeared in this run",
    effect: "effect status",
    validated: (n) => `${n} validated by a related test`,
    used: (n) => `${n} used, outcome not tied to a call`,
    corrected: (n) => `${n} corrected — used, and the call it fed failed for a reason its content explains`,
    soft: (n) => `${n} soft evidence only, not evidence of use`,
    background: (n) => `${n} background only (fetched or provided), effect unverified`,
    from: "from", status: "status", category: "type", why: "why offered", impact: "impact", target: "target",
    related: (t) => `related test ${t.command} ${t.passed ? "passed" : "failed"}`,
    evidence: "evidence", gate: (d) => (d ? `gate ${d}` : "gate: no decision"),
    confidence: (c) => (c == null ? "no cross-person validation yet" : `author confidence ${c}`),
    risk: "risk",
    statusWord: {
      validated: "validated — used, and the call it fed succeeded in a run that passed",
      corrected: "corrected — used, and the call it fed failed for a reason its content explains",
      used: "used — hard evidence, outcome not tied to a call",
      used_soft: "used (soft) — a model's judgement only; not evidence of use",
      fetched: "fetched — body retrieved; use not established",
      provided: "provided — listed or placed in context; never fetched",
    },
    categoryName: {
      project_convention: "project convention", historical_solution: "historical solution", failure_experience: "failure experience",
      skill: "skill", code_knowledge: "code knowledge", product_knowledge: "product knowledge", not_declared: "not declared by the asset",
    },
    marks: (M) => `marks: ${M.validated} validated  ${M.corrected} corrected  ${M.used} used  ${M.used_soft} soft only  ${M.fetched} fetched  ${M.provided} provided`,
  },
  zh: {
    title: (r) => `# 资产使用回执 — 运行 ${r.run_id ?? "?"} · 会话 ${String(r.session_key).slice(0, 8)} · 任务 ${r.task_id ?? "?"} · ${r.generated_at}`,
    applied: (n) => `本次应用 ${n} 项团队资产`,
    none: "本次运行未出现任何团队资产",
    effect: "效果状态",
    validated: (n) => `${n} 项已通过相关测试验证`,
    used: (n) => `${n} 项已采用，结果未关联到具体调用`,
    corrected: (n) => `${n} 项被证明错误——已采用，且它引出的调用因其内容而失败`,
    soft: (n) => `${n} 项仅有软证据，不构成采用证据`,
    background: (n) => `${n} 项仅作为背景参考（取回或提供），效果待验证`,
    from: "来源", status: "状态", category: "类型", why: "为何提供", impact: "影响", target: "作用点",
    related: (t) => `相关测试 ${t.command} ${t.passed ? "通过" : "失败"}`,
    evidence: "证据", gate: (d) => (d ? `闸门 ${{ admit: "准入", pending: "待定", reject: "拒绝" }[d] ?? d}` : "闸门：无判定"),
    confidence: (c) => (c == null ? "作者尚无跨人验证" : `作者置信度 ${c}`),
    risk: "风险",
    statusWord: {
      validated: "已验证——已采用，且它引出的调用成功、本次运行验收通过",
      corrected: "已纠错——已采用，且它引出的调用因其内容而失败",
      used: "已采用——硬证据，结果未关联到具体调用",
      used_soft: "采用（软）——仅模型判断，不构成采用证据",
      fetched: "已取回——正文已读取，采用未成立",
      provided: "已提供——出现在候选或上下文中，从未取回",
    },
    categoryName: {
      project_convention: "项目约定", historical_solution: "历史方案", failure_experience: "失败经验",
      skill: "Skill", code_knowledge: "代码知识", product_knowledge: "产品知识", not_declared: "资产未声明",
    },
    marks: (M) => `标记：${M.validated} 已验证  ${M.corrected} 已纠错  ${M.used} 已采用  ${M.used_soft} 仅软证据  ${M.fetched} 已取回  ${M.provided} 已提供`,
  },
};

const RISK_ZH = { stale: "过期", low_confidence: "低置信", conflict: "冲突", not_head: "非最新版", gate_pending: "闸门待定", gate_rejected: "闸门拒绝", needs_review: "待复核" };

export function renderItem(item, lang = "en") {
  const t = T[lang] ?? T.en;
  const lines = [];
  const ver = item.version != null ? `v${item.version}` : "v?";
  lines.push(`${MARK[item.status] ?? "?"} ${item.name}  ${ver}  ${item.asset_type}`);
  const src = item.source;
  lines.push(`    ${t.from.padEnd(10)} ${src.producer_user_id || "unknown"}${src.producer_agent_id ? ` / ${src.producer_agent_id}` : ""}  (${src.relation})`);
  if (item.category) lines.push(`    ${t.category.padEnd(10)} ${t.categoryName[item.category] ?? item.category}`);
  lines.push(`    ${t.status.padEnd(10)} ${t.statusWord[item.status] ?? item.status}`);
  if (item.why_applicable) lines.push(`    ${t.why.padEnd(10)} ${item.why_applicable}`);
  if (item.impact) lines.push(`    ${t.impact.padEnd(10)} ${item.impact}`);
  if (item.target_type) lines.push(`    ${t.target.padEnd(10)} ${item.target_type}`);
  for (const rt of item.related_tests ?? []) lines.push(`    ${t.related(rt)}`);
  if (item.evidence.length > 0) {
    lines.push(`    ${t.evidence}`);
    for (const e of item.evidence) lines.push(`      ${e.kind.padEnd(15)} ${e.ref}${e.detail ? `  — ${e.detail}` : ""}`);
  }
  lines.push(`    ${t.gate(item.gate_decision)} · ${t.confidence(item.author_confidence)}`);
  for (const r of item.risks ?? []) lines.push(`    ${t.risk.padEnd(10)} ${lang === "zh" ? (RISK_ZH[r.kind] ?? r.kind) : r.kind}: ${r.detail}`);
  return lines.join("\n");
}

export function renderReceipt(r, lang = "en") {
  const t = T[lang] ?? T.en;
  const s = r.summary;
  const lines = [t.title(r), ""];
  lines.push(t.applied(s.applied_count));
  // One line per applied asset: type and what it did — the shape of the topic's sample.
  for (const item of r.items.filter((i) => i.status !== "provided")) {
    const cat = t.categoryName[item.category] ?? item.category ?? t.categoryName.not_declared;
    const what = item.impact ?? t.statusWord[item.status];
    lines.push(`- ${cat}：${item.name} — ${what}`);
  }
  lines.push("", t.effect);
  const bg = (s.by_status.fetched ?? 0) + (s.by_status.provided ?? 0);
  const parts = [];
  if (s.by_status.validated) parts.push(t.validated(s.by_status.validated));
  if (s.by_status.used) parts.push(t.used(s.by_status.used));
  if (s.by_status.corrected) parts.push(t.corrected(s.by_status.corrected));
  if (s.soft_only_count) parts.push(t.soft(s.soft_only_count));
  if (bg) parts.push(t.background(bg));
  if (parts.length === 0) parts.push(t.none);
  for (const p of parts) lines.push(`- ${p}`);
  lines.push("");
  if (r.items.length === 0) lines.push(t.none);
  for (const item of r.items) lines.push(renderItem(item, lang), "");
  lines.push(t.marks(MARK));
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const langArg = process.argv.find((a) => a.startsWith("--lang="));
  if (!path) { console.error("usage: node render-cli.mjs <receipt.json> [--lang=zh|en]"); process.exit(2); }
  console.log(renderReceipt(JSON.parse(readFileSync(path, "utf8")), langArg ? langArg.slice(7) : "en"));
}
