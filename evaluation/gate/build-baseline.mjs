/**
 * Gate baseline (P4-4b): freeze the evidence and decisions that every run of
 * the on/off comparison starts from.
 *
 * Why a frozen baseline instead of deciding live before each run: if the gate
 * learned from run 1 and run 2 before run 3, the third gate-on run would face
 * a different gate from the first, and the two arms would no longer share an
 * initial condition. The difference between arms could then be the gate, or
 * the order the runs happened in. So the preparation runs' events are frozen
 * here once, the decisions are computed once, and apply.sh resets to this
 * before every run. Nothing a comparison run produces feeds back into it.
 *
 * Inputs are run directories from run-once.sh. Each contributes its
 * events.jsonl (fetched), used-events.jsonl (used) and outcome-events.jsonl
 * (validated / corrected / needs_review). If a run predates the outcome judge,
 * its outcomes are computed here from used-events + verdict + tokens, and the
 * baseline says so.
 *
 * Usage:
 *   node evaluation/gate/build-baseline.mjs --runs=<dir,dir,...> --snapshot=<asset-pool-snapshot.json>
 *        [--visibility=<current.json from apply.sh --status>] [--tokens=F] [--decoys=F] [--now=ISO]
 *        [--out=evaluation/gate/artifacts/gate_baseline.json]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJsonl } from "../provenance/build-events.mjs";
import { judgeOutcome } from "../attribution/judge-outcome.mjs";
import { decide } from "./decide.mjs";
import { renderDecisions } from "./render-decision.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_OUT = join(HERE, "artifacts", "gate_baseline.json");

function readJsonl(path) {
  return existsSync(path) ? parseJsonl(readFileSync(path, "utf8")) : [];
}
function readJson(path, fallback = null) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;
}

/** Collect one run directory's events; compute outcomes if the run has none on disk. */
export function collectRun(dir, { tokensByAsset }) {
  const runJson = readJson(join(dir, "run.json"), {});
  const fetched = readJsonl(join(dir, "events.jsonl"));
  const used = readJsonl(join(dir, "used-events.jsonl"));
  let outcomes = readJsonl(join(dir, "outcome-events.jsonl"));
  let outcomeSource = "outcome-events.jsonl";
  if (outcomes.length === 0 && used.length > 0) {
    const verdictDoc = readJson(join(dir, "verdict.json"), { verdict: "ERROR", attempts: [] });
    const tokens = readJson(join(dir, "tokens.json"), tokensByAsset);
    outcomes = judgeOutcome({ usedEvents: used, verdictDoc, tokensByAsset: tokens }).events;
    outcomeSource = "computed here by judge-outcome from used-events.jsonl + verdict.json";
  }
  return {
    run_id: runJson.run_id ?? basename(dir),
    label: runJson.label ?? null,
    verdict: runJson.verdict ?? null,
    started_at: runJson.started_at ?? null,
    outcome_source: outcomeSource,
    events: [...fetched, ...used, ...outcomes],
  };
}

export function buildBaseline({ runs, snapshot, visibility = null, tokensByAsset = {}, decoys = [], now }) {
  const frozenAt = now ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const seen = new Map();
  const sourceRuns = [];
  for (const r of runs) {
    const ids = [];
    for (const e of r.events) {
      if (!seen.has(e.event_id)) { seen.set(e.event_id, e); ids.push(e.event_id); }
    }
    sourceRuns.push({ run_id: r.run_id, label: r.label, verdict: r.verdict, started_at: r.started_at, outcome_source: r.outcome_source, event_ids: ids });
  }
  const events = [...seen.values()];
  const decisions = decide({ events, snapshot, decoys, now: frozenAt, tokensByAsset });

  const assets = {};
  for (const a of snapshot.assets ?? []) {
    const vis = visibility?.[a.asset_id] ?? null;
    assets[a.asset_id] = {
      name: a.name ?? null,
      version: a.version ?? null,
      producer_user_id: a.producer_user_id ?? null,
      producer_agent_id: a.producer_agent_id ?? null,
      // The pool as entered: every scenario asset is team-visible (enter-pool.sh
      // checks it). If the live value was supplied it is recorded as read; if
      // not, "team" is the contract and the source says it was not read.
      baseline_visibility: vis ?? "team",
      visibility_source: vis ? "read from /v3/meta/asset/get at freeze time" : "enter-pool.sh contract (not read at freeze time)",
    };
  }

  return {
    schema_version: "gate-baseline-v1",
    frozen_at: frozenAt,
    pool_snapshot_at: snapshot.pool_snapshot_at ?? null,
    team_id: snapshot.team_id ?? null,
    source_runs: sourceRuns,
    event_count: events.length,
    by_state: events.reduce((acc, e) => { acc[e.state] = (acc[e.state] ?? 0) + 1; return acc; }, {}),
    assets,
    decisions,
    events,
    note: "Every comparison run resets to this baseline before it starts (apply.sh --reset / --apply). "
        + "Runs listed in source_runs are the evidence base and are not part of the comparison.",
  };
}

export function renderBaseline(b) {
  const lines = [`# Gate baseline — frozen ${b.frozen_at}`, ""];
  lines.push(`pool frozen ${b.pool_snapshot_at}, team ${b.team_id}`);
  lines.push(`evidence: ${b.event_count} event(s) from ${b.source_runs.length} preparation run(s)`);
  for (const r of b.source_runs) lines.push(`  ${r.run_id}  ${r.verdict ?? "?"}  ${r.event_ids.length} event(s)  outcomes: ${r.outcome_source}`);
  lines.push(`by state: ${Object.entries(b.by_state).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  lines.push("", "assets at baseline:");
  for (const [id, a] of Object.entries(b.assets)) lines.push(`  ${id}  ${a.name ?? ""}  v${a.version ?? "?"}  visibility=${a.baseline_visibility} (${a.visibility_source})`);
  lines.push("", renderDecisions(b.decisions));
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (name) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
  const runsArg = arg("runs"); const snapshotArg = arg("snapshot");
  if (!runsArg || !snapshotArg) {
    console.error("usage: node build-baseline.mjs --runs=<dir,dir> --snapshot=F [--visibility=F] [--tokens=F] [--decoys=F] [--now=ISO] [--out=F]");
    process.exit(2);
  }
  const tokensByAsset = arg("tokens") ? readJson(arg("tokens"), {}) : {};
  const runs = runsArg.split(",").filter(Boolean).map((d) => collectRun(d, { tokensByAsset }));
  const baseline = buildBaseline({
    runs,
    snapshot: readJson(snapshotArg),
    visibility: arg("visibility") ? readJson(arg("visibility")) : null,
    tokensByAsset,
    decoys: arg("decoys") ? readJson(arg("decoys"), []) : [],
    now: arg("now") ?? undefined,
  });
  const out = arg("out") ?? DEFAULT_OUT;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(baseline, null, 2) + "\n");
  console.log(renderBaseline(baseline));
  console.log(`\n→ ${out}`);
}
