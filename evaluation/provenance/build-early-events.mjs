/**
 * Early lifecycle events — recalled / selected / injected.
 *
 * The task specification names six states. Attribution previously started at
 * `fetched`, so the three that precede it had nowhere to be recorded: there was
 * no way to say "the asset was offered and ignored" as distinct from "the asset
 * was never offered". Those are different failures of a team asset system and
 * only one of them is the asset's fault.
 *
 * Each state is proved from its own source. None is inferred from another.
 *
 *   recalled   a retrieval operation returned this asset as a candidate.
 *              Two paths, because there are two retrieval systems:
 *                injector  — `listListing` hits, read from the candidate log
 *                            (skill-injector.ts:276 prints only `hits=<count>`,
 *                            which cannot be traced back to an asset; the
 *                            sidecar log records skill_id + version per hit)
 *                bridge    — a `skill/search` or `skill/list` response listing,
 *                            read out of the capture
 *
 *   selected   the asset survived a narrowing step. This is written ONLY where
 *              a narrowing step is observable, which means: the candidate log
 *              gives the input set and the rendered block gives the output set.
 *              `hits` is not copied forward into selected — the two are
 *              separately sourced. The narrowing is real, not bookkeeping:
 *              session-init `<available_skills>` caps at 20 entries
 *              (core-client.ts:297), so hits can exceed what is rendered.
 *
 *              On the bridge-search path there is NO selection step — the
 *              service returns a list and the model's next move is a fetch —
 *              so `selected` is never written for it.
 *
 *   injected   the asset reached the model. Also two paths:
 *                system prompt — an entry inside the real `<available_skills>`
 *                                block of a captured request
 *                tool result   — a listing carried in `messages[]` of a
 *                                captured request, which is what "the model
 *                                received it" means on the bridge path
 *
 * Why the bridge path cannot be skipped: `<available_skills>` is owner-filtered
 * (skill-injector.ts:2 — "skills owned by the current agent"). A consumer
 * identity that owns nothing gets an empty block, and every team asset it sees
 * arrives through `skill_search` as a tool result. Reading only the system
 * prompt would report "nothing was recalled" for exactly the cross-person case
 * this project exists to measure.
 *
 * The governing rule, applied throughout: a state that cannot be evidenced is
 * not written. A missing event means "not observed", never "did not happen",
 * and the summary reports both counts so the difference stays visible.
 *
 * Usage:
 *   node evaluation/provenance/build-early-events.mjs \
 *     evaluation/provenance/artifacts/asset-pool-snapshot.json \
 *     evaluation/gate0/artifacts/tool-call-logs.jsonl \
 *     <capture.jsonl ...> [--candidates=<candidate-log.jsonl>]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { eventId, classifyRelation, normalizeSessionKey, parseJsonl, requestPayloadOf } from "./build-events.mjs";

// ── block extraction ──────────────────────────────────────────────

/**
 * Pull out every occurrence of a line-anchored `<tag> … </tag>` block.
 *
 * The line anchor is load-bearing, not tidiness. In a real captured system
 * prompt the literal string `<available_skills>` occurs three times: twice
 * inside `<skill_tools>` prose telling the model where to look
 * ("skill_name 用 <available_skills> 里 …"), and once as the actual block. A
 * naive `<tag>(.*?)</tag>` starts at the first mention and swallows the whole
 * `<skill_tools>` body, so the parsed "skill list" is a paragraph of English
 * instructions. Injected blocks are always emitted on their own line; prose
 * mentions are always mid-line.
 *
 * This is the same failure shape as the three false positives the fetch judge
 * fell for: the text looks related.
 */
export function extractBlocks(text, tag) {
  const out = [];
  const re = new RegExp(`(?:^|\\n)<${tag}>\\n([\\s\\S]*?)\\n</${tag}>(?=\\n|$)`, "g");
  let m;
  while ((m = re.exec(String(text ?? ""))) !== null) out.push(m[1]);
  return out;
}

/**
 * Parse the `- name: description` lines of an `<available_skills>` listing.
 *
 * The block carries names only — no ids and no versions (verified against a
 * real capture). Resolution to an asset id therefore goes through the frozen
 * pool snapshot, and a name the snapshot does not know stays unresolved rather
 * than being invented.
 */
export function parseAvailableSkills(body) {
  const names = [];
  for (const line of String(body ?? "").split("\n")) {
    const m = /^-\s+([A-Za-z0-9][A-Za-z0-9._-]*):\s*\S/.exec(line.trim());
    if (m) names.push(m[1]);
  }
  return names;
}

// ── tool-result listings ──────────────────────────────────────────

/** Every tool result in a captured request, with the message index it sat at. */
function toolResults(body) {
  const out = [];
  const msgs = Array.isArray(body?.messages) ? body.messages : [];
  msgs.forEach((message, index) => {
    if (message?.role === "tool") {
      const c = message.content;
      out.push({ index, text: typeof c === "string" ? c : JSON.stringify(c ?? "") });
    }
    const blocks = Array.isArray(message?.content) ? message.content : [];
    for (const block of blocks) {
      if (block?.type !== "tool_result") continue;
      const c = block.content;
      out.push({ index, text: typeof c === "string" ? c : JSON.stringify(c ?? "") });
    }
  });
  return out;
}

/**
 * Split a Bash tool result into the command that was issued and the output it
 * produced.
 *
 * These must not be scanned as one blob. A tool result echoes the command
 * before its output, so a call that timed out after 75 s with empty stdout
 * still contains the bridge URL and the query — matching the whole blob reads
 * the *request* as if it were the response. The endpoint is read from the
 * command (that is what the command is for) and the payload only from stdout.
 */
export function splitCommandAndOutput(text) {
  const s = String(text ?? "");
  const i = s.search(/(^|\n)Stdout:/);
  if (i < 0) return { command: s, output: "" };
  const nl = s.indexOf("Stdout:", i);
  return { command: s.slice(0, i), output: s.slice(nl + "Stdout:".length) };
}

/** Which retrieval endpoint the command hit, or "" when it is not one. */
export function listingEndpoint(command) {
  const m = /https?:\/\/[^\s'"]*\/(skill|memory)-bridge\/v3\/[a-z]+\/([a-z/-]+)/.exec(String(command ?? ""));
  if (!m) return "";
  const action = m[2].replace(/\/+$/, "");
  return /^(search|list|listing)$/.test(action) ? `${m[1]}:${action}` : "";
}

/** Balanced-brace scan for the first JSON object in a blob of output text. */
function firstJsonObject(text) {
  const s = String(text ?? "");
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i += 1) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

/**
 * Candidate listings returned by a retrieval endpoint, read out of the capture.
 * Each item keeps the id and version the service reported, so the candidate set
 * is traceable to specific assets rather than to a count.
 */
export function extractBridgeListings(captureEvents) {
  const found = [];
  for (const event of captureEvents) {
    if (event?.event !== "http.request") continue;
    const body = event?.body?.json;
    if (!body) continue;
    const sessionKey = normalizeSessionKey(
      event?.headers?.["x-conversation-id"] ?? event?.headers?.["X-Conversation-Id"] ?? "",
    );
    for (const { index, text } of toolResults(body)) {
      const { command, output } = splitCommandAndOutput(text);
      const endpoint = listingEndpoint(command);
      if (!endpoint) continue;
      const envelope = firstJsonObject(output);
      const items = envelope?.data?.items;
      if (!Array.isArray(items)) continue;
      // The query the model sent, and each item's rank and score in the reply:
      // the retrieval system's own relevance judgement, kept so a receipt can
      // say why an asset was offered without inventing a reason.
      let query = null;
      try {
        const payload = JSON.parse(requestPayloadOf(command) || "{}");
        if (typeof payload?.query === "string") query = payload.query;
      } catch { /* not JSON; no query to record */ }
      found.push({
        sessionKey,
        endpoint,
        query,
        requestId: String(event.requestId ?? ""),
        timestamp: String(event.timestamp ?? ""),
        messageIndex: index,
        items: items.map((it, i) => ({
          asset_id: String(it?.skill_id ?? it?.wiki_id ?? it?.id ?? ""),
          name: String(it?.name ?? ""),
          version: it?.version ?? null,
          owner_user_id: String(it?.owner_user_id ?? it?.user_id ?? ""),
          owner_agent_id: String(it?.owner_agent_id ?? it?.agent_id ?? ""),
          rank: i + 1,
          score: typeof it?.score === "number" ? it.score : (it?.score != null && !Number.isNaN(Number(it.score)) ? Number(it.score) : null),
          description: typeof it?.description === "string" ? it.description : null,
        })).filter((it) => it.asset_id),
      });
    }
  }
  return found;
}

/** `<available_skills>` entries per captured request. */
export function extractInjectedSkillNames(captureEvents) {
  const found = [];
  for (const event of captureEvents) {
    if (event?.event !== "http.request") continue;
    const msgs = event?.body?.json?.messages;
    if (!Array.isArray(msgs) || msgs.length === 0) continue;
    const first = msgs[0];
    if (first?.role !== "system") continue;
    const c = first.content;
    const text = typeof c === "string" ? c : JSON.stringify(c ?? "");
    const names = extractBlocks(text, "available_skills").flatMap(parseAvailableSkills);
    if (names.length === 0) continue;
    found.push({
      sessionKey: normalizeSessionKey(
        event?.headers?.["x-conversation-id"] ?? event?.headers?.["X-Conversation-Id"] ?? "",
      ),
      requestId: String(event.requestId ?? ""),
      timestamp: String(event.timestamp ?? ""),
      names,
    });
  }
  return found;
}

// ── assembly ──────────────────────────────────────────────────────

/** Consumer identity per session, taken from service-side rows. */
function actorsBySession(toolCallRows) {
  const actors = new Map();
  for (const row of toolCallRows ?? []) {
    if (row?.kind !== "bridge_call") continue;
    const key = normalizeSessionKey(row.session_key);
    if (actors.has(key)) continue;
    actors.set(key, {
      user_id: String(row.user_id ?? ""),
      agent_id: String(row.agent_id ?? ""),
    });
  }
  return actors;
}

const NO_ACTOR = { user_id: "", agent_id: "" };

/**
 * Combine the sources into early lifecycle events.
 *
 * `candidateLog` is optional. Without it the injector path can show only that
 * a block was injected, never what it was narrowed from — so `recalled` and
 * `selected` are simply absent for that path. They are not back-filled from the
 * block, because "these two were injected" does not establish "these two were
 * the candidates".
 */
export function buildEarlyEvents({ snapshot, toolCallRows = [], captureEvents = [], candidateLog = [] }) {
  const assets = snapshot?.assets ?? [];
  const poolSnapshotAt = snapshot?.pool_snapshot_at ?? "";
  const byId = new Map(assets.map((a) => [a.asset_id, a]));
  const byName = new Map(assets.filter((a) => a.name).map((a) => [a.name, a]));
  const actors = actorsBySession(toolCallRows);

  // One record per (session, asset, state). A state either happened in a
  // session or it did not; the same asset sitting in context on five
  // consecutive turns is one `injected`, not five. The turn count is kept as
  // evidence detail rather than as extra events, because inflating the event
  // stream would make the injection cost look like repeated lifecycle progress.
  //
  // Multiple proofs merge onto one record for the same reason: an asset that
  // appears both in the system prompt and in a tool result was injected once,
  // by two channels, and both references belong on that single event.
  const records = new Map();
  const unresolved = new Map();
  const ownerMismatches = [];
  const miss = (kind, key) => unresolved.set(`${kind}:${key}`, (unresolved.get(`${kind}:${key}`) ?? 0) + 1);

  // The version is part of an event's identity, not a decoration on it.
  //
  // Two things follow. The merge key carries it, so two versions of one asset
  // seen in one session stay two events rather than collapsing into whichever
  // was noticed first. And it is never taken from the snapshot: the snapshot
  // says what the pool holds *now*, and an event says what the model saw
  // *then*. Copying one into the other produced chains reading recalled v2 →
  // selected v2 → injected v3, where the last step was the snapshot leaking in
  // through a path that stated no version at all.
  const versionKey = (v) => (v == null ? "?" : String(v));
  const note = ({ state, asset, sessionKey, occurredAt, observation, proofRef, version = null, metadata = null }) => {
    const key = `${sessionKey}|${asset.asset_id}|${state}|${versionKey(version)}`;
    let rec = records.get(key);
    if (!rec) {
      rec = {
        key, state, asset, sessionKey,
        occurredAt: occurredAt || "",
        observations: new Set(),
        refs: new Map(), // ref -> {kind, ref, detail, turns}
        version,
        versionStated: version != null,
        metadata: null,
      };
      records.set(key, rec);
    }
    // First source to state it wins: the earliest listing is the one that
    // offered the asset; a later turn re-listing it is the same recall.
    if (metadata && !rec.metadata) rec.metadata = metadata;
    rec.observations.add(observation);
    if (occurredAt && (!rec.occurredAt || occurredAt < rec.occurredAt)) rec.occurredAt = occurredAt;

    const existing = rec.refs.get(proofRef.ref);
    if (existing) existing.turns += 1;
    else rec.refs.set(proofRef.ref, { ...proofRef, turns: 1 });
    return rec;
  };

  // ── injector path: recalled, then selected ──────────────────────
  for (const entry of candidateLog) {
    const sessionKey = normalizeSessionKey(entry?.session_key ?? "");
    const hits = Array.isArray(entry?.hits) ? entry.hits : [];
    // The rendered block is the output of the narrowing step. Without it the
    // step is unobservable and no `selected` may be written.
    const rendered = typeof entry?.listing === "string"
      ? new Set(parseAvailableSkills(extractBlocks(entry.listing, "available_skills").join("\n") || entry.listing))
      : null;

    for (const hit of hits) {
      const asset = byId.get(String(hit?.skill_id ?? "")) ?? byName.get(String(hit?.name ?? ""));
      if (!asset) { miss("candidate", String(hit?.skill_id ?? hit?.name ?? "?")); continue; }
      const ref = `candidate-log:${entry.request_id ?? entry.timestamp ?? ""}:${asset.asset_id}`;
      note({
        state: "recalled", asset, sessionKey,
        occurredAt: String(entry?.timestamp ?? ""),
        observation: "bridge_only",
        version: hit?.version ?? null,
        proofRef: {
          kind: "candidate_listing", ref,
          detail: `listing mode=${entry?.mode ?? "?"} returned ${hits.length} candidate(s)`,
        },
      });

      if (!rendered) continue;
      if (!rendered.has(asset.name)) continue; // dropped by the narrowing step
      note({
        state: "selected", asset, sessionKey,
        occurredAt: String(entry?.timestamp ?? ""),
        observation: "bridge_only",
        version: hit?.version ?? null,
        proofRef: {
          kind: "candidate_listing", ref,
          detail: `survived narrowing: ${rendered.size} of ${hits.length} candidate(s) rendered`,
        },
      });
    }
  }

  // ── bridge path: recalled, then injected ────────────────────────
  for (const listing of extractBridgeListings(captureEvents)) {
    for (const item of listing.items) {
      const asset = byId.get(item.asset_id);
      if (!asset) { miss("listing", item.asset_id); continue; }
      if (item.owner_user_id && asset.producer_user_id && item.owner_user_id !== asset.producer_user_id) {
        ownerMismatches.push({ asset_id: item.asset_id, snapshot: asset.producer_user_id, response: item.owner_user_id });
      }
      const ref = `capture:${listing.endpoint}:${item.asset_id}`;
      note({
        state: "recalled", asset, sessionKey: listing.sessionKey,
        occurredAt: listing.timestamp, observation: "wire_only", version: item.version,
        proofRef: {
          kind: "bridge_response", ref,
          detail: `${listing.endpoint} returned ${listing.items.length} candidate(s), this one at rank ${item.rank}`,
        },
        // The retrieval system's own relevance judgement, as returned: what the
        // model asked for, where this asset ranked, and its score. A receipt
        // can say "why offered" from this without inventing a reason.
        metadata: {
          relevance: {
            query: listing.query, rank: item.rank, total: listing.items.length,
            score: item.score, description: item.description,
          },
        },
      });
      // The listing sits in messages[] of a request that went to the model, so
      // it reached the context. That is a separate claim from "the retrieval
      // system produced it", proved by a separate reference.
      note({
        state: "injected", asset, sessionKey: listing.sessionKey,
        occurredAt: listing.timestamp, observation: "wire_only", version: item.version,
        proofRef: {
          kind: "session_message", ref: `capture:tool_result:${item.asset_id}`,
          detail: "carried in a tool result inside the request the model received",
        },
      });
    }
  }

  // ── injector path: injected ─────────────────────────────────────
  for (const block of extractInjectedSkillNames(captureEvents)) {
    for (const name of block.names) {
      const asset = byName.get(name);
      if (!asset) { miss("available_skills", name); continue; }
      note({
        state: "injected", asset, sessionKey: block.sessionKey,
        occurredAt: block.timestamp, observation: "wire_only",
        proofRef: {
          kind: "injected_block", ref: `capture:system:<available_skills>:${name}`,
          detail: "entry inside the rendered block of the captured system prompt",
        },
      });
    }
  }

  // ── resolve versions no source stated ────────────────────────────
  //
  // `<available_skills>` lists names only — no ids and no versions — so the
  // injected-block path genuinely cannot know which revision it rendered. When
  // some other source saw exactly one version of that asset in that session,
  // adopting it is sound and the event says it was inferred. When two versions
  // were in play, there is no honest answer: the version stays null and the
  // ambiguity is reported, because guessing here is precisely how a run gets
  // attributed to a revision the model never saw.
  const versionsSeen = new Map(); // "session|asset" -> Set<version>
  for (const rec of records.values()) {
    if (rec.version == null) continue;
    const k = `${rec.sessionKey}|${rec.asset.asset_id}`;
    if (!versionsSeen.has(k)) versionsSeen.set(k, new Set());
    versionsSeen.get(k).add(rec.version);
  }

  const ambiguousVersions = [];
  for (const rec of [...records.values()]) {
    if (rec.version != null) continue;
    const k = `${rec.sessionKey}|${rec.asset.asset_id}`;
    const seen = [...(versionsSeen.get(k) ?? [])];
    if (seen.length !== 1) {
      if (seen.length > 1) {
        ambiguousVersions.push({ session_key: rec.sessionKey, asset_id: rec.asset.asset_id, state: rec.state, versions: seen });
      }
      continue;
    }
    rec.version = seen[0];
    for (const ref of rec.refs.values()) {
      ref.detail = `${ref.detail}; version not stated by this source, taken from the only version of this asset seen in the session (v${seen[0]})`;
    }
    // Re-key, and fold into the versioned record for the same state if one exists.
    records.delete(rec.key);
    const merged = `${rec.sessionKey}|${rec.asset.asset_id}|${rec.state}|${versionKey(rec.version)}`;
    const target = records.get(merged);
    if (!target) { rec.key = merged; records.set(merged, rec); continue; }
    for (const [refKey, ref] of rec.refs) if (!target.refs.has(refKey)) target.refs.set(refKey, ref);
    for (const o of rec.observations) target.observations.add(o);
    if (rec.occurredAt && (!target.occurredAt || rec.occurredAt < target.occurredAt)) target.occurredAt = rec.occurredAt;
  }

  // The pool rolling forward is worth saying out loud: an event about v2 sitting
  // next to a snapshot holding v3 is normal, and silently showing v3 is not.
  // One entry per (asset, version) pair rather than per event: three events
  // about the same revision are one fact about the pool, not three.
  const driftSeen = new Map();
  for (const rec of records.values()) {
    const pooled = rec.asset.version;
    if (rec.version == null || pooled == null || String(rec.version) === String(pooled)) continue;
    driftSeen.set(`${rec.asset.asset_id}|${rec.version}`, {
      asset_id: rec.asset.asset_id, observed: rec.version, in_snapshot: pooled,
    });
  }
  const versionDrift = [...driftSeen.values()];

  // ── materialise, then link injected/selected back to recalled ───
  const NO_ACTOR_LOCAL = NO_ACTOR;
  const ordered = [...records.values()].sort((a, b) =>
    (a.occurredAt || "").localeCompare(b.occurredAt || "") || a.key.localeCompare(b.key));

  const idByKey = new Map();
  const events = ordered.map((rec) => {
    const actor = actors.get(rec.sessionKey) ?? NO_ACTOR_LOCAL;
    const producer = { user_id: rec.asset.producer_user_id, agent_id: rec.asset.producer_agent_id };
    const obs = rec.observations.has("bridge_only") && rec.observations.has("wire_only")
      ? "bridge+wire"
      : [...rec.observations][0];
    const proofRefs = [...rec.refs.values()].map(({ kind, ref, detail, turns }) => ({
      kind, ref,
      detail: turns > 1 ? `${detail}; present in ${turns} captured turn(s)` : detail,
    }));
    const id = eventId([rec.sessionKey, rec.asset.asset_id, rec.state, versionKey(rec.version), rec.occurredAt, obs]);
    idByKey.set(rec.key, id);
    return {
      schema_version: "provenance-v1",
      event_id: id,
      state: rec.state,
      session_key: rec.sessionKey,
      run_id: null,
      task_id: null,
      occurred_at: rec.occurredAt || null,
      asset_id: rec.asset.asset_id,
      asset_type: rec.asset.asset_type,
      asset_name: rec.asset.name,
      // Null when no source stated it and none could be inferred. The snapshot's
      // version is deliberately not used as a fallback.
      asset_version: rec.version ?? null,
      asset_created_at: rec.asset.asset_created_at ?? "",
      pool_snapshot_at: poolSnapshotAt,
      excluded_by_snapshot: Boolean(
        poolSnapshotAt && rec.asset.asset_created_at && rec.asset.asset_created_at > poolSnapshotAt,
      ),
      producer_user_id: producer.user_id,
      producer_agent_id: producer.agent_id,
      actor_user_id: actor.user_id,
      actor_agent_id: actor.agent_id,
      relation: classifyRelation(producer, actor),
      observation: obs,
      evidence_tier: null,
      bridge_source: "",
      executed_endpoint: "",
      upstream_status: 0,
      target_type: null,
      target_ref: null,
      proof_refs: proofRefs,
      corrected_reason: null,
      parent_event_ids: [],
      ...(rec.metadata ? { metadata: rec.metadata } : {}),
    };
  });

  // A later state points at the earlier one for the same asset and session, but
  // only when that earlier state was actually observed. A dangling parent would
  // assert a stage that was never proved.
  //
  // The link is version-matched. Pointing an injected v3 event at a recalled v2
  // event would assert that this revision was the one recalled, which is the
  // same error as writing the wrong version on the event itself — just spread
  // across two records where it is harder to see.
  const PARENT_OF = { selected: "recalled", injected: "selected" };
  for (const e of events) {
    let want = PARENT_OF[e.state];
    while (want) {
      const parent = idByKey.get(`${e.session_key}|${e.asset_id}|${want}|${versionKey(e.asset_version)}`);
      if (parent) { e.parent_event_ids = [parent]; break; }
      want = PARENT_OF[want]; // selected unobserved → fall through to recalled
    }
  }

  return {
    events,
    unresolved: Object.fromEntries(unresolved),
    ownerMismatches,
    ambiguousVersions,
    versionDrift,
  };
}

// ── reporting ─────────────────────────────────────────────────────

export function summarizeEarly({ events, unresolved, ownerMismatches, ambiguousVersions, versionDrift }) {
  const byState = {};
  const byStateAssets = {};
  for (const e of events) {
    byState[e.state] = (byState[e.state] ?? 0) + 1;
    (byStateAssets[e.state] ??= new Set()).add(e.asset_id);
  }
  return {
    total: events.length,
    byState,
    distinctByState: Object.fromEntries(Object.entries(byStateAssets).map(([k, v]) => [k, v.size])),
    unresolved,
    ownerMismatches,
    ambiguousVersions: ambiguousVersions ?? [],
    versionDrift: versionDrift ?? [],
    versionless: events.filter((e) => e.asset_version == null).length,
  };
}

export function renderEarlySummary(s) {
  const order = ["recalled", "selected", "injected"];
  const lines = [
    "# Early lifecycle events",
    "",
    "| state | events | distinct assets | absent means |",
    "|---|---|---|---|",
  ];
  for (const state of order) {
    const n = s.byState[state] ?? 0;
    const d = s.distinctByState[state] ?? 0;
    const meaning = n === 0 ? "**not observed** — no source proved it" : "—";
    lines.push(`| ${state} | ${n} | ${d} | ${meaning} |`);
  }
  lines.push("", `${s.total} event(s) total.`);

  if ((s.byState.selected ?? 0) === 0) {
    lines.push("");
    lines.push("`selected` is empty because no candidate log was supplied. It is deliberately");
    lines.push("**not** back-filled from the injected block: knowing which assets were injected");
    lines.push("does not establish which assets were candidates.");
  }

  const unresolvedTotal = Object.values(s.unresolved).reduce((a, b) => a + b, 0);
  if (unresolvedTotal > 0) {
    lines.push("", `${unresolvedTotal} reference(s) named an asset absent from the frozen snapshot:`);
    for (const [k, v] of Object.entries(s.unresolved).sort()) lines.push(`  - ${k} ×${v}`);
    lines.push("These are reported rather than dropped — an asset the snapshot does not know");
    lines.push("is either created after the freeze or of a type the snapshot does not cover.");
  }
  if ((s.versionless ?? 0) > 0) {
    lines.push("", `${s.versionless} event(s) carry no \`asset_version\`: no source stated one and none`);
    lines.push("could be inferred. The snapshot's version is **not** used as a fallback — it says");
    lines.push("what the pool holds now, not what the model saw then.");
  }
  for (const a of s.ambiguousVersions ?? []) {
    lines.push("", `**Ambiguous version** ${a.asset_id} (${a.state}) in ${a.session_key}: versions ${a.versions.join(", ")} were both seen; left unset.`);
  }
  if ((s.versionDrift ?? []).length > 0) {
    lines.push("", "Pool moved on since these events (normal; recorded so the difference is visible):");
    for (const d of s.versionDrift) lines.push(`  - ${d.asset_id}: event v${d.observed}, snapshot v${d.in_snapshot}`);
  }
  if (s.ownerMismatches.length > 0) {
    lines.push("", "**Owner disagreement between the live response and the frozen snapshot:**");
    for (const m of s.ownerMismatches) lines.push(`  - ${m.asset_id}: snapshot ${m.snapshot}, response ${m.response}`);
  }
  return lines.join("\n");
}

// ── CLI ───────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const candidatesArg = args.find((a) => a.startsWith("--candidates="));
  const positional = args.filter((a) => !a.startsWith("--"));
  const [snapshotPath, toolCallPath, ...capturePaths] = positional;
  if (!snapshotPath || !toolCallPath) {
    console.error("usage: node build-early-events.mjs <snapshot.json> <tool-call-logs.jsonl> [capture.jsonl ...] [--candidates=<log.jsonl>]");
    process.exit(2);
  }

  const candidatePath = candidatesArg?.slice("--candidates=".length);
  const candidateLog = candidatePath && existsSync(candidatePath)
    ? parseJsonl(readFileSync(candidatePath, "utf8"))
    : [];
  if (candidatesArg && candidateLog.length === 0) {
    console.error(`note: no candidate-log entries read from ${candidatePath}; selected will be absent.`);
  }

  const result = buildEarlyEvents({
    snapshot: JSON.parse(readFileSync(snapshotPath, "utf8")),
    toolCallRows: parseJsonl(readFileSync(toolCallPath, "utf8")),
    captureEvents: capturePaths.flatMap((p) => parseJsonl(readFileSync(p, "utf8"))),
    candidateLog,
  });

  const outPath = "evaluation/provenance/artifacts/early-events.jsonl";
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, result.events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  console.log(renderEarlySummary(summarizeEarly(result)));
  console.log(`\nEvents written to ${outPath}`);
}
