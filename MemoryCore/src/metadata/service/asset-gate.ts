/**
 * Asset admission gate — the decision, as a pure function of recorded outcomes.
 *
 * Where it lives: inside the metadata module, next to the asset it decides
 * about. The decision is written onto the asset (`status`, `confidence`,
 * `metadata_json.gate`), and the product's own read paths do the rest:
 * `list-accessible` already drops `failed`; `candidate` is readable only by
 * the owner, team admins and reviewers (permission-checker); `approved` is
 * governed by visibility as before. Nothing outside Core needs to flip a
 * field for a rejected asset to leave the pool.
 *
 * Three rules, in this order, and nothing else decides:
 *
 *   reject   any `corrected` outcome with reason wrong / stale
 *   admit    at least one `validated` outcome from another person, and no
 *            such corrected
 *   pending  everything else (including a brand-new asset with no outcomes)
 *
 * The author signal never moves admit or reject. In the pending branch it
 * sets the review priority — the order a human looks at the queue — from
 * two things: the author's recent assets judged wrong, and, when a
 * context-based assessment of the author is on file, its competence for the
 * asset's domain. Counts of the author's earlier outcomes are reported as
 * they are; no prior, no shrinkage, no score derived from them.
 *
 * `confidence` on the asset is the share of this asset's cross-person
 * outcomes that validated — a description of the evidence on file, null
 * when there is none. It is not an estimate of anything.
 */

import type {
  AssetEntity,
  AssetOutcomeEntity,
  AuthorAssessmentSummary,
  GateDecision,
  GateDecisionKind,
  ReviewPriority,
} from "../types.js";

export const GATE_RULES_VERSION = "gate-rules-2026-09-07";
export const RECENT_WRONG_WINDOW_DAYS = 30;
/** `corrected` reasons that count against an asset (and its author). */
export const DOWNWEIGHT_REASONS = new Set(["wrong", "stale"]);
const CROSS_PERSON = new Set(["cross_user"]);

export interface DecideInput {
  asset: Pick<AssetEntity, "asset_id" | "owner_user_id" | "metadata_json">;
  /** Outcomes recorded for this asset. */
  outcomes: AssetOutcomeEntity[];
  /** Outcomes recorded for the author's OTHER assets (this one excluded by the caller or here). */
  authorOutcomes: AssetOutcomeEntity[];
  now?: Date;
}

function daysBetween(a: string, b: Date): number {
  return Math.abs(new Date(a).getTime() - b.getTime()) / 86_400_000;
}

/** The context-based author assessment, if one has been written onto the asset. */
export function authorAssessmentOf(metadataJson: string | null | undefined): AuthorAssessmentSummary | null {
  if (!metadataJson) return null;
  try {
    const m = JSON.parse(metadataJson) as { gate?: { author_assessment?: unknown } };
    const a = m?.gate?.author_assessment as Partial<AuthorAssessmentSummary> | undefined;
    if (!a || typeof a.competence !== "string") return null;
    return {
      competence: a.competence as AuthorAssessmentSummary["competence"],
      domain: String(a.domain ?? ""),
      assessed_at: String(a.assessed_at ?? ""),
      citations: Number(a.citations ?? 0),
    };
  } catch {
    return null;
  }
}

export function decideAsset(input: DecideInput): GateDecision {
  const now = input.now ?? new Date();
  const own = input.outcomes;
  const authorId = input.asset.owner_user_id;
  const others = input.authorOutcomes.filter((o) => o.asset_id !== input.asset.asset_id);

  const isCross = (o: AssetOutcomeEntity) => CROSS_PERSON.has(o.relation);
  const downweighting = own.filter((o) => o.state === "corrected" && o.corrected_reason != null && DOWNWEIGHT_REASONS.has(o.corrected_reason));
  const crossValidated = own.filter((o) => o.state === "validated" && isCross(o));
  const ref = (o: AssetOutcomeEntity) => ({ outcome_id: o.id, state: o.state, relation: o.relation });

  const online = {
    validated: own.filter((o) => o.state === "validated").length,
    corrected: own.filter((o) => o.state === "corrected").length,
    used: own.filter((o) => o.state === "used").length,
    cross_user_validated: crossValidated.length,
    distinct_consumers: new Set(own.map((o) => o.consumer_user_id)).size,
    distinct_tasks: new Set(own.filter((o) => o.state === "validated").map((o) => o.task_id).filter(Boolean)).size,
  };

  // Author: the outcomes of this author's other assets, cross-person only.
  const authorCross = others.filter(isCross);
  const recentWrong = [...new Set(
    others
      .filter((o) => o.state === "corrected" && o.corrected_reason != null && DOWNWEIGHT_REASONS.has(o.corrected_reason))
      .filter((o) => daysBetween(o.occurred_at, now) <= RECENT_WRONG_WINDOW_DAYS)
      .map((o) => o.asset_id),
  )].sort();
  const assessment = authorAssessmentOf(input.asset.metadata_json);
  const author = {
    user_id: authorId,
    validated: authorCross.filter((o) => o.state === "validated").length,
    corrected: authorCross.filter((o) => o.state === "corrected" && o.corrected_reason != null && DOWNWEIGHT_REASONS.has(o.corrected_reason)).length,
    distinct_consumers: new Set(authorCross.map((o) => o.consumer_user_id)).size,
    recent_wrong_asset_ids: recentWrong,
    assessment,
  };

  const reasons: string[] = [];
  let decision: GateDecisionKind;
  let evidence_refs: GateDecision["evidence_refs"] = [];

  if (downweighting.length > 0) {
    decision = "reject";
    const first = downweighting[0];
    reasons.push(`rule reject: a corrected outcome exists (reason=${first.corrected_reason}, ${downweighting.length} record(s); first ${first.occurred_at} by ${first.consumer_user_id})`);
    if (crossValidated.length > 0) {
      reasons.push(`${crossValidated.length} cross-person validated record(s) exist but do not override a corrected one`);
    }
    evidence_refs = downweighting.map(ref);
  } else if (crossValidated.length > 0) {
    decision = "admit";
    reasons.push(`rule admit: cross-person validated >= 1 (${crossValidated.length} record(s)) and no corrected`);
    evidence_refs = crossValidated.map(ref);
  } else {
    decision = "pending";
    if (own.length === 0) {
      reasons.push("cold start: no outcome recorded for this asset yet; pending by default");
    } else if (online.validated > 0) {
      reasons.push(`validated ${online.validated} time(s) but only by ${[...new Set(own.filter((o) => o.state === "validated").map((o) => o.relation))].join(", ")}; cross-person validation is required for admit`);
    } else if (online.used > 0) {
      reasons.push(`used ${online.used} time(s) with no outcome tied to those uses yet`);
    } else {
      reasons.push(`${own.length} outcome(s) on file, none of them validated or corrected(wrong/stale)`);
    }
    reasons.push("no corrected(wrong/stale) record, so reject did not trigger");
    evidence_refs = own.map(ref);
  }

  if (own.length > 0) {
    reasons.push(`reported signals: ${online.distinct_tasks} distinct task(s), ${online.distinct_consumers} distinct consumer(s); neither is a threshold`);
  }

  // Review priority: only meaningful for a pending asset; never touches admit/reject.
  let review_priority: ReviewPriority | null = null;
  if (decision === "pending") {
    if (recentWrong.length > 0) {
      review_priority = "high";
      reasons.push(`author ${authorId} has ${recentWrong.length} other asset(s) judged wrong within ${RECENT_WRONG_WINDOW_DAYS} days (${recentWrong.join(", ")}); review priority: high`);
    } else if (assessment && (assessment.competence === "low" || assessment.competence === "unknown")) {
      review_priority = "high";
      reasons.push(`context-based assessment: author competence ${assessment.competence} for "${assessment.domain}" (${assessment.citations} cited record(s), ${assessment.assessed_at}); review priority: high`);
    } else if (assessment && assessment.competence === "high") {
      review_priority = "low";
      reasons.push(`context-based assessment: author competence high for "${assessment.domain}" (${assessment.citations} cited record(s), ${assessment.assessed_at}); review priority: low`);
    } else {
      review_priority = "normal";
      reasons.push(
        assessment
          ? `context-based assessment: author competence ${assessment.competence} for "${assessment.domain}"; review priority: normal`
          : `author ${authorId}: ${author.validated} validated / ${author.corrected} corrected on other assets, no context-based assessment on file; review priority: normal`,
      );
    }
  } else {
    reasons.push(`author ${authorId}: ${author.validated} validated / ${author.corrected} corrected on other assets (reported, not used)`);
  }

  const crossTotal = own.filter(isCross).filter((o) => o.state === "validated" || (o.state === "corrected" && o.corrected_reason != null && DOWNWEIGHT_REASONS.has(o.corrected_reason))).length;
  const confidence = crossTotal === 0 ? null : Math.round((crossValidated.length / crossTotal) * 1000) / 1000;

  return {
    schema_version: "gate-decision-v2",
    rules_version: GATE_RULES_VERSION,
    asset_id: input.asset.asset_id,
    decided_at: now.toISOString(),
    decision,
    status_target: decision === "admit" ? "approved" : decision === "reject" ? "failed" : "candidate",
    confidence,
    reasons,
    evidence_refs,
    signals: { online, author },
    review_priority,
  };
}

/**
 * Merge the decision into the asset's metadata_json without disturbing other
 * keys (the context-based author assessment lives under the same `gate` key
 * and must survive a re-evaluation).
 */
export function mergeGateIntoMetadata(metadataJson: string | null | undefined, decision: GateDecision): string {
  let m: Record<string, unknown> = {};
  try {
    m = metadataJson ? (JSON.parse(metadataJson) as Record<string, unknown>) : {};
    if (!m || typeof m !== "object" || Array.isArray(m)) m = {};
  } catch {
    m = {};
  }
  const gate = (m.gate && typeof m.gate === "object" && !Array.isArray(m.gate) ? (m.gate as Record<string, unknown>) : {});
  const { author_assessment, ...rest } = gate;
  void rest;
  m.gate = { ...decision, ...(author_assessment !== undefined ? { author_assessment } : {}) };
  return JSON.stringify(m);
}
