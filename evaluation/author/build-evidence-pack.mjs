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
  const created = isoOf(m.created_at ?? m.createdAt) ?? null;
  const updated = isoOf(m.updated_at ?? m.updatedAt) ?? null;
  // A memory is a mutable row: the text on file is the text as of its last
  // modification, so that is the date the cutoff must see. The store keeps
  // no earlier version, so a memory changed after the cutoff cannot be
  // recovered as it was and is excluded.
  const at = updated && created && updated > created ? updated : created;
  return { record_id: `l1:${m.id}`, kind: "l1", evidence_class: "derived_memory", text: m.content ?? "", at,
    meta: { type: m.type ?? null, scene: m.scene_name ?? null, session_id: m.session_id ?? m.sessionId ?? null, task_id: m.task_id ?? m.taskId ?? null, source_message_ids: src, priority: m.priority ?? null,
      created_at: created, updated_at: updated, provenance: Array.isArray(src) && src.length ? "traceable" : "source_unavailable" } };
}
/**
 * Two copies of one record, merged so the poorer never replaces the richer.
 * The same message arrives from `conversation/query`, which returns
 * `session_id`, and from `conversation/search`, which returns only
 * content/id/role/score/timestamp; a plain overwrite dropped the session id
 * on every message the search found (2026-09-08g).
 */
export function mergeRecord(prev, next) {
  const meta = { ...next.meta };
  for (const [k, v] of Object.entries(prev.meta ?? {})) {
    if (v !== null && v !== undefined && (meta[k] === null || meta[k] === undefined)) meta[k] = v;
  }
  return { ...prev, ...next, meta };
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
      tokens: bodyTokens(content), head_version: s.head_version ?? null, version_at_cutoff: s.version_at_cutoff ?? null,
      // 2026-09-12 第二人复核:这个字段还留着 2026-09-08g 之前的说法。版本行上的 user_id
      // (`/v3/skill/versions` 的 owner_user_id)就是那一版的写入者,链里已按事实记;这里
      // 不再声称 unknown,而是指向那个字段。
      writer_field: "per-version writer is on the version row (skills.user_id, returned as owner_user_id by /v3/skill/versions); see chain.producer.wrote_this_version" } };
}

/** host:port and skill-id tokens carried by a body — exact values, no host-only forms. */
export function bodyTokens(content) {
  const found = new Set();
  for (const m of String(content ?? "").matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}:\d{2,5}\b|\blocalhost:\d{2,5}\b|\bskl-[A-Za-z0-9]{8,}\b/g)) found.add(m[0]);
  return [...found];
}
export function outcomeRecord(o, tokensOf = () => ({ tokens: [], from: null })) {
  const tk = tokensOf(o.asset_id, o.asset_version);
  return { record_id: `outcome:${o.id}`, kind: "outcome", evidence_class: "harness_verified", text: `${o.state}${o.corrected_reason ? `(${o.corrected_reason})` : ""} on asset ${o.asset_id} v${o.asset_version ?? "?"}${tk.tokens.length ? ` (tokens of v${o.asset_version}: ${tk.tokens.join(", ")})` : ""} by ${o.consumer_user_id} (${o.relation}) at ${o.occurred_at}; run ${o.run_id ?? "?"}; call ${o.call_id ?? "?"}; evidence ${String(o.evidence_json ?? "").slice(0, 300)}`, at: o.occurred_at ?? null,
    // content_hash and retracted_at travel with the row (2026-09-08d): the
    // registry binds an outcome to the text it is about and lets a reviewer
    // take a mistaken row out of the evidence. A pipeline that reads only
    // `trusted` would still count both.
    meta: { asset_id: o.asset_id, asset_version: o.asset_version ?? null, content_hash: o.content_hash ?? null, state: o.state, corrected_reason: o.corrected_reason ?? null, relation: o.relation, consumer_user_id: o.consumer_user_id, run_id: o.run_id ?? null, call_id: o.call_id ?? null, trusted: o.trusted === true, retracted_at: o.retracted_at ?? null, recorded_at: o.created_at ?? null,
      // Core's own verdict, carried verbatim; the checker reads `bound`
      // rather than comparing versions and hashes a second time.
      gate_validity: o.gate_validity ?? null, bound: o.gate_validity?.bound ?? null,
      // Whether this row is still the result of its call. A superseded row
      // is history: it may be quoted, but nothing rests on it (2026-09-08f).
      final: o.gate_validity ? o.gate_validity.final !== false : null, superseded_by: o.gate_validity?.superseded_by ?? null,
      asset_tokens: tk.tokens, asset_tokens_from: tk.from } };
}
export function callRecord(r) {
  // One row, one id: the same request body from two sessions (or twice in
  // one) is two calls. The body hash alone collided across them.
  const h = createHash("sha1").update(`${r.session_key ?? ""}|${r.timestamp ?? ""}|${r.kind ?? ""}|${r.request_body_hash ?? r.request_body ?? ""}`).digest("hex").slice(0, 16);
  // The export carries the request body JSON-escaped (\/ for /, \" for ");
  // the record shows it as the model wrote it, so a quote of the URL matches.
  const raw = typeof r.request_body === "string" ? r.request_body : JSON.stringify(r.request_body ?? {});
  const body = raw.replace(/\\\//g, "/").replace(/\\"/g, '"').replace(/\\n/g, " ").slice(0, 600);
  const at = r.timestamp ? new Date(String(r.timestamp).replace(" ", "T") + (String(r.timestamp).endsWith("Z") ? "" : "Z")).toISOString() : null;
  return { record_id: `call:${h}`, kind: "call", evidence_class: "proxy_observed", text: `${r.timestamp} ${r.kind} ${r.executed_endpoint || r.initiated_tool || ""} status=${r.upstream_status ?? ""} ${r.reject_reason ? `reject=${r.reject_reason} ` : ""}${body}`, at,
    meta: { session_key: r.session_key ?? null, kind: r.kind ?? null, endpoint: r.executed_endpoint ?? null, upstream_status: r.upstream_status ?? null, reject_reason: r.reject_reason || null, observed_by: "proxy tool_call_logs", body_hash: r.request_body_hash ?? null, request_body: raw.slice(0, 2000) } };
}

/**
 * Tie each bridge_call (a result) to the model_intent (a command) it
 * answered: same session, the call within 30 s after the intent, the
 * intent's command naming the call's endpoint, and a value from the call's
 * body (skill_name, skill_id, query) present in the command.
 *
 * The match must be unique from BOTH sides (2026-09-08d). Checking only
 * that a result had one candidate command let two results claim the same
 * command — a duplicated service record, a retry, or the other result's own
 * command missing from the export — and the second silently overwrote the
 * first, so both were reported as paired. Now: exactly one candidate on
 * each side → paired; anything else → ambiguous (the result is real, but
 * which command it answered is not known); no candidate → unpaired. Only a
 * paired call lets an execution result stand on the command's quote; an
 * intent with no paired call carries intent only.
 */
export function pairCalls(records) {
  const calls = records.filter((r) => r.kind === "call");
  const intents = calls.filter((r) => r.meta.kind === "model_intent");
  const results = calls.filter((r) => r.meta.kind === "bridge_call");
  const valuesOf = (body) => { try { const b = JSON.parse(body || "{}"); return ["skill_name", "skill_id", "query"].map((k) => b?.[k]).filter((v) => typeof v === "string" && v.length >= 3); } catch { return []; } };
  // The whole candidate graph first: who could answer whom, both ways.
  const candidatesOf = new Map();   // result id → intent records
  const claimedBy = new Map();      // intent id → result records
  for (const res of results) {
    const t = Date.parse(res.at);
    const cands = intents.filter((it) => it.meta.session_key === res.meta.session_key && it.meta.session_key
      && Date.parse(it.at) <= t && t - Date.parse(it.at) <= 30_000
      && (!res.meta.endpoint || (it.meta.request_body || "").includes(`/skill/${res.meta.endpoint}`))
      && valuesOf(res.meta.request_body).some((v) => (it.meta.request_body || "").includes(v)));
    candidatesOf.set(res.record_id, cands);
    for (const c of cands) { if (!claimedBy.has(c.record_id)) claimedBy.set(c.record_id, []); claimedBy.get(c.record_id).push(res); }
  }
  const ambiguous = (res, cands, why) => {
    res.meta.pairing = "ambiguous";
    res.meta.pairing_reason = why;
    res.meta.candidate_intents = cands.map((c) => c.record_id);
    for (const c of cands) { c.meta.pairing = "ambiguous"; c.meta.pairing_reason = why; (c.meta.candidate_calls ??= []).push(res.record_id); }
  };
  for (const res of results) {
    const cands = candidatesOf.get(res.record_id) ?? [];
    if (cands.length === 0) { res.meta.pairing = "unpaired"; continue; }
    if (cands.length > 1) { ambiguous(res, cands, `${cands.length} commands could have produced this result`); continue; }
    const it = cands[0];
    const rivals = claimedBy.get(it.record_id) ?? [];
    if (rivals.length > 1) { ambiguous(res, [it], `${rivals.length} results match this one command; which answered it is not known`); continue; }
    res.meta.paired_intent = it.record_id; res.meta.pairing = "paired";
    it.meta.paired_call = res.record_id; it.meta.pairing = "paired";
  }
  for (const it of intents) if (!it.meta.pairing) it.meta.pairing = "no_result";
  return {
    paired: results.filter((r) => r.meta.pairing === "paired").length,
    ambiguous: results.filter((r) => r.meta.pairing === "ambiguous").length,
    unpaired: results.filter((r) => r.meta.pairing === "unpaired").length,
    intents_without_result: intents.filter((r) => r.meta.pairing === "no_result").length,
    intents_ambiguous: intents.filter((r) => r.meta.pairing === "ambiguous").length,
  };
}

/** Discriminative tokens of an asset: from a tokens file when it names the asset, else what its body carries. */
/**
 * The two outcome queries a pack needs, both as the author's own key:
 * results on the author's assets (someone else's use — the others_on_assets
 * ledger, or the author's own use of their own asset), and results the
 * author produced AS A CONSUMER on other people's assets — the own_business
 * ledger the checker keys on `consumer_user_id`. Until 2026-09-11 only the
 * first was fetched, so a consumer's validated results on another author's
 * asset never reached their own pack and their competence read `unknown`
 * with two harness-verified successes on file.
 */
export function outcomeQueries(author, cut) {
  return [
    { team_id: author.team_id, owner_user_id: author.user_id, occurred_before: cut },
    { team_id: author.team_id, consumer_user_id: author.user_id, occurred_before: cut },
  ];
}
/** Rows from several queries, one per outcome id; the first copy wins. */
export function mergeOutcomeRows(...lists) {
  const seen = new Map();
  for (const l of lists) for (const o of l ?? []) if (o?.id != null && !seen.has(o.id)) seen.set(o.id, o);
  return [...seen.values()];
}
export function assetTokens(assetId, content, tokensFiles = []) {
  // The body's own exact values first (host:port, ids); a tokens file only
  // when the body carries none — its entries may be host-only, and a host
  // alone does not name a host:port.
  const fromBody = bodyTokens(content);
  if (fromBody.length) return { tokens: fromBody, from: "asset body" };
  for (const f of tokensFiles) {
    if (!existsSync(f)) continue;
    try { const t = JSON.parse(readFileSync(f, "utf8")); const e = t?.[assetId]; if (e?.tokens?.length) return { tokens: e.tokens.map(String), from: f }; } catch { /* next */ }
  }
  return { tokens: [], from: null };
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

/**
 * 围绕被评估版本收集到的**相关证据**,以及一句必须说清的话:生产来源未证实。
 *
 * 2026-09-12 第二人复核:原来这里叫 `complete`(版本 → 写入者 → 会话 → 操作 → 结果,无断点),
 * 但实现只是分别找出"提到资产名或判别值的会话""提到它的操作""同一 asset id 的结果",三个集合
 * 各自非空就标完整——**相邻记录之间的关系一次都没有验证过**。真实的 A 包里,链头是在读两条
 * 已经存在的 skill,链尾是另外两次消费者运行的结果:它能证明相关的使用历史,证明不了这一版由
 * 这段会话产生。所以字段改名、去掉 `complete`,写入者(版本行上的 user_id)作为**事实**保留,
 * 生产来源另记 `production_link: "unproven"`,空集合仍按缺口列出。
 */
export function chainFacts({ assetVersion, contentHash = null, writer = null, assetOwnerUserId = null, ownerAgentId = null, sessions = [], naming = [], ops = [], results = [], callsExported = true } = {}) {
  const gaps = [];
  if (!writer) gaps.push("写入者(producer):这一版没有版本行,谁写的未知");
  if (!sessions.length) gaps.push(naming.length ? `来源会话:${naming.length} 条 L0 消息提到了资产或判别值,但都没带 session id` : "来源会话:截止时刻前没有 L0 消息提到该资产或它的判别值");
  if (!ops.length) gaps.push(callsExported ? "操作:没有任何 proxy 观察到的调用带着该资产的判别值" : "操作:没有提供 proxy 调用导出,因而没有可观察的操作");
  if (!results.length) gaps.push("结果:截止时刻前该资产上没有受信结果");
  return {
    asset_version: assetVersion, content_hash: contentHash,
    what_this_is: "相关证据汇集(related evidence collected around this version),不是生产链",
    producer: {
      asset_owner_user_id: assetOwnerUserId,
      owner_agent_id: ownerAgentId,
      wrote_this_version: writer,
      wrote_this_version_from: writer ? `skill store version row (skills.user_id, returned as owner_user_id by /v3/skill/versions) for v${assetVersion}` : null,
    },
    writer_known: !!writer,
    production_link: "unproven",
    production_note: "各集合只按「提到资产名或判别值」「同一 asset id」筛出,相邻记录之间的关系未验证:这些证据能说明相关的使用历史,不能证明该版本由这些会话产生",
    source_sessions: sessions,
    naming_messages: naming.map((r) => r.record_id ?? r),
    operations: ops.map((r) => (r.record_id ? { record_id: r.record_id, at: r.at, status: r.meta?.upstream_status, kind: r.meta?.kind } : r)),
    results: results.map((r) => (r.record_id ? { record_id: r.record_id, state: r.meta?.state, corrected_reason: r.meta?.corrected_reason, at: r.at } : r)),
    collected: { source_sessions: sessions.length, naming_messages: naming.length, operations: ops.length, results: results.length },
    gaps,
  };
}

export async function buildPack({ author, domain, keywords = [], assetId = null, callsFile = null, tokensFiles = [], maxL0 = 400, cutoff = null }) {
  const cut = cutoff ? new Date(cutoff).toISOString() : new Date().toISOString();
  const ids = { team_id: author.team_id, user_id: author.user_id, agent_id: author.agent_id };
  const records = new Map();
  // skill_id → its version rows, kept so the chain can say who wrote the
  // version under assessment rather than reporting the operator as unknown.
  const skillVersions = new Map();
  const excluded = { after_cutoff: 0, modified_after_cutoff: 0, no_timestamp: 0, untrusted_outcomes: 0, retracted_outcomes: 0, persona_after_cutoff: false, other_users_calls: 0, skills_created_after_cutoff: 0 };
  const add = (r) => {
    if (!r.text || !r.text.trim()) return;
    if (!r.at) { excluded.no_timestamp += 1; return; }
    if (r.at > cut) {
      // A row created before the cutoff but modified after it is the
      // modified text; the earlier text is not kept anywhere.
      if (r.meta?.created_at && r.meta.created_at <= cut) excluded.modified_after_cutoff += 1; else { excluded.after_cutoff += 1; if (process.env.PACK_DEBUG) console.error(`  [after_cutoff] ${r.kind} ${r.record_id} at=${r.at}`); }
      return;
    }
    // Merge, do not overwrite (2026-09-08g). The same message arrives twice —
    // once from `conversation/query`, which returns `session_id`, and once
    // from `conversation/search`, which returns only content/id/role/score/
    // timestamp. A plain `set` let the poorer copy replace the richer one, so
    // every message the search found lost its session id and the chain
    // reported "carries no session id" about data the product had returned.
    const prev = records.get(r.record_id);
    records.set(r.record_id, prev ? mergeRecord(prev, r) : r);
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
  // Skills the author's agent owns — the version that existed at the cutoff,
  // not the head (management read: candidates included). Bodies are kept
  // per version so an outcome on an earlier version gets that version's
  // tokens, not the current text's.
  const skillBodies = new Map(); // `${id}@${version}` → content
  const bodyAt = async (skillId, version) => {
    const key = `${skillId}@${version}`;
    if (skillBodies.has(key)) return skillBodies.get(key);
    let content = null;
    try { const g = await post("/v3/skill/get", { team_id: author.team_id, agent_id: author.agent_id, user_id: author.user_id, skill_id: skillId, version, include_content: true }, author.key); content = g.content ?? ""; } catch { content = null; }
    skillBodies.set(key, content);
    return content;
  };
  try {
    const d = await post("/v3/skill/list", { team_id: author.team_id, agent_id: author.agent_id, user_id: author.user_id, filters: { owner_agent_id: author.agent_id }, pagination: { limit: 100, offset: 0 } }, author.key);
    const items = d.items ?? [];
    for (const s of items) {
      let versions = [];
      try { const v = await post("/v3/skill/versions", { team_id: author.team_id, agent_id: author.agent_id, user_id: author.user_id, skill_id: s.skill_id, pagination: { limit: 100 } }, author.key); versions = v.items ?? []; } catch { versions = [s]; }
      skillVersions.set(s.skill_id, versions);
      const atCut = versions.filter((v) => v.created_at_ms && new Date(v.created_at_ms).toISOString() <= cut).sort((a, b) => b.version - a.version)[0];
      if (!atCut) { excluded.skills_created_after_cutoff += 1; continue; }
      const content = (await bodyAt(s.skill_id, atCut.version)) ?? "";
      add(skillRecord({ ...atCut, name: atCut.name ?? s.name, description: atCut.description ?? s.description, head_version: s.version, version_at_cutoff: atCut.version }, content));
    }
    sources.skills = { total: items.length, note: "each skill as the version that existed at the cutoff" };
  } catch (e) { sources.skills = { error: String(e.message) }; }
  // Outcomes on the author's assets — trusted rows only
  try {
    // The cutoff goes to Core, not just applied here: `gate_validity.final`
    // means "the last word on this call", and Core has to answer that for the
    // SAME window the pack is built for. Without it a row that is final as of
    // the cutoff comes back marked superseded by a row the pack excludes
    // (2026-09-08h).
    const [onAssets, asConsumer] = await Promise.all(outcomeQueries(author, cut).map((q) => pages("/v3/meta/asset/outcome/list", q, author.key, "items", 100, 2000)));
    const rows = mergeOutcomeRows(onAssets, asConsumer);
    sources.outcome_queries = { on_authors_assets: onAssets.length, author_as_consumer: asConsumer.length, merged: rows.length };
    // Core decides what the gate may read and stamps it on every row
    // (`gate_validity`, from `outcomeValidity` — the same function the
    // decision uses). The pack does not re-derive it: a second copy of the
    // rule here is a copy that drifts (2026-09-08e). The fallback below is
    // for a Core older than the field, and says so in the pack.
    const stamped = rows.every((o) => o.gate_validity);
    const usableOf = (o) => (stamped ? o.gate_validity.usable || (o.gate_validity.trusted && !o.gate_validity.retracted)
      : o.trusted === true && !o.retracted_at);
    // The pack keeps rows the gate trusts and has not had retracted, whatever
    // version they are about — a result on an earlier version is still a
    // result about the author. `bound` travels with the row so the checker
    // can tell a result from a relation without recomputing anything.
    const trusted = rows.filter(usableOf);
    excluded.untrusted_outcomes = rows.filter((o) => (stamped ? !o.gate_validity.trusted : o.trusted !== true)).length;
    excluded.retracted_outcomes = rows.filter((o) => (stamped ? o.gate_validity.trusted && o.gate_validity.retracted : o.trusted === true && o.retracted_at)).length;
    sources.validity_from = stamped ? "core: gate_validity on every row" : "local fallback: Core did not stamp gate_validity (trusted + not retracted only)";
    // Tokens of the outcome's own asset AT THAT VERSION (the author owns the
    // asset, so the body is readable); no version → no tokens.
    const bodies = new Map();
    for (const o of trusted) {
      const key = `${o.asset_id}@${o.asset_version}`;
      if (o.asset_version != null && !bodies.has(key)) bodies.set(key, await bodyAt(o.asset_id, o.asset_version));
    }
    const tokensOf = (id, version) => {
      const body = version != null ? bodies.get(`${id}@${version}`) : null;
      if (body == null) return { tokens: [], from: version == null ? "no version on the outcome" : "body of that version not readable" };
      return { tokens: bodyTokens(body), from: `body of ${id} v${version}` };
    };
    trusted.forEach((o) => add(outcomeRecord(o, tokensOf)));
    sources.outcomes = { total: rows.length, trusted: trusted.length, retracted: excluded.retracted_outcomes, validity_from: sources.validity_from, note: "kept and left out by Core's own verdict on each row (gate_validity): untrusted rows and rows a reviewer retracted are counted and left out — exactly the rows the gate does not read" };
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

  // Tie results to the commands they answered.
  const pairing = pairCalls([...records.values()]);

  // The asset under assessment, its tokens, and the chain.
  let asset = null; let chain = null;
  if (assetId) {
    try {
      const a = await post("/v3/meta/asset/get", { asset_id: assetId }, author.key);
      const body = (await bodyAt(assetId, a.version)) ?? "";
      const tk = assetTokens(assetId, body, tokensFiles);
      asset = { asset_id: a.asset_id, name: a.name, version: a.version, content_hash: a.content_hash ?? null, owner_user_id: a.owner_user_id, status: a.status, tokens: tk.tokens, tokens_from: tk.from };
      const list = [...records.values()];
      const mentions = (t) => asset.tokens.some((tok) => t.includes(tok)) || (a.name && t.includes(a.name));
      const naming = list.filter((r) => r.kind === "l0" && mentions(r.text));
      const sessions = [...new Set(naming.map((r) => r.meta.session_id).filter(Boolean))];
      const ops = list.filter((r) => r.kind === "call" && mentions(r.text));
      const results = list.filter((r) => r.kind === "outcome" && r.meta.asset_id === assetId);
      // Who wrote THIS version. The skill store keeps one row per version
      // with the caller's user_id on it, and `/v3/skill/versions` returns it
      // as `owner_user_id` — a misleading name (it is the writer of that
      // version, not an owner), which is why this was read as unavailable
      // until 2026-09-08g and reported as a break for weeks.
      let rows = skillVersions.get(assetId);
      if (!rows) {
        // The assessed asset is normally in the author's own skill list; fetch
        // it directly when it is not, rather than reporting a break.
        try { const v = await post("/v3/skill/versions", { team_id: author.team_id, agent_id: author.agent_id, user_id: author.user_id, skill_id: assetId, pagination: { limit: 100 } }, author.key); rows = v.items ?? []; } catch { rows = []; }
      }
      const versionRow = rows.find((v) => v.version === a.version) ?? null;
      const writer = versionRow?.owner_user_id ?? null;
      const breaks = [];
      chain = chainFacts({
        assetVersion: a.version, contentHash: a.content_hash ?? null, writer,
        assetOwnerUserId: a.owner_user_id, ownerAgentId: author.agent_id,
        sessions, naming, ops, results,
        callsExported: !!sources.calls?.total,
      });
    } catch (e) { asset = { asset_id: assetId, error: String(e.message) }; }
  }

  const list = [...records.values()].sort((a, b) => String(a.at ?? "").localeCompare(String(b.at ?? "")));
  const body = JSON.stringify(list);
  return {
    schema: "author-evidence-pack-v2",
    built_at: new Date().toISOString(),
    evidence_cutoff: cut,
    author: { letter: author.letter, user_id: author.user_id, agent_id: author.agent_id, team_id: author.team_id },
    domain, keywords, asset_id: assetId, asset, chain, pairing,
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
  if (pack.chain) console.log(`  related evidence: writer ${pack.chain.writer_known ? pack.chain.producer.wrote_this_version : "unknown"}; sessions ${pack.chain.collected.source_sessions}, operations ${pack.chain.collected.operations}, results ${pack.chain.collected.results}; production link ${pack.chain.production_link}${pack.chain.gaps.length ? ` — ${pack.chain.gaps.length} gap(s)` : ""}`);
  for (const [k, v] of Object.entries(pack.sources)) if (v.error) console.log(`  [warn] ${k}: ${v.error}`);
}
