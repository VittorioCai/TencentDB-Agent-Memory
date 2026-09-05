/**
 * Provenance event builder — puts "who wrote it" and "who used it" on one record.
 *
 * The existing telemetry is missing that edge. `tool_call_logs` records only the
 * consumer (user_id / agent_id); the asset's owner lives in the asset record, and
 * the two were never joined. Without the edge neither the team dimension nor
 * author confidence can be computed — and it cannot be backfilled later, because
 * asset ownership changes and versions roll forward, so a lookup after the fact
 * returns a different row than the one that was actually used.
 *
 * Each of the three inputs answers only part of the question:
 *
 *   asset pool snapshot   who wrote it, when, which version
 *   tool_call_logs        who used it, whether the call succeeded
 *                         (written by the service itself; the model cannot alter it)
 *   capture JSONL         which asset ids came back in the response
 *
 * That last one is the crux: a `skill/search` bridge row records the request only,
 * so it holds the query but not what was returned. Asset identity can therefore be
 * recovered only from the captured response. Each event records how the fetch was
 * witnessed in `observation`:
 *
 *   bridge+wire   service-side success record AND an asset id parsed from the
 *                 capture (strongest)
 *   bridge_only   service-side success, but the capture missed it — only the
 *                 channel is known
 *   wire_only     an asset id in the capture with no matching service-side
 *                 success record (doubtful)
 *
 * Usage:
 *   node evaluation/provenance/build-events.mjs \
 *     evaluation/provenance/artifacts/asset-pool-snapshot.json \
 *     evaluation/gate0/artifacts/tool-call-logs.jsonl \
 *     [capture.jsonl ...]
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";

/**
 * Stable event id, referenced by gate decisions (`evidence_refs`) and receipts.
 * Derived from content rather than generated randomly, so re-running over the
 * same input yields the same ids and the two sides can be reconciled.
 */
export function eventId(parts) {
  const digest = createHash("sha1").update(parts.join("|")).digest("hex");
  return `evt-${digest.slice(0, 12)}`;
}

/** Relation between consumer and producer. Only cross_user is team value. */
export function classifyRelation(producer, actor) {
  const pu = producer.user_id || "";
  const pa = producer.agent_id || "";
  const au = actor.user_id || "";
  const aa = actor.agent_id || "";

  // If either identity is missing the relation is undecidable. Report unknown
  // rather than defaulting to self — defaulting would quietly erase genuine
  // cross-person use.
  if (!pu || !au) return "unknown";
  if (pu !== au) return "cross_user";
  if (pa && aa && pa !== aa) return "cross_agent";
  return "self";
}

/**
 * The proxy prefixes session_key with the client name (codebuddy:xxx) while the
 * knowledge service stores the bare x-conversation-id. Normalise before joining.
 */
export function normalizeSessionKey(key) {
  const s = String(key ?? "");
  const idx = s.indexOf(":");
  return idx >= 0 ? s.slice(idx + 1) : s;
}

/** Parse JSONL line by line, skipping malformed lines instead of failing whole. */
export function parseJsonl(text) {
  const rows = [];
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* skip malformed line */ }
  }
  return rows;
}

/**
 * Split a Bash tool result into the command that was issued and the output it
 * produced.
 *
 * These must never be scanned as one blob. A tool result echoes the command
 * before its output, so a call that timed out after 75 s with empty stdout
 * still contains the bridge URL and the asset name — matching the whole thing
 * reads the *request* as if it were the response. The endpoint is read from the
 * command, which is what the command is for; the payload only from the output.
 */
export function splitCommandAndOutput(text) {
  const s = String(text ?? "");
  const i = s.search(/(^|\n)Stdout:/);
  // No envelope — a native tool result rather than a shell call. The two halves
  // cannot be separated, so the whole thing is treated as output and the
  // command as absent. That keeps the id visible while making targeting
  // undecidable, which is the honest reading: with no command to inspect,
  // nothing here can establish that this asset was the one asked for.
  if (i < 0) return { command: "", output: s };
  const nl = s.indexOf("Stdout:", i);
  return { command: s.slice(0, i), output: s.slice(nl + "Stdout:".length) };
}

/**
 * The action a command invoked, as `skill:search`, or "" if not one.
 *
 * The knowledge service is not shaped like the other two. It runs on its own
 * port and takes the operation in the body (`tool_name`) rather than in the
 * path, so a path-only pattern does not see it at all — and an unrecognised
 * command means the response is never inspected, which shows up as "delivery
 * unknown" for a channel where delivery is perfectly knowable.
 */
export function commandEndpoint(command) {
  const cmd = String(command ?? "");
  const bridge = /https?:\/\/[^\s'"]*\/(skill|memory)-bridge\/v3\/[a-z]+\/([a-z/-]+)/.exec(cmd);
  if (bridge) return `${bridge[1]}:${bridge[2].replace(/\/+$/, "")}`;

  if (/https?:\/\/[^\s'"]*\/v3\/tools\/call/.test(cmd)) {
    const tool = /"tool_name"\s*:\s*"([^"]+)"/.exec(cmd);
    return `knowledge:${tool ? tool[1] : "call"}`;
  }
  if (/https?:\/\/[^\s'"]*\/v3\/tools\/list/.test(cmd)) return "knowledge:list";
  return "";
}

/** Enumeration endpoints hand back a list; they never retrieve one asset. */
export function isListingAction(action) {
  return /^(search|list|listing|list_[a-z_]+|search_[a-z_]+)$/.test(String(action ?? "").split(":").pop() ?? "");
}

/**
 * Did this command ask for *this* asset's content?
 *
 * The distinction that the whole `fetched` state rests on: appearing in a
 * `skill/search` result means the asset was **offered**, and appearing in a
 * `get-by-name` response means it was **retrieved**. Only the second is a fetch.
 */
export function commandTargetsAsset(command, asset) {
  const cmd = String(command ?? "");
  const endpoint = commandEndpoint(cmd);
  if (!endpoint || isListingAction(endpoint)) return false;
  const id = String(asset?.asset_id ?? "");
  const name = String(asset?.name ?? "");
  if (id && cmd.includes(id)) return true;
  if (name && new RegExp(`"(name|skill_name)"\\s*:\\s*"${escapeRegExp(name)}"`).test(cmd)) return true;
  return false;
}

/**
 * What a bridge response actually handed back for this asset.
 *
 * A non-enumeration endpoint is not enough to say the body arrived. `get` with
 * `include_content:false` answers with id, name and version; `update` answers
 * with a metadata summary. Both name the asset, both come from an endpoint that
 * is not a listing, and neither delivers a single line of the asset's content —
 * so an endpoint allow-list would pass all of them.
 *
 * The version is read from the same place for the same reason: the response
 * states which revision it returned, and that is the only source entitled to
 * say so. The snapshot's version describes the pool now, not what came back.
 *
 * Returns `{ delivered, version }` where `delivered` is null when the payload
 * could not be parsed at all — unknown, which is not false.
 */
export function inspectDelivery(output, assetId) {
  const envelope = firstJsonObject(output);
  if (!envelope) return { delivered: null, version: null };

  // The asset may be the whole payload or one item inside a list.
  const data = envelope.data ?? envelope;
  const candidates = [data, ...(Array.isArray(data?.items) ? data.items : [])];
  const record = candidates.find((c) => c && typeof c === "object"
    && [c.skill_id, c.wiki_id, c.asset_id, c.id].some((v) => String(v ?? "") === assetId));
  if (!record) return { delivered: null, version: null };

  const body = [record.content, record.skill_md, record.body, record.text, record.markdown]
    .find((v) => typeof v === "string");
  const version = record.version ?? null;

  // A field that exists but is empty is a delivery of nothing. The threshold is
  // deliberately low — one line of real content is content — but zero is zero.
  return { delivered: typeof body === "string" ? body.trim().length > 0 : false, version };
}

/** First balanced JSON object in a blob of text. */
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
      if (depth === 0) { try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; } }
    }
  }
  return null;
}

/** Every tool result in a captured request, paired with its call id. */
function toolResultsOf(body) {
  const out = [];
  const msgs = Array.isArray(body?.messages) ? body.messages : [];
  msgs.forEach((message, index) => {
    if (message?.role === "tool") {
      const c = message.content;
      out.push({ index, callId: String(message.tool_call_id ?? ""), text: typeof c === "string" ? c : JSON.stringify(c ?? "") });
    }
    const blocks = Array.isArray(message?.content) ? message.content : [];
    for (const block of blocks) {
      if (block?.type !== "tool_result") continue;
      const c = block.content;
      out.push({ index, callId: String(block.tool_use_id ?? ""), text: typeof c === "string" ? c : JSON.stringify(c ?? "") });
    }
  });
  return out;
}

/**
 * Where each asset was seen in the capture, and — the part that matters —
 * whether the call that produced it had asked for that asset.
 *
 * Only tool *results* are searched: a request carries intent rather than
 * delivery. Within a result, the asset id must appear in the output half and
 * the targeting decision is made from the command half.
 */
export function extractAssetMentions(events, assets) {
  const mentions = new Map(); // assetId -> Map<sessionKey, {targeted, endpoints:Set, callIds:Set}>
  const list = [...assets].filter((a) => a?.asset_id);
  if (list.length === 0) return mentions;

  for (const event of events) {
    if (event?.event !== "http.request") continue;
    const body = event?.body?.json;
    if (!body || !Array.isArray(body.messages)) continue;

    const sessionKey = normalizeSessionKey(
      event?.headers?.["x-conversation-id"] ?? event?.headers?.["X-Conversation-Id"] ?? "",
    );

    for (const { index, callId, text } of toolResultsOf(body)) {
      const { command, output } = splitCommandAndOutput(text);
      if (!output) continue;
      for (const asset of list) {
        if (!output.includes(asset.asset_id)) continue;
        if (!mentions.has(asset.asset_id)) mentions.set(asset.asset_id, new Map());
        const bySession = mentions.get(asset.asset_id);
        if (!bySession.has(sessionKey)) {
          bySession.set(sessionKey, {
            targeted: false, endpoints: new Set(), callIds: new Set(),
            delivered: null, version: null, contextEntryIndex: null,
          });
        }
        const seen = bySession.get(sessionKey);
        const endpoint = commandEndpoint(command);
        if (endpoint) seen.endpoints.add(endpoint);
        if (callId) seen.callIds.add(callId);
        if (!commandTargetsAsset(command, asset)) continue;
        seen.targeted = true;

        // Only a targeted response can deliver the body, so delivery, version
        // and the position it entered the context are all read from here. The
        // index is the message carrying the *result*, not the call: a model can
        // emit several calls in one message, and the second was written before
        // the first one's result existed.
        const { delivered, version } = inspectDelivery(output, asset.asset_id);
        if (delivered && (seen.contextEntryIndex == null || index < seen.contextEntryIndex)) {
          seen.contextEntryIndex = index;
        }
        if (seen.delivered !== true) seen.delivered = delivered;
        if (version != null && seen.version == null) seen.version = version;
      }
    }
  }
  return mentions;
}


/**
 * Does this bridge call target the given asset specifically?
 *
 * The distinction that matters: `skill/search` returns a list, so an asset
 * appearing in its results was *offered*, not retrieved. Only a call that names
 * the asset — by id, or by the name the asset is registered under — is evidence
 * that its content was actually pulled into the session.
 *
 * Without this, any successful call in the session would mark every asset
 * mentioned anywhere in the capture as fetched, and that error would propagate
 * into the used judgement built on top of it.
 */
export function callTargetsAsset(call, asset) {
  const body = String(call.requestBody ?? "");
  if (!body) return false;
  const id = String(asset.asset_id ?? "");
  const name = String(asset.name ?? "");

  // Listing endpoints enumerate; they never target one asset.
  const endpoint = String(call.executedEndpoint ?? "");
  if (/^(search|list|listing)$/.test(endpoint)) return false;

  if (id && body.includes(id)) return true;
  // get-by-name and friends carry the registered name rather than the id.
  if (name && new RegExp(`"(name|skill_name)"\\s*:\\s*"${escapeRegExp(name)}"`).test(body)) return true;
  return false;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Combine the three inputs into provenance events. */
export function buildEvents({ snapshot, toolCallRows, captureEvents }) {
  const assets = snapshot?.assets ?? [];
  const poolSnapshotAt = snapshot?.pool_snapshot_at ?? "";
  const byId = new Map(assets.map((a) => [a.asset_id, a]));

  const mentions = extractAssetMentions(captureEvents, assets);

  // Service-side call records, grouped by normalised session key.
  const bridgeBySession = new Map();
  for (const row of toolCallRows) {
    if (row?.kind !== "bridge_call") continue;
    const status = Number(row.upstream_status ?? 0);
    const rejected = String(row.reject_reason ?? "").length > 0;
    const key = normalizeSessionKey(row.session_key);
    if (!bridgeBySession.has(key)) bridgeBySession.set(key, []);
    bridgeBySession.get(key).push({
      ok: !rejected && status >= 200 && status < 300,
      status,
      rejected,
      bridgeSource: String(row.bridge_source ?? ""),
      executedEndpoint: String(row.executed_endpoint ?? ""),
      requestBody: String(row.request_body ?? ""),
      actor: { user_id: String(row.user_id ?? ""), agent_id: String(row.agent_id ?? "") },
      teamId: String(row.team_id ?? ""),
      timestamp: String(row.timestamp ?? ""),
    });
  }

  const events = [];
  const offeredNotRetrieved = [];

  for (const [assetId, sessions] of mentions) {
    const asset = byId.get(assetId);
    if (!asset) continue;

    // Assets created after the pool was frozen are excluded: they leak answers.
    const staleAsset = Boolean(
      poolSnapshotAt && asset.asset_created_at && asset.asset_created_at > poolSnapshotAt,
    );

    for (const [sessionKey, seen] of sessions) {
      const calls = bridgeBySession.get(sessionKey) ?? [];
      const producer = { user_id: asset.producer_user_id, agent_id: asset.producer_agent_id };

      // A successful call somewhere in the session is not evidence that *this*
      // asset was retrieved. The call must name this asset.
      const targeted = calls.filter((c) => c.ok && callTargetsAsset(c, asset));
      const success = targeted[0];

      // Nor is appearing in the capture. An asset id in a `skill/search`
      // response was **offered**; only a response to a command that asked for
      // this asset was **retrieved**. Without either, there is no fetch here —
      // and writing one anyway is how a listing hit becomes a `used` claim two
      // stages later. The asset did reach the model's context, and that is
      // recorded as `recalled` / `injected` by build-early-events.mjs, which is
      // a different statement about a different thing.
      if (!success && !seen.targeted) {
        offeredNotRetrieved.push({
          asset_id: assetId,
          session_key: sessionKey,
          endpoints: [...seen.endpoints],
        });
        continue;
      }

      const actor = success?.actor ?? calls[0]?.actor ?? { user_id: "", agent_id: "" };
      const occurredAt = success?.timestamp ?? "";
      // `observation` says which sources witnessed the event, not how strong the
      // claim is — those are deliberately separate fields. Inside this loop the
      // capture always saw the asset id, so a service-side row makes it both.
      // Whether it counts as a *fetch* was decided above, by targeting.
      const observation = success ? "bridge+wire" : "wire_only";

      const proofRefs = [];
      if (success) {
        proofRefs.push({
          kind: "bridge_row",
          ref: `tool_call_logs:${occurredAt}:${success.bridgeSource}:${success.executedEndpoint}`,
          detail: `request names ${asset.asset_id}`,
        });
      }
      if (seen.targeted) {
        proofRefs.push({
          kind: "capture_line",
          ref: `${sessionKey}:${[...seen.callIds][0] || "tool_result"}`,
          detail: success
            ? `returned by ${[...seen.endpoints].join(", ") || "a targeted call"}`
            // A wire-level fetch the service never logged is a hole in the tap,
            // not a stronger result. It is recorded so the gap is visible.
            : `returned by ${[...seen.endpoints].join(", ") || "a targeted call"}, but no service-side row recorded it — telemetry gap`,
        });
      }

      events.push({
        schema_version: "provenance-v1",
        event_id: eventId([sessionKey, assetId, "fetched", occurredAt, observation]),
        state: "fetched",
        session_key: sessionKey,
        run_id: null,
        task_id: null,
        occurred_at: occurredAt || null,
        asset_id: assetId,
        asset_type: asset.asset_type,
        asset_name: asset.name,
        // From the response, never the snapshot. The snapshot says what the
        // pool holds now; this event says which revision came back then.
        asset_version: seen.version ?? null,
        asset_created_at: asset.asset_created_at ?? "",
        pool_snapshot_at: poolSnapshotAt,
        excluded_by_snapshot: staleAsset,
        producer_user_id: producer.user_id,
        producer_agent_id: producer.agent_id,
        actor_user_id: actor.user_id,
        actor_agent_id: actor.agent_id,
        relation: classifyRelation(producer, actor),
        observation,
        content_delivered: seen.delivered,
        context_entry_index: seen.contextEntryIndex,
        evidence_tier: null,
        bridge_source: success?.bridgeSource ?? "",
        executed_endpoint: success?.executedEndpoint ?? [...seen.endpoints][0] ?? "",
        upstream_status: success?.status ?? 0,
        target_type: null,
        target_ref: null,
        proof_refs: proofRefs,
        corrected_reason: null,
        parent_event_ids: [],
      });
    }
  }

  // Channels with a service-side success the capture never saw get their own
  // record. Dropping them would suggest the call never happened — a gap in
  // collection and an absence of activity are not the same thing.
  const seenPairs = new Set(events.map((e) => `${e.session_key}|${e.asset_id}`));
  for (const [sessionKey, calls] of bridgeBySession) {
    for (const call of calls.filter((c) => c.ok)) {
      // A row that names an asset is attributed to it, even with no capture.
      const named = assets.find((a) => callTargetsAsset(call, a));
      if (named && seenPairs.has(`${sessionKey}|${named.asset_id}`)) continue;
      if (!named && [...seenPairs].some((k) => k.startsWith(`${sessionKey}|`))) continue;

      const producer = named
        ? { user_id: named.producer_user_id, agent_id: named.producer_agent_id }
        : { user_id: "", agent_id: "" };

      events.push({
        schema_version: "provenance-v1",
        event_id: eventId([sessionKey, named?.asset_id ?? "", "fetched", call.timestamp, "bridge_only", call.bridgeSource, call.executedEndpoint]),
        state: "fetched",
        session_key: sessionKey,
        run_id: null,
        task_id: null,
        occurred_at: call.timestamp || null,
        asset_id: named?.asset_id ?? "",
        asset_type: named?.asset_type ?? "",
        asset_name: named?.name ?? "",
        // Only the snapshot knows a version here, and the snapshot is not
        // entitled to say which revision a call returned.
        asset_version: null,
        asset_created_at: named?.asset_created_at ?? "",
        pool_snapshot_at: poolSnapshotAt,
        excluded_by_snapshot: false,
        producer_user_id: producer.user_id,
        producer_agent_id: producer.agent_id,
        actor_user_id: call.actor.user_id,
        actor_agent_id: call.actor.agent_id,
        relation: named ? classifyRelation(producer, call.actor) : "unknown",
        observation: "bridge_only",
        // The response was never captured. Unknown, which is not false — and
        // not something a later stage may promote on either.
        content_delivered: null,
        context_entry_index: null,
        evidence_tier: null,
        bridge_source: call.bridgeSource,
        executed_endpoint: call.executedEndpoint,
        upstream_status: call.status,
        target_type: null,
        target_ref: null,
        proof_refs: [{
          kind: "bridge_row",
          ref: `tool_call_logs:${call.timestamp}:${call.bridgeSource}:${call.executedEndpoint}`,
          detail: named ? `request names ${named.asset_id}; the capture never saw the response` : "the capture never saw this call",
        }],
        corrected_reason: null,
        parent_event_ids: [],
      });
      if (named) seenPairs.add(`${sessionKey}|${named.asset_id}`);
    }
  }

  events.offeredNotRetrieved = offeredNotRetrieved;
  return events;
}

/** Human-readable summary. */
export function summarize(events) {
  const counts = { self: 0, cross_agent: 0, cross_user: 0, unknown: 0 };
  const tiers = {};
  const assets = new Set();
  let excluded = 0;

  for (const e of events) {
    counts[e.relation] = (counts[e.relation] ?? 0) + 1;
    tiers[e.observation] = (tiers[e.observation] ?? 0) + 1;
    if (e.asset_id) assets.add(e.asset_id);
    if (e.excluded_by_snapshot) excluded += 1;
  }

  const attributable = events.filter((e) => e.relation !== "unknown").length;
  return {
    total: events.length,
    relations: counts,
    tiers,
    distinctAssets: assets.size,
    excludedBySnapshot: excluded,
    crossUserRate: attributable > 0 ? counts.cross_user / attributable : null,
    offeredNotRetrieved: events.offeredNotRetrieved ?? [],
  };
}

export function renderSummary(s) {
  const lines = [
    "# Provenance summary",
    "",
    `${s.total} event(s) across ${s.distinctAssets} asset(s)`,
    "",
    "| relation | count | meaning |",
    "|---|---|---|",
    `| self | ${s.relations.self} | used one's own asset; not team value |`,
    `| cross_agent | ${s.relations.cross_agent} | same person, different agent |`,
    `| cross_user | ${s.relations.cross_user} | another identity used it — this is team value |`,
    `| unknown | ${s.relations.unknown} | identity missing on one side; undecidable |`,
    "",
    "| observation | count |",
    "|---|---|",
    ...Object.entries(s.tiers).sort().map(([k, v]) => `| ${k} | ${v} |`),
    "",
  ];

  if (s.crossUserRate === null) {
    lines.push("Cross-person reuse rate: **not computable** (no event has both identities).");
  } else {
    lines.push(`Cross-person reuse rate: **${(s.crossUserRate * 100).toFixed(1)}%** (cross_user / attributable events).`);
    if (s.relations.cross_user === 0) {
      lines.push("");
      lines.push("Zero here is a finding, not an omission: the system has **never produced");
      lines.push("a single cross-person reuse record**. It logs who created an asset but never");
      lines.push("logs whose asset someone else successfully used.");
    }
  }
  const offered = s.offeredNotRetrieved ?? [];
  if (offered.length > 0) {
    lines.push("", `${offered.length} asset/session pair(s) appeared in the capture but were never retrieved:`);
    for (const o of offered) lines.push(`  - ${o.asset_id} via ${o.endpoints.join(", ") || "no bridge command"}`);
    lines.push("Offered, not fetched. These are **not** written as `fetched` — appearing in a");
    lines.push("listing is the retrieval system doing its job, not the model taking the content.");
    lines.push("They are recorded as `recalled` / `injected` by build-early-events.mjs.");
  }
  if (s.excludedBySnapshot > 0) {
    lines.push("", `${s.excludedBySnapshot} event(s) excluded: asset created after the pool was frozen (answer-leak guard).`);
  }
  return lines.join("\n");
}

// ── CLI ────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const [snapshotPath, toolCallPath, ...capturePaths] = process.argv.slice(2);
  if (!snapshotPath || !toolCallPath) {
    console.error("usage: node build-events.mjs <snapshot.json> <tool-call-logs.jsonl> [capture.jsonl ...]");
    process.exit(2);
  }

  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
  const toolCallRows = parseJsonl(readFileSync(toolCallPath, "utf8"));
  const captureEvents = capturePaths.flatMap((p) => parseJsonl(readFileSync(p, "utf8")));

  const events = buildEvents({ snapshot, toolCallRows, captureEvents });
  const outPath = "evaluation/provenance/artifacts/provenance-events.jsonl";
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");

  console.log(renderSummary(summarize(events)));
  console.log(`\nEvents written to ${outPath}`);
}
