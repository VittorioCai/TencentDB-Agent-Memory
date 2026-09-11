/**
 * The loop's last step: the session's own experience flows back into the
 * candidate pool through the product's existing extraction — nothing new is
 * built. The run's captured conversation is posted to `/v3/skill/extract` AS
 * THE RUN'S CONSUMER (its user key, its fresh agent id, its conversation id as
 * the source session), and whatever Core extracts appears in the registry as
 * that consumer's asset with the status Core gives it (candidate: admission
 * is still the administrator's step). The record keeps the real author (the
 * consumer agent and user), the source session, the extraction task id, and
 * every asset that appeared, with its version and actual status.
 *
 *   node evaluation/tasks/exit-code-fix/write-back.mjs --run=<run dir> [--wait=90] [--dry-run]
 *
 * Auto-extraction is OFF for the comparison runs (prepare.sh); this is the
 * explicit, recorded trigger for one session. If Core answers that extraction
 * is not wired, the record says so and nothing is invented.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const CORE_URL = process.env.CORE_URL ?? "http://localhost:8420";
const SERVICE_ID = process.env.SERVICE_ID ?? "default";
const args = process.argv.slice(2);
const opt = (n) => (args.find((a) => a.startsWith(`--${n}=`)) ?? "").slice(n.length + 3) || null;
const runDir = opt("run");
if (!runDir) { console.error("usage: node write-back.mjs --run=<run dir> [--wait=seconds] [--dry-run]"); process.exit(2); }
const DRY = args.includes("--dry-run");
const WAIT = Number(opt("wait") ?? 90);

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const run = readJson(join(runDir, "run.json"));
const consumer = existsSync(join(runDir, "consumer.json")) ? readJson(join(runDir, "consumer.json")) : null;
const pair = readJson(join(HERE, "pair.json"));
const ids = readJson(join(REPO, "evaluation/tasks/identities.json"));
const agentId = consumer?.agent_id ?? run.resolved_identity?.agent_id ?? null;
const userId = consumer?.owner_user_id ?? run.resolved_identity?.user_id ?? null;
const teamId = consumer?.team_id ?? run.resolved_identity?.team_id ?? pair.team_id;
if (!agentId || !userId) { console.error("the run records no consumer agent/user; nothing to write back as"); process.exit(2); }
const keyFile = consumer?.key_file ?? Object.values(ids.identities).find((i) => i.user_id === userId)?.key_file;
if (!keyFile) { console.error(`no key file known for user ${userId}`); process.exit(2); }
const key = readFileSync(join(REPO, keyFile), "utf8").replace(/\s+/g, "");
const core = (path, body) => fetch(`${CORE_URL}${path}`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-tdai-service-id": SERVICE_ID, authorization: `Bearer ${key}`, "x-tdai-user-key": key },
  body: JSON.stringify(body),
}).then((r) => r.json()).catch((e) => ({ code: -1, message: String(e?.message ?? e) }));

// the conversation as the model saw it: the last request carries every message
const rows = readFileSync(join(runDir, "capture.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const requests = rows.filter((e) => e?.event === "http.request" && Array.isArray(e?.body?.json?.messages));
const last = requests[requests.length - 1];
if (!last) { console.error("the capture holds no model request; nothing to write back"); process.exit(2); }
const text = (c) => (typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (typeof b === "string" ? b : b?.text ?? "")).join("\n") : c == null ? "" : JSON.stringify(c));
const messages = [];
for (const m of last.body.json.messages) {
  const role = m?.role;
  if (role === "system" || role === "user") { const t = text(m.content).trim(); if (t) messages.push({ role, content: t }); }
  else if (role === "assistant") {
    const t = text(m.content).trim();
    if (t) messages.push({ role: "assistant", content: t });
    for (const tc of Array.isArray(m.tool_calls) ? m.tool_calls : []) {
      const name = String(tc?.function?.name ?? "tool");
      messages.push({ role: "tool_call", content: `${name}(${String(tc?.function?.arguments ?? "")})`, tool_name: name, tool_call_id: String(tc?.id ?? "") || undefined });
    }
  } else if (role === "tool") {
    const t = text(m.content).trim();
    messages.push({ role: "tool_result", content: t || "(empty)", tool_call_id: String(m.tool_call_id ?? "") || undefined });
  }
}
const capped = messages.slice(0, 500);
const conversationId = run.conversation_id ?? null;
const body = {
  team_id: teamId, user_id: userId, agent_id: agentId,
  session_id: conversationId ? `codebuddy:${conversationId}` : undefined,
  task_id: run.resolved_identity?.task_id ?? pair.task_id,
  messages: capped,
  reason: `dev loop ${run.run_id}: the session's own experience, written back as a candidate by the consumer that had it`,
};
console.log(`write-back as consumer ${agentId} (user ${userId}), source session ${body.session_id ?? "(none)"}: ${capped.length} message(s) from ${messages.length} (${requests.length} request(s) in the capture)`);
if (DRY) { console.log("dry run: nothing posted"); process.exit(0); }

// the registry before, so what appears is attributable to this call
const registry = async () => {
  const out = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const r = await core("/v3/meta/asset/list", { team_id: teamId, limit: 100, offset });
    const items = r?.data?.items ?? r?.data?.assets ?? [];
    out.push(...items);
    if (items.length < 100) break;
  }
  return out;
};
const before = new Set((await registry()).map((a) => a.asset_id));
const calledAt = new Date().toISOString().replace(/\.\d+Z$/, "Z");
const res = await core("/v3/skill/extract", body);
const rec = {
  run_id: run.run_id, called_at: calledAt,
  author: { agent_id: agentId, user_id: userId, team_id: teamId, key_file: keyFile },
  source_session: body.session_id ?? null, task_id: body.task_id,
  messages_posted: capped.length, messages_total: messages.length,
  extract_response: { code: res?.code ?? null, message: res?.message ?? null, task_id: res?.data?.task_id ?? null, archive_key: res?.data?.archive_key ?? null, archived_at_ms: res?.data?.archived_at_ms ?? null },
  new_assets: [], decision: null, waited_seconds: 0,
};
if (res?.code !== 0) {
  rec.decision = `extract refused: code ${res?.code} ${res?.message ?? ""}`.trim();
  writeFileSync(join(runDir, "write-back.json"), JSON.stringify(rec, null, 2) + "\n");
  console.log(rec.decision);
  process.exit(1);
}
console.log(`extract accepted: task ${rec.extract_response.task_id}, archive ${rec.extract_response.archive_key}; waiting up to ${WAIT}s for the registry to show the result …`);
const t0 = Date.now();
while ((Date.now() - t0) / 1000 < WAIT) {
  await new Promise((r) => setTimeout(r, 5000));
  const now = await registry();
  const fresh = now.filter((a) => !before.has(a.asset_id));
  if (fresh.length) {
    rec.new_assets = fresh.map((a) => ({ asset_id: a.asset_id, name: a.name ?? null, version: a.version ?? null, status: a.status ?? null, producer_agent_id: a.producer_agent_id ?? a.owner_agent_id ?? null, producer_user_id: a.producer_user_id ?? a.owner_user_id ?? null, created_at: a.created_at ?? a.asset_created_at ?? null }));
    break;
  }
}
rec.waited_seconds = Math.round((Date.now() - t0) / 1000);
rec.decision = rec.new_assets.length
  ? `Core extracted ${rec.new_assets.length} asset(s); status as Core set it: ${[...new Set(rec.new_assets.map((a) => a.status))].join(", ")} (admission is the administrator's step)`
  : `extract accepted but no new asset appeared in the registry within ${rec.waited_seconds}s (Core may have judged the session had nothing to keep, or the worker is still running); nothing is claimed`;
writeFileSync(join(runDir, "write-back.json"), JSON.stringify(rec, null, 2) + "\n");
console.log(rec.decision);
for (const a of rec.new_assets) console.log(`  ${a.asset_id}  ${a.name}  v${a.version}  ${a.status}  by ${a.producer_agent_id}`);
