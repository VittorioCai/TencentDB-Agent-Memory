/**
 * Receipt CLI rendering (P3-2). Terminal text for a receipt.json.
 *
 * Wording rules, from the contract:
 *   - "related test X passed", never "verified: test passed" — the latter
 *     reads as a causal claim the evidence does not support
 *   - used_soft gets its own mark, never a plain check
 *   - author confidence null renders as "no cross-person validation yet",
 *     never as 0
 *
 * Usage:
 *   node evaluation/receipt/render-cli.mjs <receipt.json>
 */

import { readFileSync } from "node:fs";

export const MARK = {
  validated: "✓",
  corrected: "✗",
  used: "●",
  used_soft: "◐",
  fetched: "○",
  provided: "·",
};

export const STATUS_WORD = {
  validated: "validated — used, and the call it fed succeeded in a run that passed",
  corrected: "corrected — used, and the call it fed failed for a reason its content explains",
  used: "used — hard evidence, outcome not tied to a call",
  used_soft: "used (soft) — a model's judgement only; not evidence of use",
  fetched: "fetched — body retrieved; use not established",
  provided: "provided — listed or placed in context; never fetched",
};

function confidenceText(c) {
  return c === null || c === undefined ? "no cross-person validation yet" : `author confidence ${c}`;
}

export function renderItem(item) {
  const lines = [];
  const ver = item.version != null ? `v${item.version}` : "v?";
  lines.push(`${MARK[item.status] ?? "?"} ${item.name}  ${ver}  ${item.asset_type}`);
  const src = item.source;
  lines.push(`    from       ${src.producer_user_id || "unknown"}${src.producer_agent_id ? ` / ${src.producer_agent_id}` : ""}  (${src.relation})`);
  lines.push(`    status     ${STATUS_WORD[item.status] ?? item.status}`);
  if (item.impact) lines.push(`    impact     ${item.impact}`);
  if (item.target_type) lines.push(`    target     ${item.target_type}`);
  for (const t of item.related_tests ?? []) {
    lines.push(`    related test ${t.command} ${t.passed ? "passed" : "failed"}`);
  }
  if (item.evidence.length > 0) {
    lines.push(`    evidence`);
    for (const e of item.evidence) lines.push(`      ${e.kind.padEnd(15)} ${e.ref}${e.detail ? `  — ${e.detail}` : ""}`);
  }
  const gate = item.gate_decision ? `gate ${item.gate_decision}` : "gate: no decision";
  lines.push(`    ${gate} · ${confidenceText(item.author_confidence)}`);
  for (const r of item.risks ?? []) lines.push(`    risk       ${r.kind}: ${r.detail}`);
  return lines.join("\n");
}

export function renderReceipt(r) {
  const s = r.summary;
  const lines = [];
  lines.push(`# Receipt — run ${r.run_id ?? "?"} · session ${String(r.session_key).slice(0, 8)} · task ${r.task_id ?? "?"} · ${r.generated_at}`);
  const parts = [`validated ${s.by_status.validated}`, `used ${s.by_status.used}`];
  if (s.by_status.corrected != null) parts.push(`corrected ${s.by_status.corrected}`);
  parts.push(`fetched ${s.by_status.fetched}`, `provided ${s.by_status.provided}`);
  if (s.soft_only_count) parts.push(`soft only ${s.soft_only_count}`);
  lines.push(`applied ${s.applied_count} asset(s): ${parts.join(" · ")}`);
  lines.push("");
  if (r.items.length === 0) lines.push("no team assets appeared in this run");
  for (const item of r.items) lines.push(renderItem(item), "");
  lines.push(`marks: ${MARK.validated} validated  ${MARK.corrected} corrected  ${MARK.used} used  ${MARK.used_soft} soft only  ${MARK.fetched} fetched  ${MARK.provided} provided`);
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  if (!path) { console.error("usage: node render-cli.mjs <receipt.json>"); process.exit(2); }
  console.log(renderReceipt(JSON.parse(readFileSync(path, "utf8"))));
}
