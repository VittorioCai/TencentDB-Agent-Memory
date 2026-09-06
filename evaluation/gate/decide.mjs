/**
 * Admission gate rule engine (P2-2) with the cold-start branch (P2-4).
 *
 * Three rules, in this order, and nothing else decides:
 *
 *   reject   any `corrected` with reason wrong / stale
 *   admit    at least one `validated` with relation cross_user, and no such corrected
 *   pending  everything else
 *
 * Generalisation (distinct tasks) and reach (distinct consumers) are reported
 * in `signals` and `reasons`; they are not thresholds. With the evidence this
 * evaluation can produce, a threshold on them would only ever say pending.
 *
 * The cold-start branch is where the author signal changes something visible.
 * An asset with no usage evidence is pending — admitting or rejecting on no
 * evidence would not survive a question — but its `reasons` carry a review
 * priority: high when the author has recent assets judged wrong, low when the
 * author's confidence is computable and ≥ 0.8. The signal orders the human
 * queue; it never moves admit or reject.
 *
 * Every admit and reject cites the events it rests on (`evidence_refs`), so a
 * reviewer can open them and overturn the decision.
 *
 * Usage:
 *   node evaluation/gate/decide.mjs --events=<a.jsonl,b.jsonl> --snapshot=<asset-pool-snapshot.json>
 *        [--tokens=tokens.json] [--decoys=FILE] [--now=ISO] [--out=gate-decisions.json]
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parseJsonl } from "../provenance/build-events.mjs";
import { authorConfidence, DOWNWEIGHT_REASONS } from "./author-confidence.mjs";

export const USAGE_STATES = new Set(["fetched", "used", "used_soft", "needs_review", "validated", "corrected"]);
export const REVIEW_LOW_THRESHOLD = 0.8;
export const RECENT_WINDOW_DAYS = 30;

function daysBetween(a, b) {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86_400_000;
}

/** The online signal block for one asset's events (already filtered to the asset). */
export function onlineSignals(assetEvents) {
  const count = (s) => assetEvents.filter((e) => e.state === s).length;
  const actors = new Set(assetEvents.filter((e) => USAGE_STATES.has(e.state)).map((e) => e.actor_user_id).filter(Boolean));
  const tasks = new Set(assetEvents.filter((e) => e.state === "validated").map((e) => e.task_id).filter(Boolean));
  return {
    fetched: count("fetched"),
    used_hard: count("used"),
    used_soft: count("used_soft"),
    validated: count("validated"),
    corrected: count("corrected"),
    distinct_actors: actors.size,
    distinct_tasks: tasks.size,
    cross_user_validated: assetEvents.filter((e) => e.state === "validated" && e.relation === "cross_user").length,
  };
}

function ref(e) {
  return { event_id: e.event_id, state: e.state, relation: e.relation ?? "unknown" };
}

/** Evidence refs for a set of events plus the used events they derive from. */
function evidenceFor(events, all) {
  const byId = new Map(all.map((e) => [e.event_id, e]));
  const out = new Map();
  for (const e of events) {
    out.set(e.event_id, ref(e));
    for (const pid of e.parent_event_ids ?? []) {
      const p = byId.get(pid);
      if (p && USAGE_STATES.has(p.state)) out.set(p.event_id, ref(p));
    }
  }
  return [...out.values()];
}

/** Recent assets by this author judged wrong, other than the one being decided. */
export function authorRecentWrong(allEvents, authorUserId, { exceptAssetId, now, windowDays = RECENT_WINDOW_DAYS }) {
  const hits = allEvents.filter((e) =>
    e.state === "corrected" && e.corrected_reason === "wrong"
    && e.producer_user_id === authorUserId && e.asset_id !== exceptAssetId
    && !e.excluded_by_snapshot
    && (!e.occurred_at || !now || daysBetween(e.occurred_at, now) <= windowDays));
  return [...new Set(hits.map((e) => e.asset_id))];
}

/**
 * Decide one asset. `asset` is the pool-snapshot row (or a stub built from
 * events); `events` are ALL events in scope, the asset's own are picked here.
 */
export function decideAsset({ asset, events, decoys = new Map(), now, tokensByAsset = {} }) {
  const assetId = asset.asset_id;
  const own = events.filter((e) => e.asset_id === assetId);
  const excluded = own.filter((e) => e.excluded_by_snapshot);
  const counted = own.filter((e) => !e.excluded_by_snapshot);
  const usage = counted.filter((e) => USAGE_STATES.has(e.state));

  const authorUser = asset.producer_user_id || counted[0]?.producer_user_id || "";
  const authorAgent = asset.producer_agent_id || counted[0]?.producer_agent_id || "";
  const decoyIds = new Set(decoys.keys());
  const byUser = authorConfidence(events, authorUser, { by: "user", decoyIds });
  const byAgent = authorAgent ? authorConfidence(events, authorAgent, { by: "agent", decoyIds }) : null;

  const signals = {
    online: onlineSignals(counted),
    author: {
      user_id: authorUser,
      ...(authorAgent ? { agent_id: authorAgent } : {}),
      confidence: byUser.confidence,
      computable: byUser.computable,
      distinct_tasks: byUser.distinct_tasks,
    },
    offline: {
      retrieval_rank_mean: null,
      has_concrete_values: tokensByAsset[assetId] ? tokensByAsset[assetId].tokens.length > 0 : null,
      duplicate_of: null,
    },
  };

  const reasons = [];
  let decision;
  let evidence_refs = [];

  const downweighting = counted.filter((e) => e.state === "corrected" && DOWNWEIGHT_REASONS.has(e.corrected_reason));
  const crossValidated = counted.filter((e) => e.state === "validated" && e.relation === "cross_user");

  if (downweighting.length > 0) {
    decision = "reject";
    const detail = downweighting[0].proof_refs?.[0]?.detail;
    reasons.push(`rule reject: a corrected record exists (reason=${downweighting[0].corrected_reason}, ${downweighting.length} record(s))${detail ? ` — ${detail}` : ""}`);
    if (crossValidated.length > 0) {
      reasons.push(`${crossValidated.length} cross_user validated record(s) exist but do not override a corrected one`);
    }
    evidence_refs = evidenceFor(downweighting, events);
  } else if (crossValidated.length > 0) {
    decision = "admit";
    reasons.push(`rule admit: cross_user validated >= 1 (${crossValidated.length} record(s)) and no corrected`);
    evidence_refs = evidenceFor(crossValidated, events);
  } else {
    decision = "pending";
    const o = signals.online;
    if (usage.length === 0) {
      reasons.push("cold start: no usage evidence for this asset yet (nothing at fetched or beyond); pending by default");
    } else if (o.validated > 0) {
      reasons.push(`validated ${o.validated} time(s) but only by ${counted.filter((e) => e.state === "validated").map((e) => e.relation).join(", ")}; cross-person validation is required for admit`);
    } else if (o.used_hard > 0) {
      reasons.push(`used with hard evidence ${o.used_hard} time(s) but no outcome tied to those calls yet`);
    } else if (o.used_soft > 0) {
      reasons.push(`soft evidence only (${o.used_soft} used_soft); soft evidence alone cannot establish used and yields no validated`);
    } else if (counted.some((e) => e.state === "needs_review")) {
      reasons.push("needs_review only: a token matched or a call was made, but nothing could be tied to this asset's own content");
    } else {
      reasons.push(`fetched ${o.fetched} time(s) without any evidence of use`);
    }
    reasons.push("no corrected record, so reject did not trigger");
    evidence_refs = evidenceFor(usage, events);
  }

  // Reported signals, never thresholds.
  const o = signals.online;
  if (usage.length > 0) {
    const taskNote = o.distinct_tasks === 0 ? "task ids not recorded on the events, so generalisation is not measurable here" : `${o.distinct_tasks} distinct task(s)`;
    reasons.push(`reported signals: ${taskNote}, ${o.distinct_actors} distinct consumer(s); neither is a threshold at this stage`);
  }

  // Author signal. In the cold-start branch it sets the review priority; in
  // every branch it is reported.
  if (decision === "pending" && usage.length === 0) {
    const wrong = authorRecentWrong(events, authorUser, { exceptAssetId: assetId, now });
    if (wrong.length > 0) {
      reasons.push(`author ${authorUser} has ${wrong.length} asset(s) judged wrong within ${RECENT_WINDOW_DAYS} days (${wrong.join(", ")}); review priority: high`);
    } else if (byUser.computable && byUser.confidence >= REVIEW_LOW_THRESHOLD) {
      reasons.push(`author history reliable (confidence ${byUser.confidence} from ${byUser.validated} cross-person validation(s), after shrinkage); review priority: low`);
    } else if (byUser.computable) {
      reasons.push(`author confidence ${byUser.confidence} (${byUser.validated} validated, ${byUser.corrected} corrected, after shrinkage); review priority: normal`);
    } else {
      reasons.push(`author confidence not computable: ${authorUser || "unknown author"} has no cross-person outcomes; review priority: normal`);
    }
  } else if (byUser.computable) {
    reasons.push(`author confidence ${byUser.confidence} (${byUser.validated} validated, ${byUser.corrected} corrected, prior ${byUser.prior}: ${byUser.prior_source})`);
  } else {
    reasons.push(`author confidence not computable: ${authorUser || "unknown author"} has no cross-person outcomes`);
  }
  if (byAgent?.computable && byUser.computable && byAgent.confidence !== byUser.confidence) {
    reasons.push(`by agent ${authorAgent} the confidence is ${byAgent.confidence}; person and agent scored separately`);
  }

  if (excluded.length > 0) {
    reasons.push(`${excluded.length} event(s) excluded by the pool snapshot and not counted`);
  }
  if (decoys.has(assetId)) {
    reasons.push(`decoy asset, expected ${decoys.get(assetId)}, excluded from headline statistics`);
  }

  return {
    schema_version: "gate-decision-v1",
    asset_id: assetId,
    ...(asset.asset_type ? { asset_type: asset.asset_type } : {}),
    ...(asset.name || asset.asset_name ? { asset_name: asset.name ?? asset.asset_name } : {}),
    decided_at: now ?? new Date().toISOString(),
    decision,
    reasons,
    evidence_refs,
    signals,
    is_decoy: decoys.has(assetId),
    expected_decision: decoys.get(assetId) ?? null,
  };
}

/**
 * Decide every asset in the snapshot, plus any asset that appears in the
 * events but not in the snapshot (those get a stub row and are pending with
 * the exclusion noted, because the events carry excluded_by_snapshot).
 */
export function decide({ events, snapshot, decoys = [], now, tokensByAsset = {} }) {
  const decoyMap = new Map(decoys.map((d) => [d.asset_id, d.expected_decision ?? "reject"]));
  const rows = new Map((snapshot?.assets ?? []).map((a) => [a.asset_id, a]));
  for (const e of events) {
    if (!rows.has(e.asset_id)) {
      rows.set(e.asset_id, { asset_id: e.asset_id, asset_type: e.asset_type, name: e.asset_name, producer_user_id: e.producer_user_id, producer_agent_id: e.producer_agent_id });
    }
  }
  return [...rows.values()].map((asset) => decideAsset({ asset, events, decoys: decoyMap, now, tokensByAsset }));
}

// ── CLI ──────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (name) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
  const eventsArg = arg("events"); const snapshotArg = arg("snapshot");
  if (!eventsArg || !snapshotArg) {
    console.error("usage: node decide.mjs --events=<a.jsonl,b.jsonl> --snapshot=<asset-pool-snapshot.json> [--tokens=F] [--decoys=F] [--now=ISO] [--out=F]");
    process.exit(2);
  }
  const events = eventsArg.split(",").filter(Boolean).flatMap((f) => parseJsonl(readFileSync(f, "utf8")));
  const snapshot = JSON.parse(readFileSync(snapshotArg, "utf8"));
  const tokensByAsset = arg("tokens") ? JSON.parse(readFileSync(arg("tokens"), "utf8")) : {};
  const decoys = arg("decoys") ? JSON.parse(readFileSync(arg("decoys"), "utf8")) : [];
  const decisions = decide({ events, snapshot, decoys, now: arg("now") ?? undefined, tokensByAsset });
  const out = arg("out");
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(decisions, null, 2) + "\n");
  }
  const { renderDecisions } = await import("./render-decision.mjs");
  console.log(renderDecisions(decisions));
  if (out) console.log(`\n${decisions.length} decision(s) → ${out}`);
}
