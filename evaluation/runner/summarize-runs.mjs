/**
 * Aggregate runs.
 *
 * The one rule this file exists to enforce: **ERROR stays in the denominator.**
 *
 * A run where the task was never attempted, or where the outcome could not be
 * read, says something about the harness rather than about the asset. It is
 * reported separately for that reason. But dropping it from the total is how a
 * collection failure becomes a good-looking result: six runs, four broken, two
 * passed, reported as 100%. The rate that matters is over runs *started*, and
 * the unjudgeable ones are named so the number can be read honestly.
 *
 * Usage:
 *   node evaluation/runner/summarize-runs.mjs evaluation/runner/runs [--json]
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export function summarizeRuns(runs) {
  const byLabel = new Map();
  for (const run of runs) {
    const label = run.label ?? "run";
    if (!byLabel.has(label)) byLabel.set(label, { label, pass: 0, fail: 0, error: 0, runs: [] });
    const g = byLabel.get(label);
    if (run.verdict === "PASS") g.pass += 1;
    else if (run.verdict === "FAIL") g.fail += 1;
    else g.error += 1;
    g.runs.push(run);
  }

  const groups = [...byLabel.values()].map((g) => {
    const started = g.pass + g.fail + g.error;
    const judged = g.pass + g.fail;
    return {
      ...g,
      started,
      judged,
      // Over runs started, not runs judged. Both are printed, because the gap
      // between them is the thing a reader needs to see.
      pass_rate: started > 0 ? g.pass / started : null,
      pass_rate_of_judged: judged > 0 ? g.pass / judged : null,
    };
  });

  return { groups, total: runs.length };
}

export function renderRuns({ groups, total }) {
  const lines = ["# Runs", ""];
  if (total === 0) {
    lines.push("No runs yet. This is **not** a result of zero — nothing has been measured.");
    return lines.join("\n");
  }

  lines.push("| label | started | pass | fail | unjudgeable | pass rate |");
  lines.push("|---|---|---|---|---|---|");
  for (const g of groups) {
    const rate = g.pass_rate === null ? "—" : `${(g.pass_rate * 100).toFixed(0)}%`;
    lines.push(`| ${g.label} | ${g.started} | ${g.pass} | ${g.fail} | ${g.error} | ${rate} |`);
  }

  const broken = groups.filter((g) => g.error > 0);
  if (broken.length > 0) {
    lines.push("", "The pass rate is over runs **started**. Unjudgeable runs stay in it:");
    for (const g of broken) {
      const alt = g.pass_rate_of_judged === null ? "—" : `${(g.pass_rate_of_judged * 100).toFixed(0)}%`;
      lines.push(`  - ${g.label}: ${g.error} of ${g.started} could not be judged; over judged runs alone it would read ${alt}`);
      for (const r of g.runs.filter((x) => x.verdict !== "PASS" && x.verdict !== "FAIL")) {
        lines.push(`      ${r.run_id}`);
      }
    }
    lines.push("Reporting the second number without the first would let a harness that broke");
    lines.push("four times out of six read as a clean result.");
  }
  return lines.join("\n");
}

// ── CLI ───────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] ?? "evaluation/runner/runs";
  if (!existsSync(dir)) {
    console.log(renderRuns({ groups: [], total: 0 }));
    process.exit(0);
  }
  const runs = readdirSync(dir)
    .map((name) => join(dir, name, "run.json"))
    .filter(existsSync)
    .map((p) => JSON.parse(readFileSync(p, "utf8")))
    .sort((a, b) => String(a.run_id).localeCompare(String(b.run_id)));

  const summary = summarizeRuns(runs);
  console.log(process.argv.includes("--json") ? JSON.stringify(summary, null, 2) : renderRuns(summary));
}
