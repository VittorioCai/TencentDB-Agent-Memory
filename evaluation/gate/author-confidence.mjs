/**
 * Author confidence (P2-1).
 *
 * A prior for cold-start assets only: a freshly extracted asset has no record
 * of its own, and the one thing known about it is who wrote it. Once an asset
 * has its own outcomes, those always win — using the author score to judge an
 * asset that already has evidence would be circular.
 *
 *   confidence = (V + α·μ) / (V + C + α)
 *
 *   V  cross_user `validated` events on the author's assets
 *   C  cross_user `corrected` events with reason wrong / stale
 *   μ  the mean validation rate of the OTHER authors who have outcomes
 *      (leave-one-out), itself shrunk toward neutral 0.5 by how many
 *      outcomes those authors have; exactly 0.5 when there are none
 *   α  shrinkage strength, 5
 *
 * Why each of those:
 *
 *   - Only cross_user counts. An author validating their own asset is
 *     self-certification; it says nothing a reviewer can rely on.
 *   - No raw ratio. Two validations out of two reads as 100% with a raw ratio;
 *     shrinkage pulls small samples toward the pool mean, and large volumes
 *     with a poor rate do not climb just by being large.
 *   - μ excludes the author being scored. With one author in the pool, the
 *     "pool mean" would be that author's own rate, and the shrinkage would
 *     shrink toward the very number it exists to temper: V=1, C=0 would give
 *     exactly 1.0 again. Leave-one-out makes the prior an outside opinion, and
 *     the neutral fallback is stated in the output so a reader can see when
 *     it was used.
 *   - Decoy assets are excluded. Their outcomes are planted truth for measuring
 *     the corrected miss rate, not the author's work.
 *   - Person and agent are scored separately. The two diverging (the same
 *     person's assets reliable through one agent and not another) points at
 *     an extraction path, not a person.
 *   - Not computable ⇒ null, never 0. Zero is a claim; null is the absence of one.
 *
 * Not applied here: time decay. Every event in this evaluation falls inside
 * one window, so a decay term would multiply everything by the same constant.
 * The output carries the event span so a reader can see that for themselves.
 *
 * Usage:
 *   node evaluation/gate/author-confidence.mjs <events.jsonl ...> [--decoys=FILE] [--json]
 */

import { readFileSync } from "node:fs";
import { parseJsonl } from "../provenance/build-events.mjs";

export const ALPHA = 5;
export const NEUTRAL_PRIOR = 0.5;
export const DOWNWEIGHT_REASONS = new Set(["wrong", "stale"]);

const KEY = { user: "producer_user_id", agent: "producer_agent_id" };

/** Does this event count toward any author's tally? */
export function countsForAuthor(event, decoyIds) {
  if (event.excluded_by_snapshot) return false;
  if (decoyIds.has(event.asset_id)) return false;
  if (event.relation !== "cross_user") return false;
  if (event.state === "validated") return true;
  if (event.state === "corrected") return DOWNWEIGHT_REASONS.has(event.corrected_reason);
  return false;
}

/** Per-author raw tallies. `by` is "user" or "agent". */
export function authorTallies(events, { by = "user", decoyIds = new Set() } = {}) {
  const key = KEY[by];
  if (!key) throw new Error(`by must be "user" or "agent", got ${by}`);
  const tallies = new Map();
  for (const e of events) {
    if (!countsForAuthor(e, decoyIds)) continue;
    const author = e[key] || "";
    if (!author) continue;
    if (!tallies.has(author)) {
      tallies.set(author, { validated: 0, corrected: 0, consumers: new Set(), tasks: new Set(), assets: new Set(), first: null, last: null });
    }
    const t = tallies.get(author);
    if (e.state === "validated") {
      t.validated += 1;
      if (e.actor_user_id) t.consumers.add(e.actor_user_id);
      if (e.task_id) t.tasks.add(e.task_id);
    } else {
      t.corrected += 1;
    }
    t.assets.add(e.asset_id);
    if (e.occurred_at) {
      if (!t.first || e.occurred_at < t.first) t.first = e.occurred_at;
      if (!t.last || e.occurred_at > t.last) t.last = e.occurred_at;
    }
  }
  return tallies;
}

/** Mean validation rate over the authors with outcomes, excluding one. Null if none. */
export function leaveOneOutMean(tallies, exclude) {
  const rates = [];
  for (const [author, t] of tallies) {
    if (author === exclude) continue;
    const n = t.validated + t.corrected;
    if (n > 0) rates.push(t.validated / n);
  }
  if (rates.length === 0) return null;
  return rates.reduce((a, b) => a + b, 0) / rates.length;
}

function round(x) { return Math.round(x * 1000) / 1000; }

/** Score one author. Always returns an object; `confidence` is null when not computable. */
export function authorConfidence(events, author, { by = "user", decoyIds = new Set(), alpha = ALPHA } = {}) {
  const tallies = authorTallies(events, { by, decoyIds });
  const t = tallies.get(author) ?? { validated: 0, corrected: 0, consumers: new Set(), tasks: new Set(), assets: new Set(), first: null, last: null };
  const n = t.validated + t.corrected;
  const base = {
    by, author,
    validated: t.validated, corrected: t.corrected,
    distinct_consumers: t.consumers.size,
    distinct_tasks: t.tasks.size,
    distinct_assets: t.assets.size,
    event_span: t.first ? { first: t.first, last: t.last } : null,
    shrinkage_alpha: alpha,
  };
  if (n === 0) {
    return { ...base, computable: false, confidence: null, raw_rate: null, prior: null, prior_source: "none: no cross-person outcomes for this author" };
  }
  const { mu, prior_source } = priorFor(tallies, author, alpha);
  return {
    ...base,
    computable: true,
    confidence: round((t.validated + alpha * mu) / (n + alpha)),
    raw_rate: round(t.validated / n),
    prior: round(mu),
    prior_source,
  };
}

/**
 * The prior μ for one author: the leave-one-out mean of the other authors'
 * validation rates, itself shrunk toward neutral by how many outcomes those
 * authors have. A pool of one other author with one outcome is not a pool
 * mean, it is one coin flip; treating it as the truth pulled every author
 * toward whichever extreme their single neighbour happened to land on
 * (one validation scored below one correction). With no other authors the
 * prior is exactly neutral, and the source string says so.
 */
export function priorFor(tallies, author, alpha = ALPHA) {
  const loo = leaveOneOutMean(tallies, author);
  let others = 0, outcomes = 0;
  for (const [a, t] of tallies) {
    const n = t.validated + t.corrected;
    if (a !== author && n > 0) { others += 1; outcomes += n; }
  }
  if (loo === null) {
    return { mu: NEUTRAL_PRIOR, prior_source: `neutral ${NEUTRAL_PRIOR}: no other author has cross-person outcomes` };
  }
  const mu = (outcomes * loo + alpha * NEUTRAL_PRIOR) / (outcomes + alpha);
  return {
    mu,
    prior_source: `leave-one-out mean of ${others} other author(s) over ${outcomes} outcome(s), shrunk toward neutral ${NEUTRAL_PRIOR}`,
  };
}

/** Score every author seen as a producer in the events, by user and by agent. */
export function allAuthors(events, opts = {}) {
  const out = { user: [], agent: [] };
  for (const by of ["user", "agent"]) {
    const seen = new Set(events.map((e) => e[KEY[by]]).filter(Boolean));
    for (const author of [...seen].sort()) out[by].push(authorConfidence(events, author, { ...opts, by }));
  }
  return out;
}

export function renderAuthors({ user, agent }) {
  const lines = ["# Author confidence", ""];
  for (const [label, rows] of [["by user", user], ["by agent", agent]]) {
    lines.push(`## ${label}`);
    if (rows.length === 0) lines.push("  (no producers seen)");
    for (const r of rows) {
      const conf = r.computable ? r.confidence.toFixed(3) : "not computable (no cross-person outcomes)";
      lines.push(`  ${r.author.padEnd(18)} ${conf.padEnd(42)} V=${r.validated} C=${r.corrected} consumers=${r.distinct_consumers} tasks=${r.distinct_tasks}`);
      if (r.computable) lines.push(`  ${"".padEnd(18)} raw ${r.raw_rate}, prior ${r.prior} (${r.prior_source}), α=${r.shrinkage_alpha}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ── CLI ──────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const files = args.filter((a) => !a.startsWith("--"));
  const decoyArg = args.find((a) => a.startsWith("--decoys="));
  if (files.length === 0) {
    console.error("usage: node author-confidence.mjs <events.jsonl ...> [--decoys=FILE] [--json]");
    process.exit(2);
  }
  const events = files.flatMap((f) => parseJsonl(readFileSync(f, "utf8")));
  const decoyIds = new Set(decoyArg ? JSON.parse(readFileSync(decoyArg.slice(9), "utf8")).map((d) => d.asset_id ?? d) : []);
  const result = allAuthors(events, { decoyIds });
  console.log(args.includes("--json") ? JSON.stringify(result, null, 2) : renderAuthors(result));
}
