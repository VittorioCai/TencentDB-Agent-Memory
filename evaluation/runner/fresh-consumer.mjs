/**
 * A fresh consumer agent for one run (review 2026-09-11, item 5: one new
 * consumer PER RUN, not one per arm). The agent is created under the
 * consumer user (identity b in evaluation/tasks/identities.json) with that
 * user's own key, so the cross-user judgement (author user ≠ consumer user)
 * is unchanged and the agent's memory scope — profiles/, records/,
 * skill_buffer/ — starts empty because the id has never had a session.
 *
 *   node evaluation/runner/fresh-consumer.mjs --name=<agent name> [--out=consumer.json]
 *
 * Prints one JSON line with the ids (never a key). The proxy switch that
 * makes the session run as this agent is prepare.sh's job (CONSUMER_AGENT=…
 * prepare.sh --identity b), and run-once.sh records both.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const CORE_URL = process.env.CORE_URL ?? "http://localhost:8420";
const SERVICE_ID = process.env.SERVICE_ID ?? "default";
const args = process.argv.slice(2);
const opt = (n) => (args.find((a) => a.startsWith(`--${n}=`)) ?? "").slice(n.length + 3) || null;
const name = opt("name");
if (!name) { console.error("usage: node fresh-consumer.mjs --name=<agent name> [--out=F] [--identity=b]"); process.exit(2); }

const ids = JSON.parse(readFileSync(join(REPO, "evaluation/tasks/identities.json"), "utf8"));
const who = ids.identities[opt("identity") ?? "b"];
if (!who) { console.error("identity not found in identities.json"); process.exit(2); }
const key = readFileSync(join(REPO, who.key_file), "utf8").replace(/\s+/g, "");
const core = (path, body) => fetch(`${CORE_URL}${path}`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-tdai-service-id": SERVICE_ID, authorization: `Bearer ${key}`, "x-tdai-user-key": key },
  body: JSON.stringify(body),
}).then((r) => r.json()).catch((e) => ({ code: -1, message: String(e?.message ?? e) }));

const created = await core("/v3/meta/agent/create", { team_id: who.team_id, owner_user_id: who.user_id, name });
if (created?.code !== 0 || !created.data?.agent_id) { console.error(`agent/create failed: ${created?.message ?? "?"}`); process.exit(1); }
const agent_id = created.data.agent_id;
const back = await core("/v3/meta/agent/get", { agent_id });
if (back?.code !== 0 || back.data?.owner_user_id !== who.user_id) { console.error(`agent/get read-back mismatch: ${back?.message ?? "?"} owner=${back?.data?.owner_user_id}`); process.exit(1); }

// the memory scope of a never-used id must be empty; checked in the container, not assumed
let footprint = null;
try {
  const root = (process.env.MEM_ROOT ?? "/data/tdai-memory/profiles").replace(/\/profiles\/?$/, "");
  const container = process.env.MEM_CONTAINER ?? "tdai-memory-core";
  const sh = (cmd) => execFileSync("docker", ["exec", container, "sh", "-c", cmd], { encoding: "utf8" }).trim();
  footprint = {
    profile_files: Number(sh(`cd '${root}/profiles' 2>/dev/null && find . -type f -path '*agent%3A${agent_id}*' | wc -l | tr -d ' ' || echo 0`)),
    records_lines: Number(sh(`cd '${root}' && cat records/*.jsonl 2>/dev/null | grep -c -F '${agent_id}' || true`)),
    buffer_sessions: Number(sh(`cd '${root}' && find skill_buffer -type d -name '${agent_id}' 2>/dev/null | while read d; do ls "$d" | wc -l; done | awk '{s+=$1} END {print s+0}'`)),
  };
} catch (e) { footprint = { error: String(e?.message ?? e) }; }

const rec = {
  agent_id, name, owner_user_id: who.user_id, team_id: who.team_id, identity: opt("identity") ?? "b", key_file: who.key_file,
  created_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  footprint_at_creation: footprint,
  note: "one consumer per run; created with the consumer user's own key; the proxy's debugForceIdentity is switched to it by prepare.sh and recorded by run-once.sh",
};
if (opt("out")) writeFileSync(opt("out"), JSON.stringify(rec, null, 2) + "\n");
console.log(JSON.stringify(rec));
