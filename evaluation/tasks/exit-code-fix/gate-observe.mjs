/**
 * One observation of the note's gate state in Core, appended to
 * gate-observations.jsonl beside this script: status, visibility, revision,
 * evidence_revision, and the gate block (decision, decided_at, signals).
 * The report reads these to say whether the gate moved after the loop —
 * a write-back or an outcome sync that leaves decided_at where it was is a
 * write, not a closed loop.
 *
 *   node evaluation/tasks/exit-code-fix/gate-observe.mjs --label=<why now>
 */
import { readFileSync, appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const DIR = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(DIR, "../../..");
const CORE_URL = process.env.CORE_URL ?? "http://localhost:8420";
const args = process.argv.slice(2);
const label = (args.find((a) => a.startsWith("--label=")) ?? "").slice(8) || "observation";
const tokens = JSON.parse(readFileSync(join(DIR, "tokens.json"), "utf8"));
const id = Object.keys(tokens).find((k) => !k.startsWith("_"));
const k = readFileSync(join(REPO, "deploy/global-images/.topic4-user-key"), "utf8").replace(/\s+/g, "");
const post = (path, body) => fetch(`${CORE_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-tdai-service-id": "default", authorization: `Bearer ${k}`, "x-tdai-user-key": k }, body: JSON.stringify(body) }).then((r) => r.json()).catch((e) => ({ code: -1, message: String(e) }));
const a = (await post("/v3/meta/asset/get", { asset_id: id }))?.data ?? {};
let gate = null;
try { gate = JSON.parse(a.metadata_json ?? "{}")?.gate ?? null; } catch { gate = null; }
const g = (await post("/v3/meta/asset/gate/get", { asset_id: id }))?.data ?? null;
const rec = {
  at: new Date().toISOString().replace(/\.\d+Z$/, "Z"), label, asset_id: id,
  status: a.status ?? null, visibility: a.visibility ?? null, version: a.version ?? null, revision: a.revision ?? null, evidence_revision: a.evidence_revision ?? null, updated_at: a.updated_at ?? null,
  gate: gate ? { decision: gate.decision, status_target: gate.status_target, decided_at: gate.decided_at, rules_version: gate.rules_version, reasons: gate.reasons, online: gate.signals?.online ?? null, effective: gate.effective ?? null } : null,
  gate_get: g,
};
appendFileSync(join(DIR, "gate-observations.jsonl"), JSON.stringify(rec) + "\n");
console.log(`${rec.at} [${label}] ${id}: status ${rec.status}, visibility ${rec.visibility}, evidence_revision ${rec.evidence_revision}, gate ${rec.gate?.decision ?? "?"} decided_at ${rec.gate?.decided_at ?? "?"} (online validated ${rec.gate?.online?.validated ?? "?"}, used ${rec.gate?.online?.used ?? "?"}, corrected ${rec.gate?.online?.corrected ?? "?"})`);
