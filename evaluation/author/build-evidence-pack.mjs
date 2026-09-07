/**
 * Evidence pack for a context-based author assessment (v2, 2026-09-08b).
 *
 * Review (2026-09-07) asked that an author be judged from their history, not
 * from a ratio of two counts; the follow-up (2026-09-08) asked that the
 * history say what each record IS, so a conclusion can be checked against
 * the kind of evidence that carries it. This file gathers the author's own
 * records as the product holds them into one file of addressable records:
 *
 *   persona:<version>:<line>   one line of the persona (L3). Stored per
 *                              team + agent: the team's working principles
 *                              for that agent, not the person's own record.
 *                              evidence_class team_principles
 *   l1:<memory id>             one L1 memory: a derived summary. The query
 *                              API returns no source message ids, so
 *                              provenance is source_unavailable unless the
 *                              record carries them. evidence_class
 *                              derived_memory
 *   l0:<message id>            one L0 message. Only user and assistant
 *                              messages are stored; tool results are not.
 *                              evidence_class user_instruction |
 *                              assistant_report (a narration of what
 *                              happened, not the result itself)
 *   skill:<id>@<version>       one skill the author's agent owns (head of
 *                              body). The store records the owning agent,
 *                              not who wrote each version: operator unknown.
 *                              evidence_class authored_text
 *   outcome:<id>               one TRUSTED outcome recorded on an asset the
 *                              author owns (untrusted rows are counted, not
 *                              included). evidence_class harness_verified
 *   call:<hash>                one call the proxy itself logged for the
 *                              author's sessions (export-tool-call-logs.sh
 *                              with USER_ID=): request, upstream status,
 *                              reject reason. evidence_class proxy_observed
 *
 * Evidence cutoff: only records dated at or before --cutoff are included
 * (default: now). Records with no date are excluded and counted; a persona
 * updated after the cutoff is excluded whole, because its lines cannot be
 * dated one by one. The cutoff is recorded in the pack and travels to the
 * assessment and to Core, which will not read an assessment past the as_of
 * it evaluates at.
 *
 * The asset under assessment: its version, content hash and discriminative
 * tokens (from a tokens.json, else host:port and skill ids found in its
 * body) are recorded, and a chain is attempted — version → producer →
 * source sessions → observed operations → results — with every break named.
 *
 * Reads are made with the author's own key on the management path: the
 * product's tenant isolation decides what the author can see.
 *
 * Usage:
 *   node evaluation/author/build-evidence-pack.mjs --author=a|b|c --domain="…" [--keywords=k1,k2]
 *        [--asset=<asset_id>] [--cutoff=ISO] [--calls=F.jsonl] [--tokens=F.json] [--max-l0=400] [--out=F]
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
    headers: { "content-type": "application/json", "x-tdai-service-id": SERVICE_ID, authorization: `Bearer ${key}`, "x-tdai-user-key": key, "x-tdai-read-purpose": "manage" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { throw new Error(`${path}: non-JSON ${res.status}: ${text.slice(0, 200)}`); }
  if (json.code !== 0) throw new Error(`${path}: code ${json.code} ${json.message ?? ""}`);
  return json.data ?? {};
}

const isoOf = (v) => (v == null ? null : typeof v === "number" ? new Date(v).toISOString() : String(v));

/** Persona lines → records (team principles, L3, per team + agent). */
export function personaRecords(persona) {
  if (!persona?.content) return [];
  const v = persona.version ?? "0";
  const out = [];
  persona.content.split("\n").forEach((line, i) => {
    const t = line.trim();
    if (!t || /^#{1,6}\s/.test(t) || /^---+$/.test(t)) return;
    out.push({ record_id: `persona:${v}:${i + 1}`, kind: "persona", evidence_class: "team_principles", text: t, at: isoOf(persona.updated_at) ?? null,
      meta: { version: v, line: i + 1, scope: "team+agent (L3): the team's working principles for this agent, not the person's own record" } });
  });
  return out;
}
export function l1Record(m) {
  const src = m.source_message_ids ?? m.sourceMessageIds ?? null;
  return { record_id: `l1:${m.id}`, kind: "l1", evidence_class: "derived_memory", text: m.content ?? "", at: isoOf(m.created_at ?? m.createdAt) ?? null,
    meta: { type: m.type ?? null, scene: m.scene_name ?? null, session_id: m.session_id ?? m.sessionId ?? null, task_id: m.task_id ?? m.taskId ?? null, source_message_ids: src, priority: m.priority ?? null,
      provenance: Array.isArray(src) && src.length ? "traceable" : "source_unavailable" } };
}
export function l0Record(m) {
  const role = m.role ?? null;
  const cls = role === "tool" ? "tool_result" : role === "user" ? "user_instruction" : "assistant_report";
  return { record_id: `l0:${m.id}`, kind: "l0", evidence_class: cls, text: m.content ?? "", at: isoOf(m.timestamp) ?? null,
    meta: { role, session_id: m.session_id ?? null, task_id: m.task_id ?? null } };
}
export function skillRecord(s, content) {
  const head = (content ?? "").slice(0, 1500);
  return { record_id: `skill:${s.skill_id}@${s.version}`, kind: "skill", evidence_class: "authored_text", text: `name: ${s.name}\ndescription: ${s.description ?? ""}\n${head}`, at: s.created_at_ms ? new Date(s.created_at_ms).toISOString() : null,
    meta: { skill_id: s.skill_id, version: s.version, name: s.name, status: s.status ?? null, owner_agent_id: s.owner_agent_id ?? null, content_hash: s.content_hash ?? null,
      operator: "unknown: the skill store records the owning agent, not who wrote each version" } };
}
export function outcomeRecord(o) {
  return { record_id: `outcome:${o.id}`, kind: "outcome", evidence_class: "harness_verified", text: `${o.state}${o.corrected_reason ? `(${o.corrected_reason})` : ""} on asset ${o.asset_id} v${o.asset_version ?? "?"} by ${o.consumer_user_id} (${o.relation}) at ${o.occurred_at}; run ${o.run_id ?? "?"}; call ${o.call_id ?? "?"}; evidence ${String(o.evidence_json ?? "").slice(0, 300)}`, at: o.occurred_at ?? null,
    meta: { asset_id: o.asset_id, asset_version: o.asset_version ?? null, state: o.state, corrected_reason: o.corrected_reason ?? null, relation: o.relation, consumer_user_id: o.consumer_user_id, run_id: o.run_id ?? null, call_id: o.call_id ?? null, trusted: o.trusted === true } };
}
export function callRecord(r) {
  const h = r.request_body_hash || createHash("sha1").update(`${r.timestamp}${r.request_body ?? ""}`).digest("hex").slice(0, 12);
  const body = typeof r.request_body === "string" ? r.request_body.slice(0, 600) : JSON.stringify(r.request_body ?? {}).slice(0, 600);
  const at = r.timestamp ? new Date(String(r.timestamp).replace(" ", "T") + (String(r.timestamp).endsWith("Z") ? "" : "Z")).toISOString() : null;
  return { record_id: `call:${h}`, kind: "call", evidence_class: "proxy_observed", text: `${r.timestamp} ${r.kind} ${r.executed_endpoint || r.initiated_tool || ""} status=${r.upstream_status ?? ""} ${r.reject_reason ? `reject=${r.reject_reason} ` : ""}${body}`, at,
    meta: { session_key: r.session_key ?? null, kind: r.kind ?? null, endpoint: r.executed_endpoint ?? null, upstream_status: r.upstream_status ?? null, reject_reason: r.reject_reason || null, observed_by: "proxy tool_call_logs" } };
}

/** Discriminative tokens of an asset: from a tokens file when it names the asset, else what its body carries. */
export function assetTokens(assetId, content, tokensFiles = []) {
  for (const f of tokensFiles) {
    if (!existsSync(f)) continue;
    try { const t = JSON.parse(readFileSync(f, "utf8")); const e = t?.[assetId]; if (e?.tokens?.length) return { tokens: e.tokens.map(String), from: f }; } catch { /* next */ }
  }
  const found = new Set();
  for (const m of String(content ?? "").matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}:\d{2,5}\b|\blocalhost:\d{2,5}\b|\bskl-[A-Za-z0-9]{8,}\b/g)) found.add(m[0]);
  return { tokens: [...found], from: found.size ? "asset body" : null };
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

export async function buildPack({ author, domain, keywords = [], assetId = null, callsFile = null, tokensFiles = [], maxL0 = 400, cutoff = null }) {
  const cut = cutoff ? new Date(cutoff).toISOString() : new Date().toISOString();
  const ids = { team_id: author.team_id, user_id: author.user_id, agent_id: author.agent_id };
  const records = new Map();
  const excluded = { after_cutoff: 0, no_timestamp: 0, untrusted_outcomes: 0, persona_after_cutoff: false, other_users_calls: 0 };
  const add = (r) => {
    if (!r.text || !r.text.trim()) return;
    if (!r.at) { excluded.no_timestamp += 1; return; }
    if (r.at > cut) { excluded.after_cutoff += 1; return; }
    records.set(r.record_id, r);
  };
  const sources = {};

  // L3 persona — whole or nothing: lines cannot be dated one by one.
  try {
    const p = await post("/v3/core/read", ids, author.key);
    const at = isoOf(p.updated_at);
    if (at && at > cut) { excluded.persona_after_cutoff = true; sources.persona = { version: p.version ?? null, chars: (p.content ?? "").length, excluded: `updated ${at}, after the cutoff` }; }
    else { personaRecords(p).forEach(add); sources.persona = { version: p.version ?? null, chars: (p.content ?? "").length, updated_at: at }; }
  } catch (e) { sources.persona = { error: String(e.message) }; }
  // L1, every page, plus search hits for the domain
  try {
    const all = await pages("/v3/atomic/query", ids, author.key, "items", 100, 2000);
    all.forEach((m) => add(l1Record(m)));
    sources.l1 = { total: all.length, source_unavailable: all.filter((m) => !(m.source_message_ids ?? m.sourceMessageIds)?.length).length };
    for (const q of [domain, ...keywords].filter(Boolean)) {
      try { const d = await post("/v3/atomic/search", { ...ids, query: q, limit: 20 }, author.key); (d.items ?? []).forEach((m) => add(l1Record(m))); } catch { /* search is optional */ }
    }
  } catch (e) { sources.l1 = { error: String(e.message) }; }
  // L0, most recent pages, plus search hits
  try {
    const msgs = await pages("/v3/conversation/query", ids, author.key, "messages", 100, maxL0);
    msgs.forEach((m) => add(l0Record(m)));
    sources.l0 = { total: msgs.length, capped_at: maxL0, note: "user and assistant messages only; tool results are not stored as L0" };
    for (const q of [domain, ...keywords].filter(Boolean)) {
      try { const d = await post("/v3/conversation/search", { ...ids, query: q, limit: 20 }, author.key); (d.messages ?? d.items ?? []).forEach((m) => add(l0Record(m))); } catch { /* optional */ }
    }
  } catch (e) { sources.l0 = { error: String(e.message) }; }
  // Skills the author's agent owns, with the head of each body (management read: candidates included)
  const skillBodies = new Map();
  try {
    const d = await post("/v3/skill/list", { team_id: author.team_id, agent_id: author.agent_id, user_id: author.user_id, filters: { owner_agent_id: author.agent_id }, pagination: { limit: 100, offset: 0 } }, author.key);
    const items = d.items ?? [];
    for (const s of items) {
      let content = ""; let hash = s.content_hash ?? null;
      try { const g = await post("/v3/skill/get", { team_id: author.team_id, agent_id: author.agent_id, user_id: author.user_id, skill_id: s.skill_id, include_content: true }, author.key); content = g.content ?? ""; hash = g.content_hash ?? hash; } catch { /* head only */ }
      skillBodies.set(s.skill_id, content);
      add(skillRecord({ ...s, content_hash: hash }, content));
    }
    sources.skills = { total: items.length };
  } catch (e) { sources.skills = { error: String(e.message) }; }
  // Outcomes on the author's assets — trusted rows only
  try {
    const rows = await pages("/v3/meta/asset/outcome/list", { team_id: author.team_id, owner_user_id: author.user_id }, author.key, "items", 100, 2000);
    const trusted = rows.filter((o) => o.trusted === true);
    excluded.untrusted_outcomes = rows.length - trusted.length;
    trusted.forEach((o) => add(outcomeRecord(o)));
    sources.outcomes = { total: rows.length, trusted: trusted.length, note: "untrusted rows (a consumer's own report, or missing call id / version / evidence) are counted and left out" };
  } catch (e) { sources.outcomes = { error: String(e.message) }; }
  // Calls the proxy logged for the author's sessions, if an export was supplied
  if (callsFile && existsSync(callsFile)) {
    const rows = readFileSync(callsFile, "utf8").split("\n").filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const mine = rows.filter((r) => r.user_id === author.user_id);
    excluded.other_users_calls = rows.length - mine.length;
    mine.forEach((r) => add(callRecord(r)));
    sources.calls = { total: mine.length, file: callsFile, observed_by: "proxy tool_call_logs (ClickHouse)" };
  } else {
    sources.calls = { total: 0, note: "no proxy call export supplied (--calls); execution-grade evidence then rests on trusted outcomes alone" };
  }

  // The asset under assessment, its tokens, and the chain.
  let asset = null; let chain = null;
  if (assetId) {
    try {
      const a = await post("/v3/meta/asset/get", { asset_id: assetId }, author.key);
      const body = skillBodies.get(assetId) ?? "";
      const tk = assetTokens(assetId, body, tokensFiles);
      asset = { asset_id: a.asset_id, name: a.name, version: a.version, content_hash: a.content_hash ?? null, owner_user_id: a.owner_user_id, status: a.status, tokens: tk.tokens, tokens_from: tk.from };
      const list = [...records.values()];
      const mentions = (t) => asset.tokens.some((tok) => t.includes(tok)) || (a.name && t.includes(a.name));
      const sessions = [...new Set(list.filter((r) => r.kind === "l0" && mentions(r.text)).map((r) => r.meta.session_id).filter(Boolean))];
      const ops = list.filter((r) => r.kind === "call" && mentions(r.text));
      const results = list.filter((r) => r.kind === "outcome" && r.meta.asset_id === assetId);
      const breaks = [];
      breaks.push("producer: the skill store records the owning agent, not who wrote this version; the operator of the version is unknown");
      if (!sessions.length) breaks.push("source session: no L0 message at or before the cutoff names the asset or its tokens");
      if (!ops.length) breaks.push(sources.calls?.total ? "operations: no proxy-observed call carries the asset's tokens" : "operations: no proxy call export was supplied, so no observed operation can be tied to the asset");
      if (!results.length) breaks.push("results: no trusted outcome is recorded on this asset at or before the cutoff");
      chain = {
        asset_version: a.version, content_hash: a.content_hash ?? null,
        producer: { owner_user_id: a.owner_user_id, owner_agent_id: author.agent_id, operator: "unknown" },
        source_sessions: sessions,
        operations: ops.map((r) => ({ record_id: r.record_id, at: r.at, status: r.meta.upstream_status, kind: r.meta.kind })),
        results: results.map((r) => ({ record_id: r.record_id, state: r.meta.state, corrected_reason: r.meta.corrected_reason, at: r.at })),
        complete: breaks.length === 1, // the operator is always unknown
        breaks,
      };
    } catch (e) { asset = { asset_id: assetId, error: String(e.message) }; }
  }

  const list = [...records.values()].sort((a, b) => String(a.at ?? "").localeCompare(String(b.at ?? "")));
  const body = JSON.stringify(list);
  return {
    schema: "author-evidence-pack-v2",
    built_at: new Date().toISOString(),
    evidence_cutoff: cut,
    author: { letter: author.letter, user_id: author.user_id, agent_id: author.agent_id, team_id: author.team_id },
    domain, keywords, asset_id: assetId, asset, chain,
    sources, excluded,
    record_count: list.length,
    by_kind: list.reduce((m, r) => { m[r.kind] = (m[r.kind] ?? 0) + 1; return m; }, {}),
    by_class: list.reduce((m, r) => { m[r.evidence_class] = (m[r.evidence_class] ?? 0) + 1; return m; }, {}),
    sha256: createHash("sha256").update(body).digest("hex"),
    records: list,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = parseArgs(process.argv.slice(2));
  if (!a.author || !a.domain) { console.error("usage: node build-evidence-pack.mjs --author=a|b|c --domain=… [--keywords=k1,k2] [--asset=ID] [--cutoff=ISO] [--calls=F] [--tokens=F] [--max-l0=N] [--out=F]"); process.exit(2); }
  const author = identityOf(a.author);
  const tokensFiles = [a.tokens, resolve(REPO, "evaluation/attribution/artifacts/tokens.json"), resolve(REPO, "evaluation/tasks/bridge-name/tokens.json")].filter(Boolean);
  const pack = await buildPack({ author, domain: a.domain, keywords: a.keywords ? a.keywords.split(",").map((s) => s.trim()).filter(Boolean) : [], assetId: a.asset ?? null, callsFile: a.calls ?? null, tokensFiles, maxL0: a["max-l0"] ? Number(a["max-l0"]) : 400, cutoff: a.cutoff ?? null });
  const out = a.out || resolve(REPO, `evaluation/author/artifacts/evidence-pack-${a.author}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(pack, null, 2) + "\n");
  console.log(`evidence pack for ${a.author} (${author.user_id}) cutoff ${pack.evidence_cutoff}: ${pack.record_count} record(s) ${JSON.stringify(pack.by_class)}; excluded ${JSON.stringify(pack.excluded)} → ${out}`);
  if (pack.chain) console.log(`  chain: ${pack.chain.complete ? "complete but for the operator" : `${pack.chain.breaks.length} break(s)`} — ${pack.chain.breaks.join(" | ")}`);
  for (const [k, v] of Object.entries(pack.sources)) if (v.error) console.log(`  [warn] ${k}: ${v.error}`);
}
