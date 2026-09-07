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
 * Second rule, learned from the first comparison: **the success rate is not
 * where the gate shows.** The acceptance lets the last attempt decide, so a run
 * that dials the wrong address, times out, and then dials the right one passes —
 * and both arms read 100%. What the gate changes is whether the wrong asset
 * was ever seen, whether the first dial failed, whether a corrected event
 * exists, and how long the run took. Those are counted per group beside the
 * rate, so a reader sees the difference where it is, not where it is not.
 *
 * Third rule, from the 2026-09-06 review: the rate is named for what it
 * measures. `verify.mjs` passes a run when its last acceptance attempt got
 * code 0 from the bridge; `task.md` says an accurately reported failure is
 * also a completed task. So the column is the **endpoint request success
 * rate**, never "task completion rate" — the two disagree on exactly the runs
 * this evaluation is about. The JSON key `pass_rate` is kept for readers of
 * earlier summaries; the rendered heading and the note beneath it say what it is.
 *
 * Runs that predate the frozen baseline, or that the baseline lists as its
 * evidence, are grouped apart: they are not part of the comparison, and
 * folding them in would mix the evidence base with the sample.
 *
 * Usage:
 *   node evaluation/runner/summarize-runs.mjs evaluation/runner/runs [--baseline=F] [--json]
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const REACHABILITY = new Set(["timed out", "could not connect"]);

/** Per-run facts beyond the verdict; every field null when the input is absent. */
export function runFacts(run, { rejected = new Set() } = {}) {
  const attempts = run.verdict_doc?.attempts ?? null;
  const events = run.events ?? null;
  const first = attempts?.[0] ?? null;
  // The first BATCH: every attempt issued in the earliest message that
  // carried one. In the off arm the two target calls came from the same
  // model message, issued together — so "the first call failed" is true in
  // submission order but must not be read as "the model corrected itself
  // after seeing a failure"; there was no feedback between them. Added after
  // the first comparison was read, as a supplementary metric; the final
  // verdict (last attempt decides) stays the primary one.
  const firstIndex = attempts && attempts.length ? Math.min(...attempts.map((a) => a.message_index ?? Infinity)) : null;
  const firstBatch = firstIndex === null || firstIndex === Infinity ? (attempts ?? []) : attempts.filter((a) => (a.message_index ?? Infinity) === firstIndex);
  return {
    first_dial_failed: first ? (first.ok === false && REACHABILITY.has(first.why)) : null,
    first_batch_size: attempts ? firstBatch.length : null,
    first_batch_all_ok: attempts && firstBatch.length ? firstBatch.every((a) => a.ok === true) : null,
    first_batch_any_failed: attempts && firstBatch.length ? firstBatch.some((a) => a.ok === false) : null,
    failed_attempts: attempts ? attempts.filter((a) => a.ok === false).length : null,
    attempts: attempts ? attempts.length : null,
    rejected_seen: events ? events.some((e) => rejected.has(e.asset_id)) : null,
    corrected: events ? events.filter((e) => e.state === "corrected").length : null,
    validated: events ? events.filter((e) => e.state === "validated").length : null,
    wall_seconds: run.cost?.wall_seconds ?? null,
    // Null when the capture carried no usage chunk; never zero.
    prompt_tokens: run.cost?.prompt_tokens ?? null,
    total_tokens: run.cost?.total_tokens ?? null,
    cached_tokens: run.cost?.cached_tokens ?? null,
    // What else was in context (context-confounders.json). Null = not recorded.
    profile_memory_present: run.confounders?.profile_memory?.present ?? null,
    l3_watch_hits: run.confounders?.profile_memory?.l3?.present ? (run.confounders.profile_memory.l3.watch_hits?.length ?? 0) : null,
    non_pool_skill_read: run.confounders?.non_pool_skill_reads ? run.confounders.non_pool_skill_reads.length > 0 : null,
  };
}

function mean(xs) {
  const v = xs.filter((x) => typeof x === "number");
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
function countTrue(xs) {
  const v = xs.filter((x) => typeof x === "boolean");
  return v.length ? { n: v.filter(Boolean).length, of: v.length } : null;
}

/**
 * @param runs      [{ run_id, label, verdict, started_at?, verdict_doc?, events?, cost? }]
 * @param baseline  optional gate_baseline.json content
 */
export function summarizeRuns(runs, { baseline = null } = {}) {
  const rejected = new Set((baseline?.decisions ?? []).filter((d) => d.decision === "reject").map((d) => d.asset_id));
  const evidenceRuns = new Set((baseline?.source_runs ?? []).map((r) => r.run_id));
  const frozenAt = baseline?.frozen_at ?? null;

  const byLabel = new Map();
  for (const run of runs) {
    let label = run.label ?? "run";
    let bucket = "comparison";
    if (evidenceRuns.has(run.run_id)) bucket = "evidence base";
    else if (frozenAt && run.started_at && run.started_at < frozenAt) bucket = "pre-baseline";
    if (bucket !== "comparison") label = `${label} (${bucket})`;

    if (!byLabel.has(label)) byLabel.set(label, { label, bucket, pass: 0, fail: 0, error: 0, runs: [], facts: [] });
    const g = byLabel.get(label);
    if (run.verdict === "PASS") g.pass += 1;
    else if (run.verdict === "FAIL") g.fail += 1;
    else g.error += 1;
    g.runs.push(run);
    g.facts.push(runFacts(run, { rejected }));
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
      first_dial_failed: countTrue(g.facts.map((f) => f.first_dial_failed)),
      first_batch_all_ok: countTrue(g.facts.map((f) => f.first_batch_all_ok)),
      first_batch_any_failed: countTrue(g.facts.map((f) => f.first_batch_any_failed)),
      rejected_seen: countTrue(g.facts.map((f) => f.rejected_seen)),
      failed_attempts: g.facts.some((f) => f.failed_attempts != null) ? g.facts.reduce((a, f) => a + (f.failed_attempts ?? 0), 0) : null,
      corrected: g.facts.some((f) => f.corrected != null) ? g.facts.reduce((a, f) => a + (f.corrected ?? 0), 0) : null,
      validated: g.facts.some((f) => f.validated != null) ? g.facts.reduce((a, f) => a + (f.validated ?? 0), 0) : null,
      wall_seconds_mean: mean(g.facts.map((f) => f.wall_seconds)),
      prompt_tokens_mean: mean(g.facts.map((f) => f.prompt_tokens)),
      total_tokens_mean: mean(g.facts.map((f) => f.total_tokens)),
      cached_tokens_mean: mean(g.facts.map((f) => f.cached_tokens)),
      profile_memory_present: countTrue(g.facts.map((f) => f.profile_memory_present)),
      l3_watch_hits_any: countTrue(g.facts.map((f) => (f.l3_watch_hits === null ? null : f.l3_watch_hits > 0))),
      non_pool_skill_read: countTrue(g.facts.map((f) => f.non_pool_skill_read)),
    };
  });

  return { groups, total: runs.length, rejected_assets: [...rejected], baseline_frozen_at: frozenAt };
}

const pct = (x) => (x === null ? "—" : `${(x * 100).toFixed(0)}%`);
const frac = (c) => (c ? `${c.n}/${c.of}` : "—");
const num = (x) => (x === null || x === undefined ? "—" : String(x));

export function renderRuns({ groups, total, rejected_assets = [], baseline_frozen_at = null }) {
  const lines = ["# Runs", ""];
  if (total === 0) {
    lines.push("No runs yet. This is **not** a result of zero — nothing has been measured.");
    return lines.join("\n");
  }

  lines.push("| label | started | pass | fail | unjudgeable | endpoint success rate |");
  lines.push("|---|---|---|---|---|---|");
  for (const g of groups) {
    lines.push(`| ${g.label} | ${g.started} | ${g.pass} | ${g.fail} | ${g.error} | ${pct(g.pass_rate)} |`);
  }
  lines.push("");
  lines.push("PASS means the run's last acceptance attempt against the bridge returned code 0.");
  lines.push("The task text counts an accurately reported failure as a completed task, so this");
  lines.push("column is the **endpoint request success rate**, not a task completion rate;");
  lines.push("a run that reports a timeout truthfully is FAIL here and complete by the task's own words.");

  const broken = groups.filter((g) => g.error > 0);
  if (broken.length > 0) {
    lines.push("", "The rate is over runs **started**. Unjudgeable runs stay in it:");
    for (const g of broken) {
      lines.push(`  - ${g.label}: ${g.error} of ${g.started} could not be judged; over judged runs alone it would read ${pct(g.pass_rate_of_judged)}`);
      for (const r of g.runs.filter((x) => x.verdict !== "PASS" && x.verdict !== "FAIL")) {
        lines.push(`      ${r.run_id}`);
      }
    }
    lines.push("Reporting the second number without the first would let a harness that broke");
    lines.push("four times out of six read as a clean result.");
  }

  const withFacts = groups.filter((g) => g.facts.some((f) => f.attempts != null || f.rejected_seen != null));
  if (withFacts.length > 0) {
    lines.push("", "## Where the gate shows", "");
    lines.push("The acceptance lets the last attempt decide, so a run that dials the wrong");
    lines.push("address, times out, and then dials the right one still passes. The gate's");
    lines.push("effect is in the columns below, not in the pass rate.", "");
    const rej = rejected_assets.length ? ` (${rejected_assets.join(", ")})` : "";
    lines.push(`| label | rejected asset seen${rej} | first batch all ok | first batch had a failure | failed attempts | corrected | validated | mean wall s | mean prompt tok | mean total tok |`);
    lines.push("|---|---|---|---|---|---|---|---|---|---|");
    const k = (x) => (x === null ? "—" : `${(x / 1000).toFixed(1)}k`);
    for (const g of withFacts) {
      lines.push(`| ${g.label} | ${frac(g.rejected_seen)} | ${frac(g.first_batch_all_ok)} | ${frac(g.first_batch_any_failed)} | ${num(g.failed_attempts)} | ${num(g.corrected)} | ${num(g.validated)} | ${g.wall_seconds_mean === null ? "—" : g.wall_seconds_mean.toFixed(0)} | ${k(g.prompt_tokens_mean)} | ${k(g.total_tokens_mean)} |`);
    }
    lines.push("", "\"First batch\" is every target call issued in the earliest message that carried one. Supplementary metric, added after the first comparison was read; the primary verdict stays \"last attempt decides\". In the off arm the wrong and right calls were issued in the same model message, so a failure in the first batch means the model dialled the wrong address, not that it corrected itself after seeing a failure.");
    lines.push("Tokens are the sum over a run's streamed responses of the usage the upstream reported (prompt includes cached tokens); \"—\" means no usage chunk was captured for any run in the group.");
    lines.push("", "\"seen\" means the asset appears at any lifecycle stage of the run — recalled,");
    lines.push("injected or fetched. A rejected asset that is never seen was hidden by the gate");
    lines.push("before the model could reach it; that is the product filtering, not this report.");
  }

  const withConf = groups.filter((g) => g.facts.some((f) => f.profile_memory_present !== null || f.non_pool_skill_read !== null));
  if (withConf.length > 0) {
    lines.push("", "## What else was in context", "");
    lines.push("Recorded per run from the captured system prompt and the service's rows");
    lines.push("(`context-confounders.json`). The consumer agent's own injected L3 memory can");
    lines.push("prescribe the behaviour a comparison would otherwise credit to the model, and a");
    lines.push("skill outside the frozen pool is a source the pool did not account for. Neither");
    lines.push("is excluded here; the columns say where they were.", "");
    lines.push("| label | L3 memory block present | L3 carried a watched line | read a skill outside the pool |");
    lines.push("|---|---|---|---|");
    for (const g of withConf) {
      lines.push(`| ${g.label} | ${frac(g.profile_memory_present)} | ${frac(g.l3_watch_hits_any)} | ${frac(g.non_pool_skill_read)} |`);
    }
    lines.push("", "A watched line is one the task's `confounders.watch` names — for bridge-addr,");
    lines.push("\"probe every documented candidate\" and \"never get-by-name (cross-agent 404)\".");
    lines.push("Where both arms carry it, the arms stay comparable with each other; what it takes");
    lines.push("away is the reading \"the model recovered on its own\" for the off arm's second dial.");
  }

  if (baseline_frozen_at) {
    lines.push("", `Baseline frozen ${baseline_frozen_at}. Runs marked (evidence base) fed the baseline's`);
    lines.push("decisions; runs marked (pre-baseline) predate it. Neither is part of the comparison.");
  }
  return lines.join("\n");
}

function readJson(p, fallback = null) { return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback; }
function readJsonl(p) { return existsSync(p) ? readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)) : null; }

/** Load a run directory into the shape summarizeRuns expects. */
export function loadRun(dir) {
  const run = readJson(join(dir, "run.json"));
  if (!run) return null;
  const eventFiles = ["events.jsonl", "early-events.jsonl", "used-events.jsonl", "outcome-events.jsonl"];
  const present = eventFiles.map((f) => readJsonl(join(dir, f))).filter(Boolean);
  return {
    ...run,
    verdict_doc: readJson(join(dir, "verdict.json")),
    events: present.length ? present.flat() : null,
    cost: readJson(join(dir, "cost.json")),
    confounders: readJson(join(dir, "context-confounders.json")),
  };
}

// ── CLI ───────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith("--")) ?? "evaluation/runner/runs";
  const baselineArg = args.find((a) => a.startsWith("--baseline="));
  const defaultBaseline = join(dir, "..", "..", "gate", "artifacts", "gate_baseline.json");
  const baselinePath = baselineArg ? baselineArg.slice("--baseline=".length) : (existsSync(defaultBaseline) ? defaultBaseline : null);
  if (!existsSync(dir)) {
    console.log(renderRuns({ groups: [], total: 0 }));
    process.exit(0);
  }
  const runs = readdirSync(dir)
    .map((name) => loadRun(join(dir, name)))
    .filter(Boolean)
    .sort((a, b) => String(a.run_id).localeCompare(String(b.run_id)));

  const summary = summarizeRuns(runs, { baseline: baselinePath ? readJson(baselinePath) : null });
  console.log(args.includes("--json") ? JSON.stringify(summary, null, 2) : renderRuns(summary));
}
