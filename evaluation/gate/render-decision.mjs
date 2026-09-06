/**
 * Human-readable rendering of gate decisions (P2-3). The JSON is the record;
 * this is what a reviewer reads before opening the events a decision cites.
 *
 * Usage:
 *   node evaluation/gate/render-decision.mjs <gate-decisions.json>
 */

import { readFileSync } from "node:fs";

const MARK = { admit: "ADMIT  ", reject: "REJECT ", pending: "PENDING" };

export function renderDecision(d) {
  const lines = [];
  const name = d.asset_name ? `${d.asset_name} (${d.asset_id})` : d.asset_id;
  const decoy = d.is_decoy ? `  [decoy, expected ${d.expected_decision}]` : "";
  lines.push(`${MARK[d.decision] ?? d.decision}  ${name}${decoy}`);
  for (const r of d.reasons) lines.push(`    - ${r}`);
  const o = d.signals.online;
  lines.push(`    signals: fetched ${o.fetched}, used ${o.used_hard} (+${o.used_soft} soft), validated ${o.validated} (cross_user ${o.cross_user_validated}), corrected ${o.corrected}; ${o.distinct_actors} consumer(s), ${o.distinct_tasks} task(s)`);
  const a = d.signals.author;
  lines.push(`    author:  ${a.user_id || "?"}${a.agent_id ? ` / ${a.agent_id}` : ""} → ${a.computable ? `confidence ${a.confidence}` : "no cross-person validation yet"}`);
  if (d.evidence_refs.length > 0) {
    lines.push(`    evidence:`);
    for (const e of d.evidence_refs) lines.push(`      ${e.state.padEnd(10)} ${e.relation ?? ""}  ${e.event_id}`);
  } else {
    lines.push(`    evidence: none cited (pending on absence of evidence)`);
  }
  return lines.join("\n");
}

export function renderDecisions(decisions) {
  const lines = ["# Gate decisions", ""];
  if (decisions.length === 0) lines.push("no assets to decide");
  const order = { reject: 0, admit: 1, pending: 2 };
  for (const d of [...decisions].sort((x, y) => (order[x.decision] ?? 9) - (order[y.decision] ?? 9) || x.asset_id.localeCompare(y.asset_id))) {
    lines.push(renderDecision(d), "");
  }
  const tally = { admit: 0, pending: 0, reject: 0 };
  for (const d of decisions) if (!d.is_decoy) tally[d.decision] = (tally[d.decision] ?? 0) + 1;
  lines.push(`admit ${tally.admit}, pending ${tally.pending}, reject ${tally.reject}${decisions.some((d) => d.is_decoy) ? " (decoys not counted)" : ""}`);
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  if (!path) { console.error("usage: node render-decision.mjs <gate-decisions.json>"); process.exit(2); }
  const doc = JSON.parse(readFileSync(path, "utf8"));
  console.log(renderDecisions(Array.isArray(doc) ? doc : doc.decisions ?? [doc]));
}
