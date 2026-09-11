/**
 * Ask Core's gate to evaluate the note — dry run (apply:false, nothing
 * written) or apply (apply:true: the rule's decision becomes the status).
 * The full response is appended to gate-evaluations.jsonl beside this
 * script with a label, so the report can show what the rule saw (signals,
 * reasons, whether the author signal is used or only reported) and, after
 * apply, what changed. Owner key: the gate route is the owner's.
 *
 *   node evaluation/tasks/exit-code-fix/gate-evaluate.mjs --dry-run --label=<why>
 *   node evaluation/tasks/exit-code-fix/gate-evaluate.mjs --apply   --label=<why>
 *   node evaluation/tasks/exit-code-fix/gate-evaluate.mjs --dry-run --as-of=<ISO time> --label=<why>
 *
 * --as-of asks the rule to use only evidence recorded up to that time (the
 * route's `as_of`): what the gate would have said before a set of runs, e.g.
 * with the author assessment on file and no outcome yet. Dry run only.
 */
import { readFileSync, appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const DIR = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(DIR, "../../..");
const args = process.argv.slice(2);
const apply = args.includes("--apply");
if (!apply && !args.includes("--dry-run")) { console.error("usage: gate-evaluate.mjs --dry-run|--apply [--label=…]"); process.exit(2); }
const label = (args.find((a) => a.startsWith("--label=")) ?? "").slice(8) || (apply ? "apply" : "dry-run");
const asOf = (args.find((a) => a.startsWith("--as-of=")) ?? "").slice(8) || null;
if (asOf && apply) { console.error("--as-of is for --dry-run only: a status is never applied from a past view of the evidence"); process.exit(2); }
const tokens = JSON.parse(readFileSync(join(DIR, "tokens.json"), "utf8"));
const id = Object.keys(tokens).find((k) => !k.startsWith("_"));
const k = readFileSync(join(REPO, "deploy/global-images/.topic4-user-key"), "utf8").replace(/\s+/g, "");
const post = (path, body) => fetch(`${process.env.CORE_URL ?? "http://localhost:8420"}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-tdai-service-id": "default", authorization: `Bearer ${k}`, "x-tdai-user-key": k }, body: JSON.stringify(body) }).then((r) => r.json()).catch((e) => ({ code: -1, message: String(e) }));
const before = (await post("/v3/meta/asset/get", { asset_id: id }))?.data ?? {};
const r = await post("/v3/meta/asset/gate/evaluate", asOf ? { asset_id: id, apply, as_of: asOf } : { asset_id: id, apply });
const after = (await post("/v3/meta/asset/get", { asset_id: id }))?.data ?? {};
const d = r?.data ?? {};
const g = d.decision && typeof d.decision === "object" ? d.decision : d;
const rec = {
  at: new Date().toISOString().replace(/\.\d+Z$/, "Z"), label, asset_id: id, apply, as_of: asOf, code: r?.code ?? null, message: r?.message ?? null,
  decision: g?.decision ?? null, status_target: g?.status_target ?? null, decided_at: g?.decided_at ?? null, rules_version: g?.rules_version ?? null,
  asset_version: g?.asset_version ?? null, review_priority: g?.review_priority ?? null, evidence_as_of: g?.evidence_as_of ?? null,
  reasons: g?.reasons ?? null, signals: g?.signals ?? null, applied: d?.applied ?? null,
  status_before: before.status ?? null, status_after: after.status ?? null, evidence_revision: after.evidence_revision ?? null,
  raw: r,
};
appendFileSync(join(DIR, "gate-evaluations.jsonl"), JSON.stringify(rec) + "\n");
console.log(`${rec.at} [${label}] ${apply ? "APPLY" : "dry-run"}${asOf ? ` as_of ${asOf}` : ""} ${id} v${rec.asset_version ?? "?"}: decision ${rec.decision} → status_target ${rec.status_target}; status ${rec.status_before} → ${rec.status_after}; decided_at ${rec.decided_at}; online ${JSON.stringify(rec.signals?.online ?? null)}`);
for (const why of rec.reasons ?? []) console.log(`   - ${why}`);
process.exit(rec.code === 0 ? 0 : 1);
