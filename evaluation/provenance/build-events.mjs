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
 * Find asset ids that appear in the capture, together with the session they
 * appeared in. Search tool *results* only, never requests: a request carries
 * intent rather than delivery, and a tool result echoes the command verbatim
 * before its output, so scanning the whole blob mistakes the request for the
 * response.
 */
export function extractAssetMentions(events, assetIds) {
  const mentions = new Map(); // assetId -> Set<sessionKey>
  const ids = [...assetIds].filter(Boolean);
  if (ids.length === 0) return mentions;

  for (const event of events) {
    if (event?.event !== "http.request") continue;
    const body = event?.body?.json;
    if (!body || !Array.isArray(body.messages)) continue;

    const sessionKey = normalizeSessionKey(
      event?.headers?.["x-conversation-id"] ?? event?.headers?.["X-Conversation-Id"] ?? "",
    );

    const returned = [];
    for (const message of body.messages) {
      if (message?.role === "tool") returned.push(JSON.stringify(message?.content ?? ""));
      const content = Array.isArray(message?.content) ? message.content : [];
      for (const block of content) {
        if (block?.type === "tool_result") returned.push(JSON.stringify(block?.content ?? ""));
      }
    }
    const haystack = returned.join("\n");
    if (!haystack) continue;

    for (const id of ids) {
      if (!haystack.includes(id)) continue;
      if (!mentions.has(id)) mentions.set(id, new Set());
      mentions.get(id).add(sessionKey);
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

  const mentions = extractAssetMentions(captureEvents, byId.keys());

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
  for (const [assetId, sessions] of mentions) {
    const asset = byId.get(assetId);
    if (!asset) continue;

    // Assets created after the pool was frozen are excluded: they leak answers.
    const staleAsset = Boolean(
      poolSnapshotAt && asset.asset_created_at && asset.asset_created_at > poolSnapshotAt,
    );

    for (const sessionKey of sessions) {
      const calls = bridgeBySession.get(sessionKey) ?? [];
      const producer = { user_id: asset.producer_user_id, agent_id: asset.producer_agent_id };

      // A successful call somewhere in the session is not evidence that *this*
      // asset was retrieved. A search that merely returned it in a result list
      // is not retrieval either. The call must name this asset.
      const targeted = calls.filter((c) => c.ok && callTargetsAsset(c, asset));
      const success = targeted[0];
      const actor = success?.actor ?? calls[0]?.actor ?? { user_id: "", agent_id: "" };

      const occurredAt = success?.timestamp ?? "";
      const observation = success ? "bridge+wire" : "wire_only";
      const proofRefs = success
        ? [{
            kind: "bridge_row",
            ref: `tool_call_logs:${occurredAt}:${success.bridgeSource}:${success.executedEndpoint}`,
            detail: `request names ${asset.asset_id}`,
          }]
        : [{
            kind: "capture_line",
            ref: `${sessionKey}:tool_result`,
            detail: "asset id appears in a captured result, but no service-side call targets it",
          }];

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
        asset_version: asset.version ?? null,
        asset_created_at: asset.asset_created_at ?? "",
        pool_snapshot_at: poolSnapshotAt,
        excluded_by_snapshot: staleAsset,
        producer_user_id: producer.user_id,
        producer_agent_id: producer.agent_id,
        actor_user_id: actor.user_id,
        actor_agent_id: actor.agent_id,
        relation: classifyRelation(producer, actor),
        observation,
        evidence_tier: null,
        bridge_source: success?.bridgeSource ?? "",
        executed_endpoint: success?.executedEndpoint ?? "",
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
  const seenSessions = new Set(events.map((e) => e.session_key));
  for (const [sessionKey, calls] of bridgeBySession) {
    if (seenSessions.has(sessionKey)) continue;
    for (const call of calls.filter((c) => c.ok)) {
      events.push({
        schema_version: "provenance-v1",
        event_id: eventId([sessionKey, "", "fetched", call.timestamp, "bridge_only", call.bridgeSource, call.executedEndpoint]),
        state: "fetched",
        session_key: sessionKey,
        run_id: null,
        task_id: null,
        occurred_at: call.timestamp || null,
        asset_id: "",
        asset_type: "",
        asset_name: "",
        asset_version: null,
        asset_created_at: "",
        pool_snapshot_at: poolSnapshotAt,
        excluded_by_snapshot: false,
        producer_user_id: "",
        producer_agent_id: "",
        actor_user_id: call.actor.user_id,
        actor_agent_id: call.actor.agent_id,
        relation: "unknown",
        observation: "bridge_only",
        evidence_tier: null,
        bridge_source: call.bridgeSource,
        executed_endpoint: call.executedEndpoint,
        upstream_status: call.status,
        target_type: null,
        target_ref: null,
        proof_refs: [{ kind: "bridge_row", ref: `tool_call_logs:${call.timestamp}:${call.bridgeSource}:${call.executedEndpoint}` }],
        corrected_reason: null,
        parent_event_ids: [],
      });
    }
  }

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
