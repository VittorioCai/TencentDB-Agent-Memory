/**
 * Receipt builder (P3-1): which team assets one run used, in what state, from
 * whom, with what evidence and what risk. Written against receipt.schema.json.
 *
 * The receipt shows only what the evidence chain can prove, never one level
 * more. Each asset gets the highest state its events reached:
 *
 *   corrected   used, and the call it fed failed for a reason its content explains
 *   validated   used, and the call it fed succeeded in a run that passed
 *   used        hard evidence: a discriminative token in a call, after the fetch
 *   used_soft   a model's judgement only — stands alone, never a check mark
 *   fetched     the body was retrieved; use not established (needs_review lands here, with a risk)
 *   provided    appeared in a listing or the context; never fetched
 *
 * corrected outranks validated on the same asset in the same run: a receipt is
 * where a risk must surface, and one failed call is a risk regardless of a
 * later success.
 *
 * "Source" is the asset record's owner, on the same row as the consumer's
 * relation to it — the field task four asks for. "Low-confidence risk" is the
 * author's confidence from the gate decision; null renders as "no cross-person
 * validation yet", never as 0.
 *
 * Usage:
 *   node evaluation/receipt/build-receipt.mjs --events=<a.jsonl,b.jsonl,...> --snapshot=<asset-pool-snapshot.json>
 *        [--decisions=<gate-decisions.json | gate_baseline.json>] [--run=<run.json>] [--out=receipt.json]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { parseJsonl } from "../provenance/build-events.mjs";

// needs_review ranks above fetched so it wins the tie and its risk is carried,
// even though it renders as fetched: a fetch with a disputed use is more
// worth a reader's attention than a plain fetch.
export const STATUS_RANK = { provided: 0, fetched: 1, needs_review: 2, used_soft: 3, used: 4, validated: 5, corrected: 6 };
const RECEIPT_STATUS = { provided: "provided", fetched: "fetched", needs_review: "fetched", used_soft: "used_soft", used: "used", validated: "validated", corrected: "corrected" };
const EARLY = new Set(["recalled", "selected", "injected"]);
const EVIDENCE_KIND = {
  tool_call_id: "tool_call_id", session_message: "session_message", diff_hunk: "diff_hunk", tool_arg: "tool_arg",
  test_command: "test_command", bridge_row: "bridge_row", capture_line: "capture_line", verify_result: "verify_result",
  // provenance-only kinds mapped onto the receipt's vocabulary
  candidate_listing: "capture_line", injected_block: "session_message", bridge_response: "bridge_row",
};
export const LOW_CONFIDENCE_BELOW = 0.5;

function stateOf(e) { return EARLY.has(e.state) ? "provided" : e.state; }

/** Decisions from a gate-decisions.json array or a gate_baseline.json document. */
export function decisionsMap(doc) {
  const list = Array.isArray(doc) ? doc : doc?.decisions ?? [];
  return new Map(list.map((d) => [d.asset_id, d]));
}

function tokenFromDetail(detail) {
  const m = /token ([^;\s]+)/.exec(detail ?? "");
  return m ? m[1] : null;
}
function callFromRef(ref) {
  const m = /(call_[A-Za-z0-9_-]+)/.exec(ref ?? "");
  return m ? m[1] : null;
}
function messageFromRef(ref) {
  const m = /msg\[(\d+)\]/.exec(ref ?? "");
  return m ? Number(m[1]) : null;
}

/** Human sentence for what the asset affected, from the event that carries the status. */
export function impactOf(top, state) {
  if (state === "provided" || state === "fetched") return null;
  const arg = (top.proof_refs ?? []).find((p) => p.kind === "tool_arg" || p.kind === "diff_hunk");
  const token = tokenFromDetail(arg?.detail);
  const call = callFromRef(top.target_ref ?? arg?.ref);
  const msg = messageFromRef(top.target_ref ?? arg?.ref);
  const where = call ? `tool call ${call}${msg != null ? ` (message ${msg})` : ""}` : (top.target_ref ?? "the change");
  const what = token ? `its value ${token} was used in ${where}` : `used in ${where}`;
  if (state === "needs_review") {
    return `${what}, but ${arg?.detail?.replace(/^token \S+; /, "") ?? "the use could not be tied to this asset's own content"}`;
  }
  if (state === "used_soft") return `${what}; soft evidence only`;
  if (state === "corrected") {
    const v = (top.proof_refs ?? []).find((p) => p.kind === "verify_result");
    return `${what} and the call failed: ${v?.detail ?? "counter-evidence recorded"}`;
  }
  if (state === "validated") return `${what}; the call succeeded and the run's acceptance passed`;
  return what;
}

/** Evidence entries, deduplicated, kinds mapped onto the receipt vocabulary. */
export function evidenceOf(events) {
  const seen = new Set();
  const out = [];
  for (const e of events) {
    for (const p of e.proof_refs ?? []) {
      const kind = EVIDENCE_KIND[p.kind];
      if (!kind) continue;
      const key = `${kind}|${p.ref}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind, ref: p.ref, ...(p.detail ? { detail: p.detail } : {}) });
    }
  }
  return out;
}

/** Related tests: the acceptance calls this asset fed, from outcome events. */
export function relatedTestsOf(events) {
  const out = [];
  for (const e of events) {
    const a = e.metadata?.attempt;
    if (!a || a.ok === null || a.ok === undefined) continue;
    out.push({ command: `verify.mjs: dial ${a.host}:${a.port} (${e.metadata.call_id ?? "call"})`, passed: a.ok === true });
  }
  return out;
}

export function buildItem({ assetId, events, snapshot, decision }) {
  const byRank = [...events].sort((a, b) => (STATUS_RANK[stateOf(b)] ?? -1) - (STATUS_RANK[stateOf(a)] ?? -1));
  const top = byRank[0];
  const topState = stateOf(top);
  const status = RECEIPT_STATUS[topState];
  const snap = snapshot?.assets?.find((a) => a.asset_id === assetId) ?? {};
  const version = top.asset_version ?? byRank.find((e) => e.asset_version != null)?.asset_version ?? snap.version ?? null;

  const risks = [];
  if (topState === "needs_review") {
    risks.push({ kind: "needs_review", detail: top.proof_refs?.[0]?.detail ?? "a token matched but no fetch of this asset could be tied to it" });
  }
  if (decision?.decision === "reject") risks.push({ kind: "gate_rejected", detail: decision.reasons?.[0] ?? "rejected by the gate" });
  if (decision?.decision === "pending") risks.push({ kind: "gate_pending", detail: decision.reasons?.[0] ?? "gate decision pending; handed to a human" });
  const conf = decision?.signals?.author?.confidence ?? null;
  const author = top.producer_user_id || snap.producer_user_id || "";
  if (decision && conf === null) {
    risks.push({ kind: "low_confidence", detail: `author ${author} has no cross-person validation yet; confidence not computable` });
  } else if (conf !== null && conf < LOW_CONFIDENCE_BELOW) {
    risks.push({ kind: "low_confidence", detail: `author confidence ${conf} (after shrinkage)` });
  }
  if (version != null && snap.version != null && String(version) !== String(snap.version)) {
    risks.push({ kind: "not_head", detail: `v${version} was used; the pool's head is v${snap.version}` });
  }

  return {
    asset_id: assetId,
    name: top.asset_name || snap.name || assetId,
    asset_type: top.asset_type || snap.asset_type || "skill",
    version,
    updated_at: snap.asset_updated_at ?? null,
    status,
    source: {
      producer_user_id: author,
      ...(top.producer_agent_id || snap.producer_agent_id ? { producer_agent_id: top.producer_agent_id || snap.producer_agent_id } : {}),
      relation: top.relation ?? "unknown",
    },
    impact: impactOf(top, topState),
    target_type: topState === "provided" || topState === "fetched" ? null : (top.target_type ?? null),
    evidence: evidenceOf(topState === "provided" ? byRank : byRank.filter((e) => stateOf(e) !== "provided")),
    related_tests: relatedTestsOf(events.filter((e) => e.state === "validated" || e.state === "corrected")),
    risks,
    gate_decision: decision?.decision ?? null,
    author_confidence: conf,
  };
}

export function buildReceipt({ events, snapshot = null, decisions = null, runId = null, taskId = null, sessionKey = null, generatedAt = null }) {
  const dmap = decisions instanceof Map ? decisions : decisionsMap(decisions);
  const counted = events.filter((e) => !e.excluded_by_snapshot);
  const byAsset = new Map();
  for (const e of counted) {
    if (!byAsset.has(e.asset_id)) byAsset.set(e.asset_id, []);
    byAsset.get(e.asset_id).push(e);
  }
  const items = [...byAsset.entries()]
    .map(([assetId, evs]) => buildItem({ assetId, events: evs, snapshot, decision: dmap.get(assetId) ?? null }))
    .sort((a, b) => (STATUS_RANK[b.status] ?? 0) - (STATUS_RANK[a.status] ?? 0) || a.asset_id.localeCompare(b.asset_id));

  const count = (s) => items.filter((i) => i.status === s).length;
  const session = sessionKey ?? counted[0]?.session_key ?? "unknown";
  return {
    schema_version: "receipt-v1",
    session_key: session,
    run_id: runId ?? counted.find((e) => e.run_id)?.run_id ?? null,
    task_id: taskId ?? counted.find((e) => e.task_id)?.task_id ?? null,
    generated_at: generatedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    summary: {
      applied_count: items.filter((i) => i.status !== "provided").length,
      by_status: {
        validated: count("validated"),
        used: count("used"),
        fetched: count("fetched"),
        provided: count("provided"),
        corrected: count("corrected"),
      },
      soft_only_count: count("used_soft"),
    },
    items,
  };
}

// ── CLI ──────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (name) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
  const eventsArg = arg("events");
  if (!eventsArg) {
    console.error("usage: node build-receipt.mjs --events=<a.jsonl,...> [--snapshot=F] [--decisions=F] [--run=run.json] [--out=F]");
    process.exit(2);
  }
  const read = (p) => JSON.parse(readFileSync(p, "utf8"));
  const events = eventsArg.split(",").filter((f) => f && existsSync(f)).flatMap((f) => parseJsonl(readFileSync(f, "utf8")));
  const run = arg("run") ? read(arg("run")) : null;
  const receipt = buildReceipt({
    events,
    snapshot: arg("snapshot") ? read(arg("snapshot")) : null,
    decisions: arg("decisions") ? read(arg("decisions")) : null,
    runId: run?.run_id ?? null,
    taskId: run?.resolved_identity?.task_id ?? null,
    sessionKey: run?.conversation_id ?? null,
  });
  const out = arg("out");
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(receipt, null, 2) + "\n");
  }
  const { renderReceipt } = await import("./render-cli.mjs");
  console.log(renderReceipt(receipt));
  if (out) console.log(`\n→ ${out}`);
}
