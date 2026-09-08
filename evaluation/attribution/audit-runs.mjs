#!/usr/bin/env node
/**
 * Run the delivery audit over saved runs and print one line per asset.
 *
 *   node evaluation/attribution/audit-runs.mjs evaluation/runner/runs/2026*-gate-*
 *
 * Everything it needs is already in the run directory: the capture (coverage
 * and content), the frozen tokens.json (which tokens are discriminative),
 * and the used-event's target_ref (where the operation being judged sits).
 */
import { readFileSync, existsSync } from "node:fs";
import { auditDelivery, attributionFromCapture, operationFromTargetRef, verifyCoverage } from "./delivery-audit.mjs";
for (const d of process.argv.slice(2)) {
  const rows = readFileSync(`${d}/capture.jsonl`, "utf8").split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const coverage = verifyCoverage(rows);
  const reqs = rows.filter((o) => o.event === "http.request");
  const tokens = existsSync(`${d}/tokens.json`) ? JSON.parse(readFileSync(`${d}/tokens.json`, "utf8")) : {};
  let operation = null;
  if (existsSync(`${d}/used-events.jsonl`)) {
    for (const l of readFileSync(`${d}/used-events.jsonl`, "utf8").split("\n").filter(Boolean)) {
      const op = operationFromTargetRef(JSON.parse(l).target_ref, reqs);
      if (op && (!operation || op.request < operation.request || (op.request === operation.request && op.index < operation.index))) operation = op;
    }
  }
  const a = auditDelivery(reqs, tokens, { operation, attributionOf: attributionFromCapture(reqs), coverageAsserted: coverage.complete });
  console.log(`${d.split("/").pop()}  ${coverage.requests}req/${coverage.responses}resp  op=${operation ? `r${operation.request}:m${operation.index}` : "?"}  coverage=${coverage.complete ? "COMPLETE" : "incomplete: " + coverage.reasons[0]}`);
  for (const [id, v] of Object.entries(a.assets)) console.log(`   ${id}: ${v.verdict}`);
}
