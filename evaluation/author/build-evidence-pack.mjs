/**
 * Evidence pack for a context-based author assessment.
 *
 * Review (2026-09-07) asked that an author be judged from their history, not
 * from a ratio of two counts. This file gathers that history — the author's
 * own records as the product holds them — into one file of addressable
 * records, each with a stable id the assessment must cite:
 *
 *   persona:<version>:<n>   one bullet/line of the author's persona (L3, /v3/core/read)
 *   l1:<memory id>          one L1 memory (/v3/atomic/query, all pages; plus /v3/atomic/search hits for the domain)
 *   l0:<message id>         one L0 message (/v3/conversation/query pages; plus /v3/conversation/search hits)
 *   skill:<id>@<version>    one skill the author owns (/v3/skill/list + /v3/skill/get head of content)
 *   outcome:<id>            one recorded outcome on an asset the author owns (/v3/meta/asset/outcome/list)
 *   call:<hash>             one bridge call the author's sessions made (optional JSONL from export-tool-call-logs.sh)
 *
 * Reads are made with the author's own key: the product's tenant isolation
 * decides what the author can see, and the pack is exactly that. Nothing is
 * summarised or filtered by relevance here; the assessment cites, the check
 * verifies, and a reader can open any record by id.
 *
 * Usage:
 *   node evaluation/author/build-evidence-pack.mjs --author=a|b|c --domain="…" [--keywords=k1,k2]
 *        [--asset=<asset_id>] [--calls=F.jsonl] [--max-l0=400] [--out=F]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";

const REPO = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const CORE_URL = process.env.CORE_URL || "http://localhost:8420";
const SERVICE_ID = process.env.SERVICE_ID || "default";

export function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2]; else if (a.startsWith("--")) out[a.slice(2)] = true;
  }
  return out;
}

export function identityOf(letter) {
  const ids = JSON.parse(readFileSync(resolve(REPO, "evaluation/tasks/identities.json"), "utf8"));
  const id = ids.identities?.[letter];
  if (!id) throw new Error(`identity ${letter} not in evaluation/tasks/identities.json`);
  const key = readFileSync(resolve(REPO, id.key_file), "utf8").replace(/\s+/g, "");
  return { letter, ...id, key };
}

async function post(path, body, key) {
  const res = await fetch(`${CORE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-tdai-service-id": SERVICE_ID, authorization: `Bearer ${key}`, "x-tdai-user-key": key },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { throw new Error(`${path}: non-JSON ${res.status}: ${text.slice(0, 200)}`); }
  if (json.code !== 0) throw new Error(`${path}: code ${json.code} ${json.message ?? ""}`);
  return json.data ?? {};
}

/** Persona lines → records. Blank lines and pure headings are kept out; bullets and sentences are records. */
export function personaRecords(persona) {
  if (!persona?.content) return [];
  const v = persona.version ?? "0";
  const out = [];
  persona.content.split("\n").forEach((line, i) => {
    const t = line.trim();
    if (!t || /^#{1,6}\s/.test(t) || /^---+$/.test(t)) return;
    out.push({ record_id: `persona:${v}:${i + 1}`, kind: "persona", text: t, at: persona.updated_at ?? null, meta: { version: v, line: i + 1 } });
  });
  return out;
}

export function l1Record(m) {
  return { record_id: `l1:${m.id}`, kind: "l1", text: m.content ?? "", at: m.created_at ?? m.createdAt ?? null,
    meta: { type: m.type ?? null, scene: m.scene_name ?? null, session_id: m.session_id ?? m.sessionId ?? null, task_id: m.task_id ?? m.taskId ?? null, source_message_ids: m.source_message_ids ?? null, priority: m.priority ?? null } };
}
export function l0Record(m) {
  return { record_id: `l0:${m.id}`, kind: "l0", text: m.content ?? "", at: m.timestamp ?? null,
    meta: { role: m.role ?? null, session_id: m.session_id ?? null, task_id: m.task_id ?? null } };
}
export function skillRecord(s, content) {
  const head = (content ?? "").slice(0, 1500);
  return { record_id: `skill:${s.skill_id}@${s.version}`, kind: "skill", text: `name: ${s.name}\ndescription: ${s.description ?? ""}\n${head}`, at: s.created_at_ms ? new Date(s.created_at_ms).toISOString() : null,
    meta: { skill_id: s.skill_id, version: s.version, name: s.name, status: s.status ?? null } };
}
export function outcomeRecord(o) {
  return { record_id: `outcome:${o.id}`, kind: "outcome", text: `${o.state}${o.corrected_reason ? `(${o.corrected_reason})` : ""} on asset ${o.asset_id} v${o.asset_version ?? "?"} by ${o.consumer_user_id} (${o.relation}) at ${o.occurred_at}; run ${o.run_id ?? "?"}`, at: o.occurred_at ?? null,
    meta: { asset_id: o.asset_id, state: o.state, corrected_reason: o.corrected_reason ?? null, relation: o.relation, consumer_user_id: o.consumer_user_id, run_id: o.run_id ?? null } };
}
export function callRecord(r) {
  const h = r.request_body_hash || createHash("sha1").update(`${r.timestamp}${r.request_body ?? ""}`).digest("hex").slice(0, 12);
  const body = typeof r.request_body === "string" ? r.request_body.slice(0, 600) : JSON.stringify(r.request_body ?? {}).slice(0, 600);
  return { record_id: `call:${h}`, kind: "call", text: `${r.timestamp} ${r.kind} ${r.executed_endpoint || r.initiated_tool || ""} status=${r.upstream_status ?? ""} ${r.reject_reason ? `reject=${r.reject_reason} ` : ""}${body}`, at: r.timestamp ?? null,
    meta: { session_key: r.session_key ?? null, kind: r.kind ?? null, endpoint: r.executed_endpoint ?? null, upstream_status: r.upstream_status ?? null } };
}

async function pages(path, base, key, itemsKey, limit, max) {
  const out = [];
  for (let offset = 0; out.length < max; offset += limit) {
    const d = await post(path, { ...base, limit, offset }, key);
    const items = d[itemsKey] ?? [];
    out.push(...items);
    const total = d.total ?? items.length;
    if (items.length === 0 || offset + items.length >= total) break;
  }
  return out.slice(0, max);
}

export async function buildPack({ author, domain, keywords = [], assetId = null, callsFile = null, maxL0 = 400 }) {
  const ids = { team_id: author.team_id, user_id: author.user_id, agent_id: author.agent_id };
  const records = new Map();
  const add = (r) => { if (r.text && r.text.trim()) records.set(r.record_id, r); };
  const sources = {};

  // L3 persona
  try { const p = await post("/v3/core/read", ids, author.key); personaRecords(p).forEach(add); sources.persona = { version: p.version ?? null, chars: (p.content ?? "").length }; }
  catch (e) { sources.persona = { error: String(e.message) }; }
  // L1, every page, plus search hits for the domain
  try {
    const all = await pages("/v3/atomic/query", ids, author.key, "items", 100, 2000);
    all.forEach((m) => add(l1Record(m)));
    sources.l1 = { total: all.length };
    for (const q of [domain, ...keywords].filter(Boolean)) {
      try { const d = await post("/v3/atomic/search", { ...ids, query: q, limit: 20 }, author.key); (d.items ?? []).forEach((m) => add(l1Record(m))); } catch { /* search is optional */ }
    }
  } catch (e) { sources.l1 = { error: String(e.message) }; }
  // L0, most recent pages, plus search hits
  try {
    const msgs = await pages("/v3/conversation/query", ids, author.key, "messages", 100, maxL0);
    msgs.forEach((m) => add(l0Record(m)));
    sources.l0 = { total: msgs.length, capped_at: maxL0 };
    for (const q of [domain, ...keywords].filter(Boolean)) {
      try { const d = await post("/v3/conversation/search", { ...ids, query: q, limit: 20 }, author.key); (d.messages ?? d.items ?? []).forEach((m) => add(l0Record(m))); } catch { /* optional */ }
    }
  } catch (e) { sources.l0 = { error: String(e.message) }; }
  // Skills the author owns, with the head of each body
  try {
    const d = await post("/v3/skill/list", { team_id: author.team_id, agent_id: author.agent_id, filters: { owner_agent_id: author.agent_id }, pagination: { limit: 100, offset: 0 } }, author.key);
    const items = d.items ?? [];
    for (const s of items) {
      let content = "";
      try { const g = await post("/v3/skill/get", { team_id: author.team_id, agent_id: author.agent_id, skill_id: s.skill_id, include_content: true }, author.key); content = g.content ?? ""; } catch { /* head only */ }
      add(skillRecord(s, content));
    }
    sources.skills = { total: items.length };
  } catch (e) { sources.skills = { error: String(e.message) }; }
  // Outcomes on the author's assets (as recorded in Core)
  try {
    const rows = await pages("/v3/meta/asset/outcome/list", { team_id: author.team_id, owner_user_id: author.user_id }, author.key, "items", 100, 2000);
    rows.forEach((o) => add(outcomeRecord(o)));
    sources.outcomes = { total: rows.length };
  } catch (e) { sources.outcomes = { error: String(e.message) }; }
  // Bridge calls from the author's sessions, if an export was supplied
  if (callsFile && existsSync(callsFile)) {
    const rows = readFileSync(callsFile, "utf8").split("\n").filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const mine = rows.filter((r) => r.user_id === author.user_id);
    mine.forEach((r) => add(callRecord(r)));
    sources.calls = { total: mine.length, file: callsFile };
  }

  const list = [...records.values()].sort((a, b) => String(a.at ?? "").localeCompare(String(b.at ?? "")));
  const body = JSON.stringify(list);
  return {
    schema: "author-evidence-pack-v1",
    built_at: new Date().toISOString(),
    author: { letter: author.letter, user_id: author.user_id, agent_id: author.agent_id, team_id: author.team_id },
    domain, keywords, asset_id: assetId,
    sources,
    record_count: list.length,
    by_kind: list.reduce((m, r) => { m[r.kind] = (m[r.kind] ?? 0) + 1; return m; }, {}),
    sha256: createHash("sha256").update(body).digest("hex"),
    records: list,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = parseArgs(process.argv.slice(2));
  if (!a.author || !a.domain) { console.error("usage: node build-evidence-pack.mjs --author=a|b|c --domain=… [--keywords=k1,k2] [--asset=ID] [--calls=F] [--max-l0=N] [--out=F]"); process.exit(2); }
  const author = identityOf(a.author);
  const pack = await buildPack({ author, domain: a.domain, keywords: a.keywords ? a.keywords.split(",").map((s) => s.trim()).filter(Boolean) : [], assetId: a.asset ?? null, callsFile: a.calls ?? null, maxL0: a["max-l0"] ? Number(a["max-l0"]) : 400 });
  const out = a.out || resolve(REPO, `evaluation/author/artifacts/evidence-pack-${a.author}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(pack, null, 2) + "\n");
  console.log(`evidence pack for ${a.author} (${author.user_id}): ${pack.record_count} record(s) ${JSON.stringify(pack.by_kind)} → ${out}`);
  for (const [k, v] of Object.entries(pack.sources)) if (v.error) console.log(`  [warn] ${k}: ${v.error}`);
}
