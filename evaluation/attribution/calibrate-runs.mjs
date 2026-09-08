#!/usr/bin/env node
/**
 * Calibration over saved runs, recomputed from the raw record every time.
 *
 *   node evaluation/attribution/calibrate-runs.mjs evaluation/runner/runs/2026*-gate-*
 *   node evaluation/attribution/calibrate-runs.mjs --frozen=gate-rules-2026-09-08f <runs…>
 *
 * Nothing here is read from a previous report: the verdicts come from the
 * capture, the judgements from the run's own events, and what each run was
 * measured under — rules version, baseline, model, asset version — from the
 * run directory. A report that cannot be regenerated from the raw data is a
 * claim, not a measurement.
 */
import { readFileSync, existsSync } from "node:fs";
import { auditDelivery, attributionFromCapture, operationFromTargetRef, verifyCoverage } from "./delivery-audit.mjs";
import { calibrate, renderCalibration } from "./calibration.mjs";

const readJson = (p, fallback = null) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback);
const readLines = (p) => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

export function runInput(dir) {
  const rows = readFileSync(`${dir}/capture.jsonl`, "utf8").split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const coverage = verifyCoverage(rows);
  const requests = rows.filter((o) => o.event === "http.request");
  const tokens = readJson(`${dir}/tokens.json`, {}) ?? {};
  const run = readJson(`${dir}/run.json`, {}) ?? {};
  const baseline = readJson(`${dir}/gate_baseline.json`, {}) ?? {};

  let operation = null;
  for (const e of readLines(`${dir}/used-events.jsonl`)) {
    const op = operationFromTargetRef(e.target_ref, requests);
    if (op && (!operation || op.request < operation.request || (op.request === operation.request && op.index < operation.index))) operation = op;
  }
  const audit = auditDelivery(requests, tokens, {
    operation, attributionOf: attributionFromCapture(requests), coverageAsserted: coverage.complete,
  });

  const used = new Set(readLines(`${dir}/used-events.jsonl`).map((e) => e.asset_id));
  const statusAtStart = run.gate?.status_at_start ?? {};
  const model = (rows.map((r) => /"model"\s*:\s*"([^"]+)"/.exec(JSON.stringify(r.body ?? "")))
    .find(Boolean) ?? [])[1] ?? null;

  const assets = {};
  for (const [assetId, spec] of Object.entries(tokens)) {
    assets[assetId] = {
      judgedUsed: used.has(assetId),
      // Hidden means the gate had put it out of reach for this run.
      hidden: statusAtStart[assetId] === "failed",
      verdict: audit.assets[assetId]?.verdict ?? "not_seen_in_capture",
      asset_version: spec?.version ?? null,
    };
  }
  return {
    run_id: run.run_id ?? dir.split("/").pop(), label: run.label ?? null,
    rules_version: baseline.rules_version ?? null,
    started_at: run.started_at ?? null,
    baseline_frozen_at: run.gate?.baseline_frozen_at ?? baseline.frozen_at ?? null,
    model, capture_complete: coverage.complete, coverage_reasons: coverage.reasons, assets,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const frozen = (args.find((a) => a.startsWith("--frozen=")) ?? "").slice(9) || null;
  const dirs = args.filter((a) => !a.startsWith("--"));
  if (!dirs.length) { console.error("usage: calibrate-runs.mjs [--frozen=<rules version>] <run dir> …"); process.exit(2); }
  const runs = dirs.map(runInput);
  const result = calibrate(runs);
  console.log(renderCalibration(result, { frozenRules: frozen }));
  console.log("\n## Per run\n");
  console.log("| run | rules | model | capture | asset | hidden | judged used | delivery | bucket |");
  console.log("|---|---|---|---|---|---|---|---|---|");
  for (const r of result.rows) {
    const src = runs.find((x) => x.run_id === r.run_id);
    console.log(`| ${r.run_id} | ${r.rules_version ?? "—"} | ${r.model ?? "—"} | ${src?.capture_complete ? "complete" : "INCOMPLETE"} | ${r.asset_id} | ${r.hidden} | ${r.judged_used} | ${r.delivery} | ${r.bucket} |`);
  }
}
