/**
 * `contributed` events (the last link of the topic's overview chain).
 *
 * Definition, as approved: an asset VERSION, in a named contrast batch, has
 * traceable evidence of positive gain. Three conditions, all required:
 *
 *   1. a `validated` event for this version inside the batch's present runs
 *      — it was really used, and the call it fed passed;
 *   2. a present-vs-absent contrast OF THIS ASSET (leave-one-out): runs where
 *      it was visible against runs where it was hidden. The gate on/off
 *      comparison does not qualify — it contrasts the wrong asset's presence,
 *      and would credit the right asset with someone else's absence;
 *   3. at least one gain metric that is non-zero and consistent in direction
 *      between the two sides.
 *
 * The event carries raw values on both sides, the run ids on both sides, the
 * batch id and the commit the judging rules were frozen at, so a reader can
 * recompute every number from the run directories. Nothing here changes the
 * gate: admit already rests on validated; contributed is a stronger, later
 * claim, kept separate.
 *
 * Usage:
 *   node evaluation/calibration/contributed.mjs evaluation/runner/runs [--tokens=F] [--rules-commit=SHA] [--batch-date=YYYY-MM-DD] [--out=F]
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { execSync } from "node:child_process";
import { loadRun, calibrate } from "./loo.mjs";
import { eventId } from "../provenance/build-events.mjs";

function readJson(p, fb = null) { return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fb; }
function readJsonl(p) { return existsSync(p) ? readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)) : []; }
const mean = (xs) => { const v = xs.filter((x) => typeof x === "number"); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const round = (x) => (x === null ? null : Math.round(x * 1000) / 1000);

/** Per-run facts needed for the gain metrics. */
export function runGainFacts(dir) {
  const run = readJson(join(dir, "run.json"));
  if (!run) return null;
  const verdict = readJson(join(dir, "verdict.json"), {});
  const cost = readJson(join(dir, "cost.json"), {});
  const attempts = verdict.attempts ?? [];
  return {
    run_id: run.run_id,
    passed: run.verdict === "PASS" ? 1 : run.verdict === "FAIL" ? 0 : null,
    failed_attempts: attempts.filter((a) => a.ok === false).length,
    wall_seconds: cost.wall_seconds ?? null,
    prompt_tokens: cost.prompt_tokens ?? null,
    validated: readJsonl(join(dir, "outcome-events.jsonl")).filter((e) => e.state === "validated"),
  };
}

/** Gains between two sides; each metric keeps raw values on both sides. */
export function gainsOf(present, absent) {
  const side = (rs) => ({
    pass_rate: mean(rs.map((r) => r.passed)),
    failed_attempts_mean: mean(rs.map((r) => r.failed_attempts)),
    wall_seconds_mean: mean(rs.map((r) => r.wall_seconds)),
    prompt_tokens_mean: mean(rs.map((r) => r.prompt_tokens)),
  });
  const p = side(present), a = side(absent);
  // Direction: pass_rate higher with the asset; the others lower with it.
  const better = {
    pass_rate: (x, y) => x > y,
    failed_attempts_mean: (x, y) => x < y,
    wall_seconds_mean: (x, y) => x < y,
    prompt_tokens_mean: (x, y) => x < y,
  };
  const gains = {};
  for (const k of Object.keys(better)) {
    if (p[k] === null || a[k] === null) { gains[k] = { present: null, absent: null, gain: null }; continue; }
    gains[k] = { present: round(p[k]), absent: round(a[k]), gain: better[k](p[k], a[k]) ? true : (p[k] === a[k] ? null : false) };
  }
  return gains;
}

/**
 * Decide contributed for every asset with a leave-one-out contrast.
 * Returns { events, rows } where rows explain each asset's outcome.
 */
export function contributedEvents({ runsDir, tokensByAsset, rulesCommit = null, batchDate = null, now = null }) {
  const dirs = readdirSync(runsDir).map((n) => join(runsDir, n)).filter((d) => existsSync(join(d, "run.json")));
  const runs = dirs.map((d) => loadRun(d, tokensByAsset)).filter(Boolean);
  const facts = new Map(dirs.map((d) => [readJson(join(d, "run.json")).run_id, runGainFacts(d)]));
  const cal = calibrate(runs, Object.keys(tokensByAsset));
  const stamp = now ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const date = batchDate ?? stamp.slice(0, 10);
  const events = [];
  const rows = [];

  for (const row of cal.rows) {
    const present = row.present_run_ids.map((id) => facts.get(id)).filter(Boolean);
    const absent = row.absent_run_ids.map((id) => facts.get(id)).filter(Boolean);
    const validated = present.flatMap((r) => r.validated.filter((e) => e.asset_id === row.asset_id));
    const explain = { asset_id: row.asset_id, present: present.length, absent: absent.length, validated_in_present: validated.length, decision: "not contributed", why: "" };

    if (absent.length === 0) { explain.why = "no run with this asset hidden — no contrast of the asset itself"; rows.push(explain); continue; }
    if (validated.length === 0) { explain.why = "no validated event for this asset in the present runs"; rows.push(explain); continue; }
    if (row.status !== "needed") { explain.why = `calibration status is "${row.status}", not needed`; rows.push(explain); continue; }

    // One event per version actually validated.
    const versions = [...new Set(validated.map((e) => String(e.asset_version)))];
    for (const v of versions) {
      const vEvents = validated.filter((e) => String(e.asset_version) === v);
      const gains = gainsOf(present, absent);
      const positive = Object.entries(gains).filter(([, g]) => g.gain === true).map(([k]) => k);
      const negative = Object.entries(gains).filter(([, g]) => g.gain === false).map(([k]) => k);
      if (positive.length === 0) { explain.why = `no gain metric is positive (${negative.length ? "negative: " + negative.join(", ") : "all equal or unmeasured"})`; rows.push(explain); continue; }

      const batchId = `loo-${row.asset_id}-${date}`;
      const base = vEvents[0];
      const summary = positive.map((k) => `${k} ${gains[k].present} vs ${gains[k].absent}`).join("; ");
      events.push({
        schema_version: "provenance-v1",
        event_id: eventId([batchId, row.asset_id, "contributed", v]),
        state: "contributed",
        session_key: `batch:${batchId}`,
        run_id: null,
        task_id: base.task_id ?? null,
        occurred_at: stamp,
        asset_id: row.asset_id,
        asset_type: base.asset_type,
        asset_name: base.asset_name,
        asset_version: base.asset_version,
        asset_created_at: base.asset_created_at,
        pool_snapshot_at: base.pool_snapshot_at,
        excluded_by_snapshot: false,
        producer_user_id: base.producer_user_id,
        producer_agent_id: base.producer_agent_id,
        actor_user_id: base.actor_user_id,
        actor_agent_id: base.actor_agent_id,
        relation: base.relation,
        observation: base.observation,
        evidence_tier: "hard",
        bridge_source: "",
        executed_endpoint: "",
        upstream_status: 0,
        target_type: "test_action",
        target_ref: `contrast:${batchId}`,
        proof_refs: [
          { kind: "contrast_batch", ref: batchId, detail: `present ${present.length} run(s) vs absent ${absent.length}: ${summary}${negative.length ? `; against: ${negative.join(", ")}` : ""}` },
          ...vEvents.slice(0, 3).map((e) => ({ kind: "verify_result", ref: e.proof_refs?.[0]?.ref ?? e.event_id, detail: `validated in ${e.run_id ?? e.session_key}` })),
        ],
        corrected_reason: null,
        parent_event_ids: vEvents.map((e) => e.event_id),
        metadata: {
          contrast_batch: { id: batchId, frozen_at: stamp, rules_commit: rulesCommit },
          present_runs: present.map((r) => r.run_id),
          absent_runs: absent.map((r) => r.run_id),
          gains,
          positive_metrics: positive,
          negative_metrics: negative,
        },
      });
      explain.decision = `contributed (v${v})`;
      explain.why = summary + (negative.length ? `; against: ${negative.join(", ")}` : "");
    }
    rows.push(explain);
  }
  return { events, rows, runs_without_gate_state: cal.runs_without_gate_state };
}

export function renderContributed({ events, rows }) {
  const lines = ["# contributed", ""];
  for (const r of rows) lines.push(`${r.decision.padEnd(22)} ${r.asset_id}  present ${r.present} / absent ${r.absent} / validated ${r.validated_in_present}  — ${r.why}`);
  lines.push("", `${events.length} contributed event(s)`);
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const runsDir = args.find((a) => !a.startsWith("--")) ?? "evaluation/runner/runs";
  const arg = (n) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
  const tokensByAsset = readJson(arg("tokens") ?? "evaluation/attribution/artifacts/tokens.json", {});
  let rulesCommit = arg("rules-commit");
  if (!rulesCommit) { try { rulesCommit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim(); } catch { rulesCommit = null; } }
  const result = contributedEvents({ runsDir, tokensByAsset, rulesCommit, batchDate: arg("batch-date") });
  const out = arg("out") ?? "evaluation/calibration/contributed-events.jsonl";
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, result.events.map((e) => JSON.stringify(e)).join("\n") + (result.events.length ? "\n" : ""));
  console.log(renderContributed(result));
  console.log(`→ ${out}`);
}
