/**
 * Visibility planner (P3-3, pure part).
 *
 * The gate acts on one field: the asset record's `visibility`. The bridge's
 * team search whitelist is A ∪ B, where A is `meta list-accessible
 * (visibility='team')`; an asset set to `private` drops out of A. The four
 * read paths (search, get, get-by-name, files/read) share that whitelist, so
 * dropping out of A is dropping out of the consumer's reach entirely.
 *
 * Given decisions, the baseline visibility of each asset and what the product
 * reports right now, this produces the list of writes to make:
 *
 *   reject   → private     the gate hides what it has judged wrong
 *   admit    → baseline    as entered (team)
 *   pending  → baseline    the gate does not hide what it could not judge;
 *                          a pending asset stays exactly as the baseline left it
 *
 * `reset` ignores decisions and restores the baseline for every asset — how a
 * gate-off run, and the start of every gate-on run, get the same initial pool.
 *
 * Nothing here talks to the service; apply.sh does, and records what it read
 * back. Keeping the plan pure means it is testable without a running stack.
 *
 * Usage (from apply.sh):
 *   node plan-visibility.mjs --mode=apply|reset --baseline=gate_baseline.json --current=current.json
 */

import { readFileSync } from "node:fs";

export const HIDDEN = "private";

/**
 * @param mode      "apply" | "reset"
 * @param baseline  { assets: { [asset_id]: { baseline_visibility } }, decisions: [...] }
 * @param current   { [asset_id]: visibility | null }   null = could not be read
 */
export function planVisibility({ mode, baseline, current }) {
  if (mode !== "apply" && mode !== "reset") throw new Error(`mode must be apply or reset, got ${mode}`);
  const decisions = new Map((baseline.decisions ?? []).map((d) => [d.asset_id, d]));
  const changes = [];
  const unchanged = [];
  const unreadable = [];
  const undecided = [];

  for (const [assetId, row] of Object.entries(baseline.assets ?? {})) {
    const base = row.baseline_visibility;
    const now = current?.[assetId] ?? null;
    if (now === null) {
      unreadable.push(assetId);
      continue;
    }
    let target = base;
    let because = `reset to baseline (${base})`;
    if (mode === "apply") {
      const d = decisions.get(assetId);
      if (!d) {
        undecided.push(assetId);
        because = `no decision in the baseline; kept at baseline (${base})`;
      } else if (d.decision === "reject") {
        target = HIDDEN;
        because = `gate: reject → ${HIDDEN} (${d.reasons[0]})`;
      } else if (d.decision === "admit") {
        because = `gate: admit → baseline (${base})`;
      } else {
        because = `gate: pending → baseline (${base}); the gate does not hide what it could not judge`;
      }
    }
    if (now === target) unchanged.push({ asset_id: assetId, visibility: now, because });
    else changes.push({ asset_id: assetId, from: now, to: target, because });
  }
  return { mode, changes, unchanged, unreadable, undecided };
}

export function renderPlan(plan) {
  const lines = [`# visibility plan (${plan.mode})`];
  for (const c of plan.changes) lines.push(`  ${c.asset_id}: ${c.from} → ${c.to}   ${c.because}`);
  for (const u of plan.unchanged) lines.push(`  ${u.asset_id}: ${u.visibility} (unchanged)   ${u.because}`);
  for (const id of plan.unreadable) lines.push(`  ${id}: visibility could not be read — NOT planned`);
  if (plan.changes.length === 0 && plan.unreadable.length === 0) lines.push("  nothing to change");
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (name) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
  const mode = arg("mode"); const baselinePath = arg("baseline"); const currentPath = arg("current");
  if (!mode || !baselinePath || !currentPath) {
    console.error("usage: node plan-visibility.mjs --mode=apply|reset --baseline=F --current=F [--json]");
    process.exit(2);
  }
  const plan = planVisibility({
    mode,
    baseline: JSON.parse(readFileSync(baselinePath, "utf8")),
    current: JSON.parse(readFileSync(currentPath, "utf8")),
  });
  console.log(process.argv.includes("--json") ? JSON.stringify(plan, null, 2) : renderPlan(plan));
  // An unreadable asset is a failed plan: a run whose gate state is unknown is
  // not comparable with anything.
  process.exit(plan.unreadable.length > 0 ? 1 : 0);
}
