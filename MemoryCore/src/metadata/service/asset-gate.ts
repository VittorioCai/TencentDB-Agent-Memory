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
 * when there is none. It is not an estimate of anything. The decision
 * carries the denominator (`confidence_n`) beside it.
 *
 * What counts as evidence (2026-09-08): only rows the service marked
 * trusted — submitted by a team admin or reviewer naming the consumer, with
 * the call id, the asset version and evidence attached. A plain member's
 * own report is kept on file and ignored here, in the confidence and in the
 * author statistics alike. Rows are then collapsed per call: several rows
 * about the same call (a `used`, then the `validated` that followed) are one
 * call in its latest state, so a supplement never adds weight and a retry
 * never counts twice; two real calls with the same arguments carry two call
 * ids and stay two.
 */

import type {
  AssetEntity,
  AssetOutcomeEntity,
  AuthorAssessmentSummary,
  GateDecision,
  GateDecisionKind,
  GateEffective,
  HumanReviewRecord,
  ReviewPriority,
} from "../types.js";

/**
 * gate-rules-2026-09-08b: the decision is about one version. Only trusted
 * outcomes recorded against the asset's current version decide it; a
 * later version starts as a candidate with no inherited verdict, and a
 * late correction of an earlier version does not fail the version that
 * fixed it. Human decisions are per version too (see effectiveStatus).
 */
export const GATE_RULES_VERSION = "gate-rules-2026-09-08b";
export const RECENT_WRONG_WINDOW_DAYS = 30;
/** `corrected` reasons that count against an asset (and its author). */
export const DOWNWEIGHT_REASONS = new Set(["wrong", "stale"]);
const CROSS_PERSON = new Set(["cross_user"]);

export interface DecideInput {
  asset: Pick<AssetEntity, "asset_id" | "owner_user_id" | "metadata_json"> & { version?: number; content_hash?: string | null };
  /** Outcomes recorded for this asset. */
  outcomes: AssetOutcomeEntity[];
  /** Outcomes recorded for the author's OTHER assets (this one excluded by the caller or here). */
  authorOutcomes: AssetOutcomeEntity[];
  now?: Date;
  /** Recorded on the decision when the caller restricted the outcomes to occurred_at <= asOf. */
  asOf?: string | null;
}

function daysBetween(a: string, b: Date): number {
  return Math.abs(new Date(a).getTime() - b.getTime()) / 86_400_000;
}

/** Rows the gate may read: trusted and not retracted. Everything else is reported as ignored. */
export function trustedOnly(rows: AssetOutcomeEntity[]): { kept: AssetOutcomeEntity[]; ignored: number; retracted: number } {
  const retracted = rows.filter((o) => o.retracted_at).length;
  const kept = rows.filter((o) => o.trusted === true && !o.retracted_at);
  return { kept, ignored: rows.length - kept.length - retracted, retracted };
}

/**
 * Does a row speak for the asset's current text? Only with the same version
 * and — when the asset carries a hash — the same hash. A row with no version,
 * or no hash against a hashed asset, is history that cannot claim the current
 * text (2026-09-08c: "缺版本或哈希的历史证据不能自动认领当前正文").
 */
export function boundToCurrent(o: AssetOutcomeEntity, asset: { version: number; content_hash?: string | null }): "current" | "other_version" | "unbound" {
  if (o.asset_version == null) return "unbound";
  if (o.asset_version !== asset.version) return "other_version";
  if (asset.content_hash) {
    if (!o.content_hash) return "unbound";
    if (o.content_hash !== asset.content_hash) return "other_version";
  }
  return "current";
}

/**
 * One row per call. Rows that name the same call collapse to the latest by
 * occurred_at, then created_at; a row without a call id is its own call.
 * The result is what the gate counts.
 *
 * Both of those are millisecond clocks, and two rows about one call written
 * back to back tie on both (2026-09-08e): appending `validated` and then
 * `corrected` for one call produced two rows with identical timestamps, the
 * first won, and the correction was dropped — the asset stayed admitted.
 * A tie is not evidence of order, so it is not guessed: it resolves to the
 * row that keeps the asset OUT (a corrected(wrong/stale) outranks a
 * validated or a used), and failing that to the lowest row id, so the
 * answer never depends on the order the store happened to return. Ties are
 * counted and reported in the decision, because a tie means the record does
 * not say which came last.
 *
 * The fuller fix is a monotonic per-row sequence from the store, the way
 * assets carry `revision`; this rule is what holds until there is one.
 */
export function collapseByCall(rows: AssetOutcomeEntity[]): { kept: AssetOutcomeEntity[]; ties: number } {
  const byCall = new Map<string, AssetOutcomeEntity>();
  const keepsOut = (o: AssetOutcomeEntity) => o.state === "corrected" && o.corrected_reason != null && DOWNWEIGHT_REASONS.has(o.corrected_reason);
  let ties = 0;
  const wins = (o: AssetOutcomeEntity, cur: AssetOutcomeEntity): boolean => {
    if (o.occurred_at !== cur.occurred_at) return o.occurred_at > cur.occurred_at;
    if (o.created_at !== cur.created_at) return o.created_at > cur.created_at;
    ties += 1;
    if (keepsOut(o) !== keepsOut(cur)) return keepsOut(o);
    return o.id < cur.id;
  };
  for (const o of rows) {
    const key = o.call_id ? `${o.asset_id}|call:${o.call_id}` : `${o.asset_id}|row:${o.id}`;
    const cur = byCall.get(key);
    if (!cur || wins(o, cur)) byCall.set(key, o);
  }
  const kept = [...byCall.values()].sort((a, b) => (a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { kept, ties };
}

/**
 * The context-based author assessment on the asset, if one is on file and
 * may be read for this asset at this time. An assessment is read only when
 * it was written through the assessment route (signed by Core), is about
 * this author, this version and this content, and — when the gate evaluates
 * at `asOf` — used no evidence past that time. Otherwise it is ignored and
 * the reason is returned, so the decision can say so.
 */
export function authorAssessmentOf(
  metadataJson: string | null | undefined,
  asset?: { owner_user_id?: string; version?: number; content_hash?: string | null },
  asOf?: string | null,
): { assessment: AuthorAssessmentSummary | null; ignored: string | null } {
  if (!metadataJson) return { assessment: null, ignored: null };
  let a: Partial<AuthorAssessmentSummary> | undefined;
  try {
    const m = JSON.parse(metadataJson) as { gate?: { author_assessment?: unknown } };
    a = m?.gate?.author_assessment as Partial<AuthorAssessmentSummary> | undefined;
  } catch {
    return { assessment: null, ignored: null };
  }
  if (!a || typeof a.competence !== "string") return { assessment: null, ignored: null };
  if (!a.written_by || a.schema !== "author-assessment-summary-v2") {
    return { assessment: null, ignored: "assessment on file is unsigned (written before 2026-09-08b, not through asset/gate/assessment); ignored" };
  }
  if (asset?.owner_user_id && a.author_user_id && a.author_user_id !== asset.owner_user_id) {
    return { assessment: null, ignored: `assessment is about author ${a.author_user_id}, the asset's author is ${asset.owner_user_id}; ignored` };
  }
  if (asset?.version !== undefined && a.asset_version !== undefined && a.asset_version !== asset.version) {
    return { assessment: null, ignored: `assessment was made on version ${a.asset_version}, the asset is at ${asset.version}; ignored` };
  }
  if (asset?.content_hash && a.content_hash && a.content_hash !== asset.content_hash) {
    return { assessment: null, ignored: "assessment was made on different content (hash mismatch); ignored" };
  }
  if (asOf && a.evidence_cutoff && a.evidence_cutoff > asOf) {
    return { assessment: null, ignored: `assessment used evidence up to ${a.evidence_cutoff}, after as_of ${asOf}; ignored` };
  }
  if (asOf && !a.evidence_cutoff) {
    return { assessment: null, ignored: `assessment carries no evidence_cutoff and the gate evaluates at ${asOf}; ignored` };
  }
  const acc = a.asset_claim_check && typeof a.asset_claim_check === "object" && typeof a.asset_claim_check.verdict === "string"
    ? { verdict: a.asset_claim_check.verdict, record_ids: Array.isArray(a.asset_claim_check.record_ids) ? a.asset_claim_check.record_ids.map(String) : [], strength: a.asset_claim_check.strength ?? null }
    : null;
  return {
    ignored: null,
    assessment: {
      schema: "author-assessment-summary-v2",
      competence: a.competence as AuthorAssessmentSummary["competence"],
      domain: String(a.domain ?? ""),
      assessed_at: String(a.assessed_at ?? ""),
      evidence_cutoff: a.evidence_cutoff ?? null,
      citations: Number(a.citations ?? 0),
      execution_claims: a.execution_claims ?? null,
      asset_claim_check: acc,
      author_user_id: a.author_user_id,
      asset_version: a.asset_version,
      content_hash: a.content_hash ?? null,
      pack_sha256: a.pack_sha256,
      assessment_file: a.assessment_file,
      written_by: a.written_by,
      written_at: a.written_at,
    },
  };
}

/**
 * The one verdict on an outcome row: may the gate act on it, and is it
 * about the text under assessment (2026-09-08e). Every consumer reads
 * this — the decision, the listing Core returns, the Panel, the author
 * pipeline — so there is one rule and not a copy per module that drifts.
 *
 * Three questions, in order, because they fail for different reasons:
 *   trusted    — submitted by an admin or reviewer, naming the consumer,
 *                with the call id, the version and evidence;
 *   retracted  — a reviewer took it out of the evidence, with a reason;
 *   bound      — `current` decides this text; `other_version` is about
 *                another version or another content; `unbound` carries no
 *                version, or no hash while the asset has one, and so
 *                cannot claim any particular text.
 *
 * `usable` is the conjunction: trusted, not retracted, bound to current.
 */
export function outcomeValidity(
  o: AssetOutcomeEntity,
  asset: { version?: number | null; content_hash?: string | null } | null,
): { usable: boolean; trusted: boolean; retracted: boolean; bound: "current" | "other_version" | "unbound" | "unknown"; reason: string | null } {
  const trusted = o.trusted === true;
  const retracted = !!o.retracted_at;
  const bound = asset ? boundToCurrent(o, { version: asset.version ?? 1, content_hash: asset.content_hash ?? null }) : "unknown";
  const reason = !trusted ? (o.untrusted_reason ?? "not submitted by an admin or reviewer with call id, version and evidence")
    : retracted ? `retracted by ${o.retracted_by ?? "a reviewer"} at ${o.retracted_at}${o.retract_reason ? `: ${o.retract_reason}` : ""}`
    : bound === "other_version" ? `about version ${o.asset_version ?? "?"}${o.content_hash ? ` (${o.content_hash.slice(0, 10)})` : ""}, not the text under assessment`
    : bound === "unbound" ? (o.asset_version == null ? "carries no asset version" : "carries no content hash while the asset has one")
    : null;
  return { usable: trusted && !retracted && bound === "current", trusted, retracted, bound, reason };
}

export function decideAsset(input: DecideInput): GateDecision {
  const now = input.now ?? new Date();
  const version = input.asset.version ?? 1;
  const ownTrust = trustedOnly(input.outcomes);
  const ownCollapse = collapseByCall(ownTrust.kept);
  const ownAll = ownCollapse.kept;
  // Version and content binding: only a row about this version and this
  // content decides it; rows about other versions/contents are reported;
  // rows with no version, or no hash while the asset has one, are history
  // that cannot claim the current text.
  const bind = { version, content_hash: input.asset.content_hash ?? null };
  // Read through the shared verdict, not a second copy of the rule.
  const vOf = (o: AssetOutcomeEntity) => outcomeValidity(o, bind);
  const own = ownAll.filter((o) => vOf(o).bound === "current");
  const otherVersion = ownAll.filter((o) => vOf(o).bound === "other_version").length;
  const unbound = ownAll.filter((o) => vOf(o).bound === "unbound").length;
  const authorId = input.asset.owner_user_id;
  const others = collapseByCall(trustedOnly(input.authorOutcomes).kept).kept.filter((o) => o.asset_id !== input.asset.asset_id);

  const isCross = (o: AssetOutcomeEntity) => CROSS_PERSON.has(o.relation);
  const downweighting = own.filter((o) => o.state === "corrected" && o.corrected_reason != null && DOWNWEIGHT_REASONS.has(o.corrected_reason));
  const crossValidated = own.filter((o) => o.state === "validated" && isCross(o));
  const ref = (o: AssetOutcomeEntity) => ({ outcome_id: o.id, state: o.state, relation: o.relation, call_id: o.call_id ?? null });

  const online = {
    validated: own.filter((o) => o.state === "validated").length,
    corrected: own.filter((o) => o.state === "corrected").length,
    used: own.filter((o) => o.state === "used").length,
    cross_user_validated: crossValidated.length,
    distinct_consumers: new Set(own.map((o) => o.consumer_user_id)).size,
    distinct_tasks: new Set(own.filter((o) => o.state === "validated").map((o) => o.task_id).filter(Boolean)).size,
    calls: own.length,
    untrusted_ignored: ownTrust.ignored,
    other_version: otherVersion,
    unbound_ignored: unbound,
    retracted_ignored: ownTrust.retracted,
    same_call_ties: ownCollapse.ties,
  };

  // Author: the outcomes of this author's other assets, cross-person only.
  const authorCross = others.filter(isCross);
  const recentWrong = [...new Set(
    others
      .filter((o) => o.state === "corrected" && o.corrected_reason != null && DOWNWEIGHT_REASONS.has(o.corrected_reason))
      .filter((o) => daysBetween(o.occurred_at, now) <= RECENT_WRONG_WINDOW_DAYS)
      .map((o) => o.asset_id),
  )].sort();
  const read = authorAssessmentOf(input.asset.metadata_json, { owner_user_id: authorId, version, content_hash: input.asset.content_hash ?? null }, input.asOf ?? null);
  const assessment = read.assessment;
  const author = {
    user_id: authorId,
    validated: authorCross.filter((o) => o.state === "validated").length,
    corrected: authorCross.filter((o) => o.state === "corrected" && o.corrected_reason != null && DOWNWEIGHT_REASONS.has(o.corrected_reason)).length,
    distinct_consumers: new Set(authorCross.map((o) => o.consumer_user_id)).size,
    recent_wrong_asset_ids: recentWrong,
    assessment,
    assessment_ignored: read.ignored,
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
    reasons.push(`reported signals: ${online.calls} call(s) from ${ownTrust.kept.length} trusted row(s), ${online.distinct_tasks} distinct task(s), ${online.distinct_consumers} distinct consumer(s); none is a threshold`);
  }
  if (ownTrust.ignored > 0) {
    reasons.push(`${ownTrust.ignored} row(s) on file are not trusted (not submitted by an admin or reviewer with call id, version and evidence) and were not read`);
  }
  if (otherVersion > 0) {
    reasons.push(`${otherVersion} trusted call(s) are about other versions or contents of this asset and do not decide version ${version}${bind.content_hash ? ` (${bind.content_hash.slice(0, 10)})` : ""}`);
  }
  if (unbound > 0) {
    reasons.push(`${unbound} trusted call(s) carry no version${bind.content_hash ? " or no content hash" : ""} and cannot claim the current text`);
  }
  if (ownTrust.retracted > 0) {
    reasons.push(`${ownTrust.retracted} row(s) were retracted by a reviewer and were not read`);
  }
  if (ownCollapse.ties > 0) {
    reasons.push(`${ownCollapse.ties} row(s) about a call carry the same timestamps as another row about that call, so the record does not say which came last; the one that keeps the asset out was taken`);
  }

  if (read.ignored) reasons.push(`context-based assessment: ${read.ignored}`);

  // Review priority: only meaningful for a pending asset; never touches admit/reject.
  let review_priority: ReviewPriority | null = null;
  const contradicted = assessment?.asset_claim_check?.verdict === "contradicts";
  if (decision === "pending") {
    if (contradicted) {
      review_priority = "high";
      reasons.push(`context-based assessment: the author's own records contradict this asset's claim (${(assessment?.asset_claim_check?.record_ids ?? []).join(", ") || "records cited in the assessment"}); review priority: high`);
    } else if (recentWrong.length > 0) {
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
    if (assessment) {
      reasons.push(`context-based assessment on file: competence ${assessment.competence} for "${assessment.domain}"${contradicted ? "; the author's own records contradict this asset's claim" : assessment.asset_claim_check?.verdict === "supports" ? "; the author's own records support this asset's claim" : ""} (reported, not used: the decision rests on outcomes)`);
    }
  }

  const crossTotal = own.filter(isCross).filter((o) => o.state === "validated" || (o.state === "corrected" && o.corrected_reason != null && DOWNWEIGHT_REASONS.has(o.corrected_reason))).length;
  const confidence = crossTotal === 0 ? null : Math.round((crossValidated.length / crossTotal) * 1000) / 1000;

  return {
    schema_version: "gate-decision-v2",
    rules_version: GATE_RULES_VERSION,
    asset_id: input.asset.asset_id,
    asset_version: version,
    content_hash: input.asset.content_hash ?? null,
    decided_at: now.toISOString(),
    decision,
    status_target: decision === "admit" ? "approved" : decision === "reject" ? "failed" : "candidate",
    confidence,
    confidence_n: crossTotal,
    evidence_policy: "trusted-only",
    reasons,
    evidence_refs,
    signals: { online, author },
    review_priority,
    reject_evidence_ids: downweighting.map((o) => o.id),
    // The time the row reached the registry (created_at), not the time the
    // event it describes happened: a failure that occurred before a human
    // admit but was recorded after it is evidence the reviewer never saw.
    reject_evidence_latest_at: downweighting.length ? downweighting.map((o) => o.created_at ?? o.occurred_at).sort().slice(-1)[0] : null,
    evidence_as_of: input.asOf ?? null,
  };
}

/**
 * Keys under `metadata_json.gate` that are not the decision and must survive
 * a re-evaluation: the context-based author assessment, the human review
 * history (`reviews`, append-only; `review` is the one in force, kept for
 * readers of the earlier shape — a re-evaluation used to drop it, which was
 * a bug), the owner's request for review AND the history of expired
 * requests (`review_requests` — left out until 2026-09-08f, so every
 * re-evaluation quietly dropped it and only the most recent expiry
 * survived), and the resolved `effective`.
 *
 * Anything under `gate` that a re-evaluation must not destroy belongs in
 * this list; forgetting an entry loses the data with no error.
 */
export const GATE_KEPT_KEYS = ["author_assessment", "reviews", "review", "review_request", "review_requests", "effective"] as const;

/** The human review history on an asset, oldest first. */
export function reviewsOf(gate: Record<string, unknown>): HumanReviewRecord[] {
  const arr = Array.isArray(gate.reviews) ? (gate.reviews as HumanReviewRecord[]) : [];
  // An asset reviewed before the history existed carries a single `review`.
  const legacy = gate.review && typeof gate.review === "object" && !Array.isArray(gate.review) && !("id" in (gate.review as object))
    ? [{ id: "rev-legacy", asset_version: 0, content_hash: null, ...(gate.review as Omit<HumanReviewRecord, "id" | "asset_version" | "content_hash">) }]
    : [];
  return [...legacy, ...arr];
}

/**
 * The human decision in force for this version: the latest review that is
 * not expired and was made on the asset's current version (and content,
 * when both hashes are known). A review from an earlier version is not in
 * force even if nobody expired it — the version moved on.
 */
export function activeReview(gate: Record<string, unknown>, asset: { version: number; content_hash?: string | null }): HumanReviewRecord | null {
  const rows = reviewsOf(gate).filter((r) => !r.expired_at);
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const r = rows[i];
    if (r.asset_version !== asset.version) continue;
    if (r.content_hash && asset.content_hash && r.content_hash !== asset.content_hash) continue;
    return r;
  }
  return null;
}

/**
 * What the asset's status resolves to. A human reject wins. Then an
 * effective reject: a trusted correction on this very version and content
 * keeps the asset failed even under a human admit — UNLESS that admit names
 * the correction and says why (`review.overrode`). Nothing is inferred from
 * timestamps: that a correction was on file when the reviewer clicked is no
 * record that they read it, and the row may have reached the registry after
 * the event it describes. A correction the admit did not name — one that
 * arrived later, or one nobody addressed — keeps the reject. A mistaken
 * correction is retracted through asset/outcome/retract, which keeps it on
 * file and stops the gate reading it. Then a human admit lifts a pending;
 * then the rule's admit; else candidate.
 */
export function effectiveStatus(decision: GateDecision, review: HumanReviewRecord | null, now: Date = new Date()): GateEffective {
  const at = now.toISOString();
  if (review?.decision === "reject") return { status: "failed", source: "review", review_id: review.id, reason: `human reject by ${review.by} on version ${review.asset_version}`, at };
  if (decision.decision === "reject") {
    const live = decision.reject_evidence_ids ?? [];
    const named = new Set((review?.overrode ?? []).map((o) => o.outcome_id));
    const unhandled = live.filter((id) => !named.has(id));
    // Only an admit that names every live correction lifts the reject, and
    // only when the decision says which rows those are: a decision written
    // before this field existed names none, and the reject stands.
    if (review?.decision === "admit" && live.length > 0 && unhandled.length === 0) {
      return { status: "approved", source: "review", review_id: review.id, at,
        reason: `human admit by ${review.by} on version ${review.asset_version}, overruling ${live.length} corrected outcome(s) named in the review: ${(review.overrode ?? []).map((o) => `${o.outcome_id} (${o.reason})`).join("; ")}` };
    }
    return { status: "failed", source: "rule", review_id: review?.id ?? null, at,
      reason: review?.decision === "admit"
        ? `rule reject: the human admit by ${review.by} (${review.at}) did not name ${unhandled.length || live.length} corrected outcome(s)${unhandled.length ? ` (${unhandled.join(", ")})` : " (the decision on file records none)"}; the review stays on file`
        : "rule reject (corrected outcome)" };
  }
  if (review?.decision === "admit") return { status: "approved", source: "review", review_id: review.id, reason: `human admit by ${review.by} on version ${review.asset_version}`, at };
  if (decision.decision === "admit") return { status: "approved", source: "rule", review_id: null, reason: "rule admit (cross-person validated, no corrected)", at };
  return { status: "candidate", source: "rule", review_id: null, reason: "rule pending; no human decision in force for this version", at };
}

/**
 * Mark every review in force as expired, with the reason, and the owner's
 * pending review request too (2026-09-08c): the request granted reviewers
 * access to one text; a new text needs a new request. History is kept in
 * `review_requests`. Returns the new gate object.
 */
export function expireReviews(gate: Record<string, unknown>, reason: string, now: Date = new Date()): Record<string, unknown> {
  const rows = reviewsOf(gate).map((r) => (r.expired_at ? r : { ...r, expired_at: now.toISOString(), expired_reason: reason }));
  const { review: _legacy, ...rest } = gate;
  void _legacy;
  const out: Record<string, unknown> = { ...rest, reviews: rows, review: null };
  const req = gate.review_request && typeof gate.review_request === "object" ? (gate.review_request as Record<string, unknown>) : null;
  if (req && req.requested_at && !req.withdrawn_at && !req.expired_at) {
    const expired = { ...req, expired_at: now.toISOString(), expired_reason: reason };
    out.review_request = expired;
    out.review_requests = [...(Array.isArray(gate.review_requests) ? (gate.review_requests as unknown[]) : []), expired];
  }
  return out;
}

/**
 * Merge the decision into the asset's metadata_json without disturbing other
 * keys. Everything in GATE_KEPT_KEYS is carried over; the rest of the
 * previous decision is replaced. `review` is refreshed to the review in
 * force (or null) and `effective` to what was resolved.
 */
export function mergeGateIntoMetadata(metadataJson: string | null | undefined, decision: GateDecision, resolved?: { effective: GateEffective; review: HumanReviewRecord | null }): string {
  let m: Record<string, unknown> = {};
  try {
    m = metadataJson ? (JSON.parse(metadataJson) as Record<string, unknown>) : {};
    if (!m || typeof m !== "object" || Array.isArray(m)) m = {};
  } catch {
    m = {};
  }
  const gate = (m.gate && typeof m.gate === "object" && !Array.isArray(m.gate) ? (m.gate as Record<string, unknown>) : {});
  const kept: Record<string, unknown> = {};
  for (const k of GATE_KEPT_KEYS) if (gate[k] !== undefined) kept[k] = gate[k];
  if (kept.reviews === undefined && reviewsOf(gate).length > 0) kept.reviews = reviewsOf(gate);
  m.gate = { ...decision, ...kept, ...(resolved ? { review: resolved.review, effective: resolved.effective } : {}) };
  return JSON.stringify(m);
}

/** The `gate` object on an asset, or an empty one. */
export function gateOf(metadataJson: string | null | undefined): Record<string, unknown> {
  try {
    const m = metadataJson ? (JSON.parse(metadataJson) as Record<string, unknown>) : {};
    const g = m && typeof m === "object" && !Array.isArray(m) ? m.gate : undefined;
    return g && typeof g === "object" && !Array.isArray(g) ? (g as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
