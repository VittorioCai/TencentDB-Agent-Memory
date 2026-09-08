import { beforeEach, describe, expect, it, vi } from "vitest";
import { SqliteMetadataStore } from "../store/sqlite-adapter.js";
import { MetadataService } from "./metadata-service.js";
import { decideAsset, mergeGateIntoMetadata, collapseByCall, effectiveStatus, activeReview, expireReviews, authorAssessmentOf, GATE_RULES_VERSION } from "./asset-gate.js";
import type { HumanReviewRecord } from "../types.js";
import type { AssetOutcomeEntity, AssetEntity, GateDecision } from "../types.js";
import type { V3AuthContext } from "../router/auth.js";

/**
 * The admission gate inside Core. Pinned here:
 *
 *   1. the decision is a pure function of recorded outcomes — reject on
 *      corrected(wrong/stale), admit on a cross-person validated, pending
 *      otherwise — and the author signal only orders the review queue;
 *   2. only trusted rows decide (2026-09-08): submitted by an admin or
 *      reviewer naming the consumer, with the call id, the asset version
 *      and evidence. A member's own report is kept and ignored. Rows about
 *      the same call collapse to the latest, so a supplement or a retry
 *      never adds weight;
 *   3. the decision lands on the asset's own record (status / confidence /
 *      metadata_json.gate), and the product's read paths do the admitting
 *      and the dropping: the model's path (purpose=use) sees approved
 *      assets only, the owner's own candidate included; the human's path
 *      (manage) shows candidates and rejections to the owner, admins and
 *      reviewers — a private candidate to reviewers only once submitted;
 *   4. the audit fields cannot be written through asset create/update by a
 *      member, and the gate object on file survives any update;
 *   5. a skill enters the pool as a candidate, with the cold-start decision
 *      already written; a re-evaluation keeps the human review.
 */

const T0 = new Date("2026-09-07T12:00:00Z");
let seq = 0;
function outcome(over: Partial<AssetOutcomeEntity>): AssetOutcomeEntity {
  seq += 1;
  return {
    id: `o${seq}`, team_id: "team", asset_id: "skl-x", asset_version: 2,
    state: "validated", relation: "cross_user", corrected_reason: null,
    consumer_user_id: "usr-b", consumer_agent_id: null, task_id: "task-1", run_id: null,
    source: "test", evidence_json: "{\"proof\":1}", call_id: null, event_id: null,
    trusted: true, untrusted_reason: null, submitted_by_user_id: "usr-admin", submitted_role: "admin",
    content_hash: "h2", retracted_at: null, retracted_by: null, retract_reason: null,
    occurred_at: "2026-09-06T10:00:00Z", created_at: "2026-09-06T10:00:00Z",
    ...over,
  };
}
const asset = { asset_id: "skl-x", owner_user_id: "usr-a", metadata_json: "{}", version: 2, content_hash: "h2" };

describe("decideAsset: three rules, in order", () => {
  it("rejects on a corrected(wrong) outcome even when cross-person validations exist", () => {
    const d = decideAsset({ asset, outcomes: [outcome({}), outcome({ state: "corrected", corrected_reason: "wrong" })], authorOutcomes: [], now: T0 });
    expect(d.decision).toBe("reject");
    expect(d.status_target).toBe("failed");
    expect(d.evidence_refs.map((r) => r.state)).toEqual(["corrected"]);
    expect(d.reasons.join("\n")).toMatch(/do not override a corrected one/);
    expect(d.confidence).toBe(0.5); // 1 validated of 2 cross-person calls on file
    expect(d.confidence_n).toBe(2);
    expect(d.evidence_policy).toBe("trusted-only");
    expect(d.rules_version).toBe(GATE_RULES_VERSION);
  });

  it("does not reject on corrected(other): only wrong and stale count against an asset", () => {
    const d = decideAsset({ asset, outcomes: [outcome({}), outcome({ state: "corrected", corrected_reason: "other" })], authorOutcomes: [], now: T0 });
    expect(d.decision).toBe("admit");
  });

  it("admits on one cross-person validated with no corrected; a self validation is not enough", () => {
    expect(decideAsset({ asset, outcomes: [outcome({})], authorOutcomes: [], now: T0 }).decision).toBe("admit");
    const self = decideAsset({ asset, outcomes: [outcome({ relation: "self", consumer_user_id: "usr-a" })], authorOutcomes: [], now: T0 });
    expect(self.decision).toBe("pending");
    expect(self.reasons.join("\n")).toMatch(/cross-person validation is required/);
    expect(self.confidence).toBeNull(); // no cross-person outcome to describe
    expect(self.confidence_n).toBe(0);
  });

  it("cold start is pending with a review priority, never admit or reject", () => {
    const d = decideAsset({ asset, outcomes: [], authorOutcomes: [], now: T0 });
    expect(d.decision).toBe("pending");
    expect(d.status_target).toBe("candidate");
    expect(d.review_priority).toBe("normal");
    expect(d.confidence).toBeNull();
    expect(d.reasons[0]).toMatch(/cold start/);
  });

  it("the author's recent wrong asset raises the priority to high, and is reported by id", () => {
    const wrongElsewhere = outcome({ asset_id: "skl-y", state: "corrected", corrected_reason: "wrong", occurred_at: "2026-09-01T00:00:00Z" });
    const d = decideAsset({ asset, outcomes: [], authorOutcomes: [wrongElsewhere], now: T0 });
    expect(d.review_priority).toBe("high");
    expect(d.signals.author.recent_wrong_asset_ids).toEqual(["skl-y"]);
    // Outside the window it no longer counts as recent.
    const old = decideAsset({ asset, outcomes: [], authorOutcomes: [outcome({ ...wrongElsewhere, occurred_at: "2026-06-01T00:00:00Z" })], now: T0 });
    expect(old.review_priority).toBe("normal");
    expect(old.signals.author.corrected).toBe(1); // still reported
  });

  it("a context-based assessment on file sets the priority; it never moves admit/reject", () => {
    const withAssessment = (competence: string) => ({
      ...asset,
      metadata_json: JSON.stringify({ gate: { author_assessment: signed({ competence }) } }),
    });
    expect(decideAsset({ asset: withAssessment("low"), outcomes: [], authorOutcomes: [], now: T0 }).review_priority).toBe("high");
    expect(decideAsset({ asset: withAssessment("unknown"), outcomes: [], authorOutcomes: [], now: T0 }).review_priority).toBe("high");
    expect(decideAsset({ asset: withAssessment("high"), outcomes: [], authorOutcomes: [], now: T0 }).review_priority).toBe("low");
    expect(decideAsset({ asset: withAssessment("medium"), outcomes: [], authorOutcomes: [], now: T0 }).review_priority).toBe("normal");
    // With a validated outcome the assessment changes nothing about the decision.
    const admitted = decideAsset({ asset: withAssessment("low"), outcomes: [outcome({})], authorOutcomes: [], now: T0 });
    expect(admitted.decision).toBe("admit");
    expect(admitted.review_priority).toBeNull();
  });

  it("the author's own asset is not counted as another asset", () => {
    const d = decideAsset({ asset, outcomes: [], authorOutcomes: [outcome({ asset_id: "skl-x", state: "corrected", corrected_reason: "wrong" })], now: T0 });
    expect(d.signals.author.recent_wrong_asset_ids).toEqual([]);
  });
});

/** A signed assessment bound to the fixture asset (author usr-a, version 2, hash h2). */
const signed = (over: Record<string, unknown> = {}) => ({
  schema: "author-assessment-summary-v2", competence: "medium", domain: "bridge address", assessed_at: "2026-09-08T12:00:00Z", evidence_cutoff: "2026-09-06T08:47:33Z",
  citations: 3, author_user_id: "usr-a", asset_version: 2, content_hash: "h2", written_by: "usr-r", written_at: "2026-09-08T12:00:01Z", ...over,
});

describe("authorAssessmentOf: only a signed, bound assessment is read", () => {
  const a = { owner_user_id: "usr-a", version: 2, content_hash: "h2" };
  it("reads a signed assessment whose binding matches", () => {
    const r = authorAssessmentOf(JSON.stringify({ gate: { author_assessment: signed({}) } }), a, "2026-09-06T08:47:33Z");
    expect(r.ignored).toBeNull();
    expect(r.assessment?.competence).toBe("medium");
    expect(r.assessment?.evidence_cutoff).toBe("2026-09-06T08:47:33Z");
  });
  it("ignores, with the reason, an unsigned one, another author's, another version's, other content, or evidence past as_of", () => {
    const of = (over: Record<string, unknown>, asOf: string | null = null) => authorAssessmentOf(JSON.stringify({ gate: { author_assessment: signed(over) } }), a, asOf);
    expect(of({ written_by: undefined, schema: undefined }).ignored).toMatch(/unsigned/);
    expect(of({ author_user_id: "usr-z" }).ignored).toMatch(/about author usr-z/);
    expect(of({ asset_version: 1 }).ignored).toMatch(/made on version 1, the asset is at 2/);
    expect(of({ content_hash: "h1" }).ignored).toMatch(/hash mismatch/);
    expect(of({ evidence_cutoff: "2026-09-07T10:00:00Z" }, "2026-09-06T08:47:33Z").ignored).toMatch(/after as_of/);
    expect(of({ evidence_cutoff: null }, "2026-09-06T08:47:33Z").ignored).toMatch(/no evidence_cutoff/);
    expect(of({ evidence_cutoff: "2026-09-07T10:00:00Z" }, null).ignored).toBeNull(); // no as_of: the cutoff is not restricted
    const d = decideAsset({ asset: { ...asset, metadata_json: JSON.stringify({ gate: { author_assessment: signed({ asset_version: 1 }) } }) }, outcomes: [], authorOutcomes: [], now: T0 });
    expect(d.signals.author.assessment).toBeNull();
    expect(d.signals.author.assessment_ignored).toMatch(/version 1/);
    expect(d.reasons.join("\n")).toMatch(/context-based assessment: assessment was made on version 1/);
    expect(d.review_priority).toBe("normal");
  });
});

describe("decideAsset: what counts as evidence", () => {
  it("untrusted rows are ignored and reported, for the asset and for the author alike", () => {
    const d = decideAsset({
      asset,
      outcomes: [outcome({ trusted: false, untrusted_reason: "submitted by a member" })],
      authorOutcomes: [outcome({ asset_id: "skl-y", state: "corrected", corrected_reason: "wrong", trusted: false })],
      now: T0,
    });
    expect(d.decision).toBe("pending");
    expect(d.signals.online.untrusted_ignored).toBe(1);
    expect(d.signals.online.calls).toBe(0);
    expect(d.reasons.join("\n")).toMatch(/1 row\(s\) on file are not trusted/);
    expect(d.review_priority).toBe("normal"); // the untrusted corrected did not count against the author
    expect(d.signals.author.recent_wrong_asset_ids).toEqual([]);
  });

  it("rows about the same call collapse to the latest: a supplement adds no weight, a retry counts once", () => {
    const rows = [
      outcome({ call_id: "call-1", state: "used", occurred_at: "2026-09-06T10:00:00Z" }),
      outcome({ call_id: "call-1", state: "validated", occurred_at: "2026-09-06T10:00:05Z" }),
      outcome({ call_id: "call-1", state: "validated", occurred_at: "2026-09-06T10:00:05Z", created_at: "2026-09-06T10:00:06Z" }),
    ];
    const calls = collapseByCall(rows);
    expect(calls).toHaveLength(1);
    expect(calls[0].state).toBe("validated");
    const d = decideAsset({ asset, outcomes: rows, authorOutcomes: [], now: T0 });
    expect(d.signals.online.calls).toBe(1);
    expect(d.signals.online.validated).toBe(1);
    expect(d.signals.online.used).toBe(0);
    expect(d.confidence_n).toBe(1);
    expect(d.evidence_refs).toEqual([{ outcome_id: rows[2].id, state: "validated", relation: "cross_user", call_id: "call-1" }]);
  });

  it("two real calls with the same arguments carry two call ids and stay two; a row without a call id is its own call", () => {
    const rows = [outcome({ call_id: "call-1" }), outcome({ call_id: "call-2" }), outcome({})];
    const d = decideAsset({ asset, outcomes: rows, authorOutcomes: [], now: T0 });
    expect(d.signals.online.calls).toBe(3);
    expect(d.confidence_n).toBe(3);
  });

  it("a later corrected on the same call replaces an earlier validated", () => {
    const rows = [
      outcome({ call_id: "call-1", state: "validated", occurred_at: "2026-09-06T10:00:00Z" }),
      outcome({ call_id: "call-1", state: "corrected", corrected_reason: "wrong", occurred_at: "2026-09-06T11:00:00Z" }),
    ];
    const d = decideAsset({ asset, outcomes: rows, authorOutcomes: [], now: T0 });
    expect(d.decision).toBe("reject");
    expect(d.signals.online.validated).toBe(0);
  });
});

describe("decideAsset: the decision is about one version", () => {
  it("only outcomes of the asset's current version decide it; others are reported", () => {
    const d = decideAsset({ asset, outcomes: [outcome({ asset_version: 1 }), outcome({ asset_version: 1, state: "corrected", corrected_reason: "wrong" })], authorOutcomes: [], now: T0 });
    expect(d.decision).toBe("pending"); // version 2 has no evidence of its own
    expect(d.asset_version).toBe(2);
    expect(d.content_hash).toBe("h2");
    expect(d.signals.online.other_version).toBe(2);
    expect(d.signals.online.calls).toBe(0);
    expect(d.reasons.join("\n")).toMatch(/2 trusted call\(s\) are about other versions .* do not decide version 2/);
  });

  it("a late correction of the earlier version does not fail the version that fixed it", () => {
    const d = decideAsset({ asset, outcomes: [outcome({ asset_version: 2 }), outcome({ asset_version: 1, state: "corrected", corrected_reason: "wrong", occurred_at: "2026-09-07T00:00:00Z" })], authorOutcomes: [], now: T0 });
    expect(d.decision).toBe("admit");
    expect(d.signals.online.other_version).toBe(1);
  });

  it("a row with no version, or no hash while the asset has one, is history that cannot claim the current text", () => {
    const d = decideAsset({ asset, outcomes: [outcome({ asset_version: null }), outcome({ content_hash: null })], authorOutcomes: [], now: T0 });
    expect(d.decision).toBe("pending");
    expect(d.signals.online.unbound_ignored).toBe(2);
    expect(d.reasons.join("\n")).toMatch(/cannot claim the current text/);
  });

  it("the same version with different content is another content: it does not decide this one", () => {
    const d = decideAsset({ asset, outcomes: [outcome({ content_hash: "h2-old" })], authorOutcomes: [], now: T0 });
    expect(d.decision).toBe("pending");
    expect(d.signals.online.other_version).toBe(1);
    const same = decideAsset({ asset, outcomes: [outcome({ content_hash: "h2" })], authorOutcomes: [], now: T0 });
    expect(same.decision).toBe("admit");
  });

  it("a retracted row is kept on file and not read", () => {
    const d = decideAsset({ asset, outcomes: [outcome({ state: "corrected", corrected_reason: "wrong", retracted_at: "2026-09-08T00:00:00Z", retracted_by: "usr-r", retract_reason: "the probe used the wrong port" }), outcome({})], authorOutcomes: [], now: T0 });
    expect(d.decision).toBe("admit");
    expect(d.signals.online.retracted_ignored).toBe(1);
    expect(d.reasons.join("\n")).toMatch(/retracted by a reviewer/);
  });
});

describe("effectiveStatus and the review in force", () => {
  const rev = (over: Partial<HumanReviewRecord>): HumanReviewRecord => ({ id: "rev-1", decision: "admit", status: "approved", by: "usr-r", at: "2026-09-08T00:00:00Z", note: null, asset_version: 2, content_hash: "h2", ...over });
  const rule = (kind: "admit" | "reject" | "pending") => decideAsset({ asset, outcomes: kind === "admit" ? [outcome({})] : kind === "reject" ? [outcome({ state: "corrected", corrected_reason: "wrong" })] : [], authorOutcomes: [], now: T0 });

  it("precedence: a human reject; an effective reject the admit did not name; a human admit that names every correction; the rule's admit; else candidate", () => {
    expect(effectiveStatus(rule("admit"), rev({ decision: "reject", status: "failed" }), T0)).toMatchObject({ status: "failed", source: "review", review_id: "rev-1" });
    // An admit dated after the correction does NOT lift the reject on its
    // own (2026-09-08d): being on file is no record that the reviewer read
    // it, and the row may have been recorded after the event it describes.
    const rejected = rule("reject");
    const bare = effectiveStatus(rejected, rev({}), T0);
    expect(bare).toMatchObject({ status: "failed", source: "rule", review_id: "rev-1" });
    expect(bare.reason).toMatch(/did not name 1 corrected outcome/);
    // Naming it, with a reason, is what overrules it.
    const ids = rejected.reject_evidence_ids ?? [];
    expect(ids.length).toBe(1);
    const overruled = effectiveStatus(rejected, rev({ overrode: [{ outcome_id: ids[0], reason: "the probe used the wrong port; verified by hand" }] }), T0);
    expect(overruled).toMatchObject({ status: "approved", source: "review", review_id: "rev-1" });
    expect(overruled.reason).toMatch(/overruling 1 corrected outcome\(s\) named in the review/);
    // Naming a different row does not: the live correction is still unhandled.
    const wrongId = effectiveStatus(rejected, rev({ overrode: [{ outcome_id: "some-other-row", reason: "x" }] }), T0);
    expect(wrongId).toMatchObject({ status: "failed", source: "rule" });
    expect(effectiveStatus(rule("pending"), rev({}), T0)).toMatchObject({ status: "approved", source: "review" });
    expect(effectiveStatus(rule("admit"), null, T0)).toMatchObject({ status: "approved", source: "rule", review_id: null });
    expect(effectiveStatus(rule("pending"), null, T0)).toMatchObject({ status: "candidate", source: "rule" });
  });

  it("a decision written before the ids existed names no evidence: an admit cannot lift its reject", () => {
    const legacy = { ...rule("reject"), reject_evidence_ids: undefined } as unknown as GateDecision;
    const e = effectiveStatus(legacy, rev({ overrode: [{ outcome_id: "anything", reason: "x" }] }), T0);
    expect(e).toMatchObject({ status: "failed", source: "rule" });
    expect(e.reason).toMatch(/the decision on file records none/);
  });

  it("a correction whose event predates the admit but reached the registry after it is not evidence the reviewer could have seen", () => {
    // occurred 08:00, recorded 10:00, admit at 09:00 — the old rule read
    // occurred_at and called this one "already on file".
    const late = decideAsset({ asset, outcomes: [outcome({ state: "corrected", corrected_reason: "wrong", occurred_at: "2026-09-07T08:00:00.000Z", created_at: "2026-09-07T10:00:00.000Z" })], authorOutcomes: [], now: T0 });
    expect(late.reject_evidence_latest_at).toBe("2026-09-07T10:00:00.000Z"); // recorded, not occurred
    const e = effectiveStatus(late, rev({ at: "2026-09-07T09:00:00.000Z" }), T0);
    expect(e).toMatchObject({ status: "failed", source: "rule" });
  });

  it("a review is in force only for the asset's current version and content; expired ones never are", () => {
    const gate = { reviews: [rev({ id: "old", asset_version: 1 }), rev({ id: "cur" }), rev({ id: "exp", expired_at: "2026-09-08T01:00:00Z" })] };
    expect(activeReview(gate, { version: 2, content_hash: "h2" })?.id).toBe("cur");
    expect(activeReview(gate, { version: 3, content_hash: "h3" })).toBeNull();
    expect(activeReview(gate, { version: 2, content_hash: "h2-changed" })).toBeNull();
    expect(activeReview({ review: { decision: "admit", status: "approved", by: "usr-r", at: "t", note: null } }, { version: 0 })?.id).toBe("rev-legacy");
    const expired = expireReviews(gate, "asset version changed from 2 to 3", T0);
    expect((expired.reviews as HumanReviewRecord[]).every((r) => r.expired_at)).toBe(true);
    expect((expired.reviews as HumanReviewRecord[])[1].expired_reason).toMatch(/2 to 3/);
    expect((expired.reviews as HumanReviewRecord[])[2].expired_reason).toBeUndefined(); // already expired: untouched
  });
});

describe("mergeGateIntoMetadata", () => {
  it("writes gate beside other keys and keeps the author assessment, the human review and the review request", () => {
    const d = decideAsset({ asset, outcomes: [], authorOutcomes: [], now: T0 });
    const before = JSON.stringify({ other: 1, gate: { decision: "admit", stale_key: true, author_assessment: { competence: "high" }, reviews: [{ id: "rev-1", decision: "admit", by: "usr-r", asset_version: 2 }], review: { id: "rev-1", decision: "admit", by: "usr-r", asset_version: 2 }, review_request: { requested_at: "2026-09-08T00:00:00Z" } } });
    const after = JSON.parse(mergeGateIntoMetadata(before, d)) as Record<string, any>;
    expect(after.other).toBe(1);
    expect(after.gate.decision).toBe("pending");
    expect(after.gate.stale_key).toBeUndefined();
    expect(after.gate.author_assessment.competence).toBe("high");
    expect(after.gate.reviews).toHaveLength(1);
    expect(after.gate.review.by).toBe("usr-r");
    expect(after.gate.review_request.requested_at).toBe("2026-09-08T00:00:00Z");
    expect(JSON.parse(mergeGateIntoMetadata("not json", d)).gate.decision).toBe("pending");
  });
});

// ── Store + service + permissions, on an in-memory SQLite ──

const ctx = (userId: string): V3AuthContext => ({ token: "", userId, isAdmin: false, isSystemAdmin: false });

/** What a trusted submission looks like: an admin/reviewer names the consumer and attaches the call, the version and evidence. */
const trustedBody = (assetId: string, consumer: string, over: Record<string, unknown> = {}) => ({
  team_id: "", asset_id: assetId, state: "validated" as const, consumer_user_id: consumer, asset_version: 1,
  call_id: `call-${++seq}`, evidence_json: JSON.stringify({ proof_refs: ["capture:1"] }), source: "test", ...over,
});
const gateOfAsset = (a: AssetEntity): Record<string, unknown> => { try { return (JSON.parse(a.metadata_json || "{}").gate ?? {}) as Record<string, unknown>; } catch { return {}; } };
/** A review request body naming what the reviewer read. */
const seen = (a: { version: number; content_hash?: string | null; revision?: number }) => ({ expected_version: a.version, expected_content_hash: a.content_hash ?? null, expected_revision: a.revision ?? 0 });

describe("the gate on the asset record", () => {
  let store: SqliteMetadataStore;
  let svc: MetadataService;
  let team: string;
  let a: string; // author
  let b: string; // consumer, plain member
  let r: string; // reviewer
  let admin: string; // team owner → admin
  let n = 0;

  beforeEach(async () => {
    store = new SqliteMetadataStore(":memory:");
    store.init();
    svc = new MetadataService(store, "test");
    n += 1;
    const mk = async (name: string) => (await svc.createNormalUser({ username: `${name}-${n}-${Date.now()}` })).user_id;
    admin = await mk("admin"); a = await mk("a"); b = await mk("b"); r = await mk("r");
    team = (await store.createTeam({ name: "t", owner_user_id: admin })).team_id;
    await store.addTeamMember({ team_id: team, user_id: a, role: "member" });
    await store.addTeamMember({ team_id: team, user_id: b, role: "member" });
    await store.addTeamMember({ team_id: team, user_id: r, role: "reviewer" });
  });

  async function candidateSkill(id = "skl-1", owner = a, visibility: AssetEntity["visibility"] = "team", status: AssetEntity["status"] = "candidate"): Promise<AssetEntity> {
    return store.createAsset({ asset_id: id, team_id: team, asset_type: "skill", name: id, owner_user_id: owner, source_type: "test", visibility, status });
  }
  async function visibleTo(userId: string, purpose?: "use" | "manage"): Promise<string[]> {
    const page = await svc.listAccessibleAssets({ user_id: userId, team_id: team, action: "read", purpose });
    return page.items.map((x) => x.asset_id).sort();
  }
  const trusted = async (assetId: string, consumer: string, over: Record<string, unknown> = {}) => {
    const cur = await store.getAssetById(assetId);
    // A trusted row names the content it is about when the asset carries a hash, and the version on file unless told otherwise.
    return svc.appendAssetOutcomeForCaller({ ...trustedBody(assetId, consumer, { asset_version: cur?.version ?? 1, content_hash: cur?.content_hash ?? null, ...over }), team_id: team }, ctx(admin));
  };

  it("outcomes are appended and listed, including by the author's ownership and by trust", async () => {
    await candidateSkill("skl-1", a);
    await candidateSkill("skl-2", a);
    await store.appendAssetOutcome({ team_id: team, asset_id: "skl-1", state: "validated", relation: "cross_user", consumer_user_id: b, task_id: "t1", trusted: true, event_id: "e1" });
    await store.appendAssetOutcome({ team_id: team, asset_id: "skl-2", state: "corrected", corrected_reason: "wrong", relation: "cross_user", consumer_user_id: b, trusted: false, untrusted_reason: "no call_id" });
    expect((await store.listAssetOutcomes({ team_id: team, asset_id: "skl-1" })).total).toBe(1);
    expect((await store.listAssetOutcomes({ team_id: team, owner_user_id: a })).total).toBe(2);
    expect((await store.listAssetOutcomes({ team_id: team, trusted: true })).total).toBe(1);
    expect((await store.listAssetOutcomes({ team_id: team, trusted: false })).items[0].untrusted_reason).toBe("no call_id");
    expect((await store.getAssetOutcomeByEvent(team, "e1"))?.asset_id).toBe("skl-1");
    expect(await store.getAssetOutcomeByEvent(team, "nope")).toBeNull();
    const row = (await store.listAssetOutcomes({ team_id: team, asset_id: "skl-1" })).items[0];
    expect(row.corrected_reason).toBeNull();
    expect(row.relation).toBe("cross_user");
    expect(row.trusted).toBe(true);
  });

  it("a candidate is visible to its owner, a reviewer and an admin on the management path — not to a plain member", async () => {
    await candidateSkill();
    expect(await visibleTo(a)).toEqual(["skl-1"]);
    expect(await visibleTo(r)).toEqual(["skl-1"]);
    expect(await visibleTo(admin)).toEqual(["skl-1"]);
    expect(await visibleTo(b)).toEqual([]);
    const perm = await svc.checkAssetPermission({ user_id: b, asset_id: "skl-1", action: "read" });
    expect(perm).toEqual({ allowed: false, reason: "status_candidate" });
  });

  it("on the model's path (purpose=use) only an approved asset passes — the owner's own candidate does not", async () => {
    await candidateSkill("skl-1", a);
    await candidateSkill("skl-ok", a, "team", "approved");
    await candidateSkill("skl-draft", a, "team", "draft");
    expect(await visibleTo(a, "use")).toEqual(["skl-ok"]);
    expect(await visibleTo(r, "use")).toEqual(["skl-ok"]);
    expect(await visibleTo(a, "manage")).toEqual(["skl-1", "skl-draft", "skl-ok"]);
    expect(await svc.checkAssetPermission({ user_id: a, asset_id: "skl-1", action: "read", purpose: "use" })).toEqual({ allowed: false, reason: "not_admitted:candidate" });
    expect((await svc.checkAssetPermission({ user_id: a, asset_id: "skl-ok", action: "read", purpose: "use" })).allowed).toBe(true);
    // A read on the model's path says which row it is about to serve; the
    // registry answers about that row (2026-09-08d).
    const ok = (await store.getAssetById("skl-ok"))!;
    const served = { "skl-ok": { version: ok.version, content_hash: ok.content_hash ?? null } };
    const reads = await svc.decideAssetReads({ user_id: b, asset_ids: ["skl-1", "skl-ok", "skl-unregistered"], purpose: "use", served });
    expect(reads.get("skl-1")?.allowed).toBe(false);
    expect(reads.get("skl-ok")?.allowed).toBe(true);
    expect(reads.get("skl-unregistered")).toEqual({ allowed: false, reason: "unregistered" });
    // A read that cannot say which version it is serving is refused, not waved through.
    const blind = await svc.decideAssetReads({ user_id: b, asset_ids: ["skl-ok"], purpose: "use" });
    expect(blind.get("skl-ok")).toEqual({ allowed: false, reason: "unbound_read:the served version is not known" });
  });

  it("an older version whose body hashes the same as the approved one is still a different row: the read is refused and the registry is not rolled back", async () => {
    await candidateSkill("skl-roll", a, "team", "approved");
    await store.updateAsset("skl-roll", { version: 3, content_hash: "same-body" });
    const now = (await store.getAssetById("skl-roll"))!;
    expect(now.version).toBe(3);
    // v2 carries the same body hash (only a resource file differed): equality, not "not newer".
    const back = await svc.decideAssetReads({ user_id: b, asset_ids: ["skl-roll"], purpose: "use", served: { "skl-roll": { version: 2, content_hash: "same-body" } } });
    expect(back.get("skl-roll")).toEqual({ allowed: false, reason: "version_mismatch:registry=3,served=2" });
    expect((await store.getAssetById("skl-roll"))?.version).toBe(3); // no rollback
    // The registry holds a hash; a served row that carries none cannot claim it.
    const noHash = await svc.decideAssetReads({ user_id: b, asset_ids: ["skl-roll"], purpose: "use", served: { "skl-roll": { version: 3, content_hash: null } } });
    expect(noHash.get("skl-roll")?.reason).toMatch(/^unbound_read:the registry holds a content hash/);
  });

  it("a trusted cross-person validated outcome admits the asset, and the plain member can now read it", async () => {
    await candidateSkill();
    const res = await trusted("skl-1", b, { task_id: "t1" });
    expect(res.outcome.trusted).toBe(true);
    expect(res.outcome.relation).toBe("cross_user"); // derived: consumer ≠ owner
    expect(res.outcome.submitted_by_user_id).toBe(admin);
    expect(res.gate?.decision).toBe("admit");
    const after = await store.getAssetById("skl-1");
    expect(after?.status).toBe("approved");
    expect(after?.confidence).toBe(1);
    expect(JSON.parse(after!.metadata_json).gate.decision).toBe("admit");
    expect(await visibleTo(b)).toEqual(["skl-1"]);
    expect(await visibleTo(b, "use")).toEqual(["skl-1"]);
  });

  it("a plain member's own report is recorded, marked untrusted with the reasons, and moves nothing", async () => {
    await candidateSkill();
    const res = await svc.appendAssetOutcomeForCaller({ team_id: team, asset_id: "skl-1", state: "validated", task_id: "t1", source: "test" }, ctx(b));
    expect(res.outcome.trusted).toBe(false);
    expect(res.outcome.untrusted_reason).toMatch(/submitted by a member/);
    expect(res.outcome.untrusted_reason).toMatch(/no call_id/);
    expect(res.outcome.untrusted_reason).toMatch(/no asset_version/);
    expect(res.outcome.untrusted_reason).toMatch(/no evidence/);
    expect(res.gate).toBeNull();
    expect((await store.getAssetById("skl-1"))?.status).toBe("candidate");
    // Nor does it move a later evaluation: the row is on file and ignored.
    const later = await svc.evaluateAssetGate("skl-1", { apply: true });
    expect(later.decision.decision).toBe("pending");
    expect(later.decision.signals.online.untrusted_ignored).toBe(1);
  });

  it("an admin's submission is untrusted too when it lacks the call id, the version or evidence", async () => {
    await candidateSkill();
    const noCall = await svc.appendAssetOutcomeForCaller({ team_id: team, asset_id: "skl-1", state: "validated", consumer_user_id: b, asset_version: 1, evidence_json: "{\"x\":1}" }, ctx(admin));
    expect(noCall.outcome.trusted).toBe(false);
    expect(noCall.outcome.untrusted_reason).toBe("no call_id");
    const noEvidence = await svc.appendAssetOutcomeForCaller({ team_id: team, asset_id: "skl-1", state: "validated", consumer_user_id: b, asset_version: 1, call_id: "c1", evidence_json: "{}" }, ctx(admin));
    expect(noEvidence.outcome.untrusted_reason).toBe("no evidence");
    expect((await store.getAssetById("skl-1"))?.status).toBe("candidate");
  });

  it("relation is derived from consumer vs. owner; the caller's value is ignored", async () => {
    await candidateSkill();
    const asSelf = await trusted("skl-1", b, { relation: "self" });
    expect(asSelf.outcome.relation).toBe("cross_user");
    const ownAuthor = await trusted("skl-1", a, { relation: "cross_user" });
    expect(ownAuthor.outcome.relation).toBe("self");
  });

  it("a member's untrusted row is confirmed in place by a reviewer's trusted submission of the same event; a different subject under the same event is a conflict", async () => {
    await candidateSkill();
    const first = await svc.appendAssetOutcomeForCaller({ team_id: team, asset_id: "skl-1", state: "validated", event_id: "evt-m1", task_id: "t1" }, ctx(b));
    expect(first.outcome.trusted).toBe(false);
    expect((await store.getAssetById("skl-1"))?.status).toBe("candidate");
    // The same event, resubmitted trusted by a reviewer naming the consumer: confirmed, not duplicated, not blocked.
    const conf = await svc.appendAssetOutcomeForCaller({ ...trustedBody("skl-1", b), team_id: team, event_id: "evt-m1" }, ctx(r));
    expect(conf.confirmed).toBe(true);
    expect(conf.duplicate).toBe(false);
    expect(conf.outcome.id).toBe(first.outcome.id);
    expect(conf.outcome.trusted).toBe(true);
    expect(conf.outcome.submitted_role).toBe("reviewer");
    expect((await store.listAssetOutcomes({ team_id: team, asset_id: "skl-1" })).total).toBe(1);
    expect((await store.getAssetById("skl-1"))?.status).toBe("approved"); // the confirmation re-decided
    // Once trusted, a further redelivery is a duplicate; a different subject is a conflict.
    expect((await svc.appendAssetOutcomeForCaller({ ...trustedBody("skl-1", b), team_id: team, event_id: "evt-m1" }, ctx(r))).duplicate).toBe(true);
    await expect(svc.appendAssetOutcomeForCaller({ ...trustedBody("skl-1", b, { state: "corrected", corrected_reason: "wrong" }), team_id: team, event_id: "evt-m1" }, ctx(r))).rejects.toMatchObject({ code: "event_id_conflict" });
  });

  it("event_id makes delivery idempotent: a redelivery returns the row on file and adds nothing", async () => {
    await candidateSkill();
    const first = await trusted("skl-1", b, { event_id: "evt-1", call_id: "call-1" });
    const again = await trusted("skl-1", b, { event_id: "evt-1", call_id: "call-1" });
    expect(first.duplicate).toBe(false);
    expect(again.duplicate).toBe(true);
    expect(again.outcome.id).toBe(first.outcome.id);
    expect((await store.listAssetOutcomes({ team_id: team, asset_id: "skl-1" })).total).toBe(1);
    // A supplement to the same call under a new event id is a row, not weight.
    const supplement = await trusted("skl-1", b, { event_id: "evt-2", call_id: "call-1", state: "used" });
    expect(supplement.duplicate).toBe(false);
    expect((await store.listAssetOutcomes({ team_id: team, asset_id: "skl-1" })).total).toBe(2);
    const g = await svc.evaluateAssetGate("skl-1", { apply: false });
    expect(g.decision.signals.online.calls).toBe(1);
  });

  it("a trusted corrected(wrong) outcome rejects it, and list-accessible drops it for everyone", async () => {
    await candidateSkill();
    await trusted("skl-1", b);
    const res = await trusted("skl-1", b, { state: "corrected", corrected_reason: "wrong" });
    expect(res.gate?.decision).toBe("reject");
    expect((await store.getAssetById("skl-1"))?.status).toBe("failed");
    expect(await visibleTo(b)).toEqual([]);
    expect(await visibleTo(r)).toEqual([]);
    // On the management path the owner and a reviewer still read the rejection; a member does not.
    expect((await svc.checkAssetPermission({ user_id: a, asset_id: "skl-1", action: "read" })).allowed).toBe(true);
    expect((await svc.checkAssetPermission({ user_id: r, asset_id: "skl-1", action: "read" })).allowed).toBe(true);
    expect(await svc.checkAssetPermission({ user_id: b, asset_id: "skl-1", action: "read" })).toEqual({ allowed: false, reason: "status_failed" });
  });

  it("the author's own validation does not admit; the record says self", async () => {
    await candidateSkill();
    const res = await trusted("skl-1", a);
    expect(res.outcome.relation).toBe("self");
    expect(res.gate?.decision).toBe("pending");
    expect((await store.getAssetById("skl-1"))?.status).toBe("candidate");
  });

  it("naming another consumer takes an admin or reviewer; a non-member cannot record at all", async () => {
    await candidateSkill();
    await expect(svc.appendAssetOutcomeForCaller({ team_id: team, asset_id: "skl-1", state: "validated", consumer_user_id: r }, ctx(b))).rejects.toMatchObject({ code: "permission_denied" });
    const asReviewer = await svc.appendAssetOutcomeForCaller({ ...trustedBody("skl-1", b), team_id: team }, ctx(r));
    expect(asReviewer.outcome.consumer_user_id).toBe(b);
    expect(asReviewer.outcome.trusted).toBe(true);
    expect(asReviewer.outcome.submitted_role).toBe("reviewer");
    const stranger = (await svc.createNormalUser({ username: `s-${Date.now()}` })).user_id;
    await expect(svc.appendAssetOutcomeForCaller({ team_id: team, asset_id: "skl-1", state: "validated" }, ctx(stranger))).rejects.toMatchObject({ code: "permission_denied" });
  });

  it("evaluate by hand: owner, reviewer and admin may; a plain member may not; apply=false decides only", async () => {
    await candidateSkill();
    await expect(svc.evaluateAssetGateForCaller("skl-1", ctx(b))).rejects.toMatchObject({ code: "permission_denied" });
    for (const who of [a, r, admin]) {
      const res = await svc.evaluateAssetGateForCaller("skl-1", ctx(who), { apply: false });
      expect(res.applied).toBe(false);
      expect(res.decision.decision).toBe("pending");
    }
    expect(JSON.parse((await store.getAssetById("skl-1"))!.metadata_json || "{}").gate).toBeUndefined();
    const applied = await svc.evaluateAssetGateForCaller("skl-1", ctx(r));
    expect(applied.applied).toBe(true);
    const g = await svc.getAssetGateForCaller("skl-1", ctx(r));
    expect(g.gate?.decision).toBe("pending");
    expect(g.gate?.review_priority).toBe("normal");
  });

  it("gate/get and outcome/list follow the asset's own permission: hidden in a list is hidden here", async () => {
    await candidateSkill();
    await trusted("skl-1", b, { state: "used" });
    await expect(svc.getAssetGateForCaller("skl-1", ctx(b))).rejects.toMatchObject({ code: "permission_denied" });
    await expect(svc.listAssetOutcomesForCaller({ team_id: team, asset_id: "skl-1" }, ctx(b))).rejects.toMatchObject({ code: "permission_denied" });
    await expect(svc.listAssetOutcomesForCaller({ team_id: team }, ctx(b))).rejects.toMatchObject({ code: "permission_denied" });
    await expect(svc.listAssetOutcomesForCaller({ team_id: team, owner_user_id: a }, ctx(b))).rejects.toMatchObject({ code: "permission_denied" });
    expect((await svc.listAssetOutcomesForCaller({ team_id: team, consumer_user_id: b }, ctx(b))).total).toBe(1); // one's own use
    expect((await svc.listAssetOutcomesForCaller({ team_id: team, owner_user_id: a }, ctx(a))).total).toBe(1); // one's own authorship
    expect((await svc.listAssetOutcomesForCaller({ team_id: team }, ctx(r))).total).toBe(1);
    expect((await svc.getAssetGateForCaller("skl-1", ctx(a))).status).toBe("candidate");
  });

  it("asset/list is what the caller may see as a person, not the team pool", async () => {
    await candidateSkill("skl-cand", a, "team");
    await candidateSkill("skl-priv", a, "private");
    await candidateSkill("skl-ok", a, "team", "approved");
    await candidateSkill("skl-bad", a, "team", "failed");
    const ids = async (who: string, status?: AssetEntity["status"]) => (await svc.listAssetsForCaller(team, ctx(who), { limit: 50, offset: 0 }, status ? { status } : undefined)).items.map((x) => x.asset_id).sort();
    expect(await ids(b)).toEqual(["skl-ok"]);
    expect(await ids(r)).toEqual(["skl-bad", "skl-cand", "skl-ok"]); // the private candidate is not submitted
    expect(await ids(admin)).toEqual(["skl-bad", "skl-cand", "skl-ok"]);
    expect(await ids(a)).toEqual(["skl-bad", "skl-cand", "skl-ok", "skl-priv"]);
    expect(await ids(r, "candidate")).toEqual(["skl-cand"]);
    await expect(svc.getAssetForCaller("skl-priv", ctx(r))).rejects.toMatchObject({ code: "permission_denied" });
  });

  it("a private candidate reaches the reviewers only once its owner submits it; withdrawing hides it again", async () => {
    await candidateSkill("skl-priv", a, "private");
    await expect(svc.getAssetGateForCaller("skl-priv", ctx(r))).rejects.toMatchObject({ code: "permission_denied" });
    await expect(svc.submitAssetForReviewForCaller("skl-priv", ctx(r))).rejects.toMatchObject({ code: "permission_denied" }); // not the owner
    const sub = await svc.submitAssetForReviewForCaller("skl-priv", ctx(a), { note: "please check" });
    expect((sub.review_request as { requested_by: string }).requested_by).toBe(a);
    const g = await svc.getAssetGateForCaller("skl-priv", ctx(r));
    expect(g.review_requested).toBe(true);
    expect((await svc.listAssetsForCaller(team, ctx(r), { limit: 50, offset: 0 }, { status: "candidate" })).items.map((x) => x.asset_id)).toEqual(["skl-priv"]);
    expect(await svc.checkAssetPermission({ user_id: b, asset_id: "skl-priv", action: "read" })).toEqual({ allowed: false, reason: "status_candidate" }); // a member still cannot
    expect((await svc.checkAssetPermission({ user_id: r, asset_id: "skl-priv", action: "read", purpose: "use" })).allowed).toBe(false); // nor the model
    // Withdraw: gone from the reviewer's sight again; submit once more.
    await svc.submitAssetForReviewForCaller("skl-priv", ctx(a), { withdraw: true });
    expect((await svc.getAssetGateForCaller("skl-priv", ctx(a))).review_requested).toBe(false);
    await expect(svc.getAssetGateForCaller("skl-priv", ctx(r))).rejects.toMatchObject({ code: "permission_denied" });
    await svc.submitAssetForReviewForCaller("skl-priv", ctx(a));
    // The reviewer may now admit it; the human decision stays in force through a re-evaluation (2026-09-08b).
    const rev = await svc.reviewAssetGateForCaller("skl-priv", ctx(r), { decision: "admit", note: "ok", ...seen((await store.getAssetById("skl-priv"))!) });
    expect(rev.asset.status).toBe("approved");
    expect(rev.effective).toMatchObject({ status: "approved", source: "review", review_id: rev.review.id });
    const re = await svc.evaluateAssetGate("skl-priv", { apply: true });
    expect(re.decision.decision).toBe("pending"); // the rule's suggestion
    expect(re.effective.source).toBe("review");
    expect(re.asset.status).toBe("approved"); // no longer reverted by a re-evaluation
    const after = JSON.parse((await store.getAssetById("skl-priv"))!.metadata_json).gate;
    expect(after.review.decision).toBe("admit");
    expect(after.reviews).toHaveLength(1);
    expect(after.review_request.requested_by).toBe(a);
  });

  it("a new version expires the human decision and starts as a candidate; the old version's late correction does not fail it", async () => {
    const agent = await store.createAgent({ team_id: team, owner_user_id: a, name: "A" });
    await svc.ensureSkillAsset({ skill_id: "skl-v", team_id: team, agent_id: agent.agent_id, name: "v", version: 1, content_hash: "h1" });
    await svc.updateAssetForCaller("skl-v", { visibility: "team" }, ctx(a));
    await trusted("skl-v", b, { asset_version: 1 });
    expect((await store.getAssetById("skl-v"))?.status).toBe("approved");
    const rev = await svc.reviewAssetGateForCaller("skl-v", ctx(r), { decision: "admit", note: "looks right", ...seen((await store.getAssetById("skl-v"))!) });
    expect(rev.review.asset_version).toBe(1);
    // v2 arrives (the versioning hook or a patch handler).
    const s1 = await svc.syncSkillAssetVersion({ skill_id: "skl-v", version: 2, content_hash: "h2" });
    expect(s1.changed).toBe(true);
    expect(s1.asset.version).toBe(2);
    expect(s1.asset.content_hash).toBe("h2");
    expect(s1.asset.status).toBe("candidate"); // nothing inherited
    const g = await svc.getAssetGateForCaller("skl-v", ctx(a));
    expect(g.review).toBeNull();
    expect(g.reviews[0].expired_reason).toMatch(/version changed from 1 to 2/);
    expect(g.gate?.signals.online.other_version).toBe(1);
    expect(g.effective?.status).toBe("candidate");
    // Idempotent.
    expect((await svc.syncSkillAssetVersion({ skill_id: "skl-v", version: 2, content_hash: "h2" })).changed).toBe(false);
    // A read that brings only the hash of the version on file fills it in without a sync.
    await store.updateAsset("skl-v", { content_hash: null });
    const filled = await svc.ensureSkillAsset({ skill_id: "skl-v", team_id: team, agent_id: agent.agent_id, name: "v", version: 2, content_hash: "h2" });
    expect(filled.content_hash).toBe("h2");
    expect(filled.version).toBe(2);
    expect(filled.status).toBe("candidate");
    // A late correction of v1 is recorded and does not fail v2.
    await trusted("skl-v", b, { asset_version: 1, state: "corrected", corrected_reason: "wrong" });
    expect((await store.getAssetById("skl-v"))?.status).toBe("candidate");
    // v2's own cross-person validation admits v2.
    await trusted("skl-v", b, { asset_version: 2 });
    expect((await store.getAssetById("skl-v"))?.status).toBe("approved");
  });

  it("on the model's path a served version the registry has not admitted is refused, and the registry catches up", async () => {
    await candidateSkill("skl-w", a, "team", "approved");
    await store.updateAsset("skl-w", { content_hash: "h1" });
    const reads = await svc.decideAssetReads({ user_id: b, asset_ids: ["skl-w"], purpose: "use", served: { "skl-w": { version: 2, content_hash: "h2" } } });
    expect(reads.get("skl-w")).toEqual({ allowed: false, reason: "version_mismatch:registry=1,served=2" });
    await new Promise((r) => setTimeout(r, 20)); // the sync is fire-and-forget
    const after = await store.getAssetById("skl-w");
    expect(after?.version).toBe(2);
    expect(after?.status).toBe("candidate");
    // Same version, different content: refused too.
    await store.updateAsset("skl-w", { status: "approved" });
    expect((await svc.decideAssetReads({ user_id: b, asset_ids: ["skl-w"], purpose: "use", served: { "skl-w": { version: 2, content_hash: "h2-edited" } } })).get("skl-w")?.reason).toBe("content_hash_mismatch");
    await new Promise((r) => setTimeout(r, 20)); // that read synced the registry to the edited content, as a candidate
    expect((await store.getAssetById("skl-w"))?.status).toBe("candidate");
    // Matching: served.
    await store.updateAsset("skl-w", { status: "approved", content_hash: "h2" });
    expect((await svc.decideAssetReads({ user_id: b, asset_ids: ["skl-w"], purpose: "use", served: { "skl-w": { version: 2, content_hash: "h2" } } })).get("skl-w")?.allowed).toBe(true);
  });

  it("a later review supersedes the earlier one for the same version; the history keeps both", async () => {
    await candidateSkill("skl-h", a, "team");
    const first = await svc.reviewAssetGateForCaller("skl-h", ctx(r), { decision: "reject", note: "wrong port", ...seen((await store.getAssetById("skl-h"))!) });
    expect(first.asset.status).toBe("failed");
    const second = await svc.reviewAssetGateForCaller("skl-h", ctx(admin), { decision: "admit", note: "port fixed by hand", ...seen((await store.getAssetById("skl-h"))!) });
    expect(second.asset.status).toBe("approved");
    const g = await svc.getAssetGateForCaller("skl-h", ctx(a));
    expect(g.reviews.map((x) => [x.decision, !!x.expired_at])).toEqual([["reject", true], ["admit", false]]);
    expect(g.reviews[0].expired_reason).toMatch(/superseded/);
    expect(g.review?.id).toBe(second.review.id);
    // A trusted correction now outranks the human admit; the review stays on file.
    await trusted("skl-h", b, { state: "corrected", corrected_reason: "wrong" });
    const g2 = await svc.getAssetGateForCaller("skl-h", ctx(a));
    expect(g2.status).toBe("failed");
    expect(g2.effective?.source).toBe("rule");
    expect(g2.effective?.reason).toMatch(/did not name 1 corrected outcome/);
    expect(g2.review?.id).toBe(second.review.id);
  });

  it("a team admin who is not the owner may set status (the management act) and nothing else", async () => {
    await candidateSkill("skl-adm2", a, "team");
    const res = await svc.updateAssetForCaller("skl-adm2", { status: "approved" }, ctx(admin));
    expect(res.status).toBe("approved");
    await expect(svc.updateAssetForCaller("skl-adm2", { visibility: "private" }, ctx(admin))).rejects.toMatchObject({ code: "permission_denied" });
    await expect(svc.updateAssetForCaller("skl-adm2", { status: "failed" }, ctx(r))).rejects.toMatchObject({ code: "permission_denied" });
  });

  it("audit fields: a member cannot set status or confidence through create/update; a member's registration enters as a candidate; the gate on file survives an update", async () => {
    await expect(svc.createAssetForCaller({ asset_id: "skl-m", team_id: team, asset_type: "skill", name: "m", owner_user_id: a, source_type: "manual", status: "approved" }, ctx(a))).rejects.toMatchObject({ code: "permission_denied" });
    const created = await svc.createAssetForCaller({ asset_id: "skl-m", team_id: team, asset_type: "skill", name: "m", owner_user_id: a, source_type: "manual", metadata_json: JSON.stringify({ gate: { decision: "admit" }, note: 1 }) }, ctx(a));
    expect(created.status).toBe("candidate");
    expect(JSON.parse(created.metadata_json || "{}")).toEqual({ note: 1 }); // no gate from the caller
    await expect(svc.updateAssetForCaller("skl-m", { status: "approved" }, ctx(a))).rejects.toMatchObject({ code: "permission_denied" });
    await expect(svc.updateAssetForCaller("skl-m", { confidence: 1 }, ctx(a))).rejects.toMatchObject({ code: "permission_denied" });
    // The gate writes; the owner's later update keeps what it wrote.
    await svc.evaluateAssetGate("skl-m", { apply: true });
    const updated = await svc.updateAssetForCaller("skl-m", { description: "renamed", metadata_json: JSON.stringify({ gate: { decision: "admit" }, note: 2 }) }, ctx(a));
    expect(updated.description).toBe("renamed");
    const m = JSON.parse(updated.metadata_json || "{}");
    expect(m.note).toBe(2);
    expect(m.gate.decision).toBe("pending");
    expect(updated.status).toBe("candidate");
    // An admin's own registration may carry a status: a management act.
    const byAdmin = await svc.createAssetForCaller({ asset_id: "skl-adm", team_id: team, asset_type: "skill", name: "adm", owner_user_id: admin, source_type: "manual", status: "approved" }, ctx(admin));
    expect(byAdmin.status).toBe("approved");
  });

  it("asset/gate/assessment: a reviewer writes a bound assessment, the author may not, and the gate reads it", async () => {
    await candidateSkill("skl-as", a, "team");
    await store.updateAsset("skl-as", { content_hash: "hA" });
    const body = { schema: "author-assessment-summary-v2", competence: "low", domain: "bridge address", assessed_at: "2026-09-08T12:00:00Z", evidence_cutoff: "2026-09-06T08:47:33Z", citations: 2, author_user_id: a, asset_version: 1, content_hash: "hA", asset_claim_check: { verdict: "contradicts", record_ids: ["outcome:o1"], strength: "strong" } };
    await expect(svc.writeAuthorAssessmentForCaller("skl-as", ctx(a), body)).rejects.toMatchObject({ code: "permission_denied" });
    await expect(svc.writeAuthorAssessmentForCaller("skl-as", ctx(b), body)).rejects.toMatchObject({ code: "permission_denied" });
    await expect(svc.writeAuthorAssessmentForCaller("skl-as", ctx(r), { ...body, author_user_id: b })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(svc.writeAuthorAssessmentForCaller("skl-as", ctx(r), { ...body, asset_version: 2 })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(svc.writeAuthorAssessmentForCaller("skl-as", ctx(r), { ...body, evidence_cutoff: undefined })).rejects.toMatchObject({ code: "invalid_request" });
    // The asset carries a hash: the assessment must name it; Core never fills it in.
    await expect(svc.writeAuthorAssessmentForCaller("skl-as", ctx(r), { ...body, content_hash: undefined })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(svc.writeAuthorAssessmentForCaller("skl-as", ctx(r), { ...body, content_hash: "hB" })).rejects.toMatchObject({ code: "invalid_request" });
    const res = await svc.writeAuthorAssessmentForCaller("skl-as", ctx(r), body);
    expect(res.assessment.content_hash).toBe("hA");
    expect(res.assessment.written_by).toBe(r);
    expect(res.decision.signals.author.assessment?.competence).toBe("low");
    expect(res.decision.review_priority).toBe("high");
    expect(res.decision.reasons.join("\n")).toMatch(/own records contradict this asset's claim/);
    // At an as_of before the cutoff the gate ignores it and says so.
    const early = await svc.evaluateAssetGate("skl-as", { apply: false, asOf: "2026-09-05T00:00:00Z" });
    expect(early.decision.signals.author.assessment).toBeNull();
    expect(early.decision.signals.author.assessment_ignored).toMatch(/after as_of/);
    // The owner's update cannot replace it: the gate object on file wins.
    await svc.updateAssetForCaller("skl-as", { metadata_json: JSON.stringify({ gate: { author_assessment: { competence: "high" } } }) }, ctx(a));
    expect((await svc.getAssetGateForCaller("skl-as", ctx(a))).gate?.signals.author.assessment?.competence).toBe("low");
  });

  it("a new version lands as a candidate in the same write as its version and hash; a review of the old text is refused; the owner's request expires with the text", async () => {
    const agent = await store.createAgent({ team_id: team, owner_user_id: a, name: "A" });
    await svc.ensureSkillAsset({ skill_id: "skl-atomic", team_id: team, agent_id: agent.agent_id, name: "atomic", version: 1, content_hash: "h1" });
    await svc.updateAssetForCaller("skl-atomic", { visibility: "private" }, ctx(a));
    await svc.submitAssetForReviewForCaller("skl-atomic", ctx(a), { note: "please" });
    expect((await svc.checkAssetPermission({ user_id: r, asset_id: "skl-atomic", action: "read" })).allowed).toBe(true); // submitted private candidate
    await trusted("skl-atomic", b);
    const v1 = (await store.getAssetById("skl-atomic"))!;
    expect(v1.status).toBe("approved");
    // The reviewer read v1; the author writes v2 before the decision lands.
    const moved = await svc.syncSkillAssetVersion({ skill_id: "skl-atomic", version: 2, content_hash: "h2" });
    expect(moved.asset.status).toBe("candidate");
    expect(moved.asset.version).toBe(2);
    await expect(svc.reviewAssetGateForCaller("skl-atomic", ctx(r), { decision: "admit", ...seen(v1) })).rejects.toMatchObject({ code: "stale_review" });
    expect((await store.getAssetById("skl-atomic"))?.status).toBe("candidate"); // the stale admit did not land
    // The request granted access to v1's text; v2 needs a new request.
    const g = await svc.getAssetGateForCaller("skl-atomic", ctx(a));
    expect(g.review_requested).toBe(false);
    expect((g.review_request as { expired_reason?: string }).expired_reason).toMatch(/version changed from 1 to 2/);
    expect((await svc.checkAssetPermission({ user_id: r, asset_id: "skl-atomic", action: "read" })).allowed).toBe(false);
    await svc.submitAssetForReviewForCaller("skl-atomic", ctx(a));
    expect((await svc.checkAssetPermission({ user_id: r, asset_id: "skl-atomic", action: "read" })).allowed).toBe(true);
    const gh = gateOfAsset((await store.getAssetById("skl-atomic"))!);
    expect((gh.review_requests as Array<{ asset_version: number; expired_reason?: string }>).map((x) => [x.asset_version, !!x.expired_reason])).toEqual([[1, true]]); // the expired v1 request is history; v2's is current
    expect((gh.review_request as { asset_version: number }).asset_version).toBe(2);
    // v1's validated row does not decide v2 (other content).
    const g2 = await svc.evaluateAssetGate("skl-atomic", { apply: false });
    expect(g2.decision.signals.online.other_version).toBe(1);
  });

  it("two reviewers on the same row: the second decision is refused as stale and must be re-read; history keeps the first", async () => {
    await candidateSkill("skl-race", a, "team");
    const asRead = (await store.getAssetById("skl-race"))!;
    const first = await svc.reviewAssetGateForCaller("skl-race", ctx(r), { decision: "admit", note: "first", ...seen(asRead) });
    expect(first.asset.status).toBe("approved");
    // The admin decided from the same read. Version and hash are unchanged,
    // so those preconditions pass — the row's revision is what refuses it.
    await expect(svc.reviewAssetGateForCaller("skl-race", ctx(admin), { decision: "reject", note: "second", ...seen(asRead) })).rejects.toMatchObject({ code: "stale_review" });
    const g = await svc.getAssetGateForCaller("skl-race", ctx(a));
    expect(g.reviews.map((x) => [x.decision, x.note])).toEqual([["admit", "first"]]); // the first review is still there, alone
    expect(g.status).toBe("approved");
    // Re-read, then decide: that one lands.
    const again = await svc.reviewAssetGateForCaller("skl-race", ctx(admin), { decision: "reject", note: "after re-reading", ...seen((await store.getAssetById("skl-race"))!) });
    expect(again.asset.status).toBe("failed");
    expect((await svc.getAssetGateForCaller("skl-race", ctx(a))).reviews.length).toBe(2);
  });

  it("two writes inside the same millisecond: the second is still refused — updated_at cannot tell them apart, the revision can", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-09-08T00:00:00.000Z"));
      await candidateSkill("skl-ms", a, "team");
      const asRead = (await store.getAssetById("skl-ms"))!;
      const first = await svc.reviewAssetGateForCaller("skl-ms", ctx(r), { decision: "admit", note: "first", ...seen(asRead) });
      expect(first.asset.status).toBe("approved");
      // The clock has not moved: version, content_hash and updated_at are all
      // exactly what the second reviewer read. Only the revision differs.
      const after = (await store.getAssetById("skl-ms"))!;
      expect(after.updated_at).toBe(asRead.updated_at);
      expect(after.version).toBe(asRead.version);
      expect(after.revision).toBe((asRead.revision ?? 0) + 1);
      await expect(svc.reviewAssetGateForCaller("skl-ms", ctx(admin), { decision: "reject", note: "second", ...seen(asRead) })).rejects.toMatchObject({ code: "stale_review" });
      const g = await svc.getAssetGateForCaller("skl-ms", ctx(a));
      expect(g.reviews.map((x) => x.note)).toEqual(["first"]);
      // Directly at the store: the same expectation cannot be used twice.
      const row = (await store.getAssetById("skl-ms"))!;
      expect(await store.updateAssetIf("skl-ms", { description: "one" }, { version: row.version, content_hash: row.content_hash ?? null, updated_at: row.updated_at, revision: row.revision ?? 0 })).not.toBeNull();
      expect(await store.updateAssetIf("skl-ms", { description: "two" }, { version: row.version, content_hash: row.content_hash ?? null, updated_at: row.updated_at, revision: row.revision ?? 0 })).toBeNull();
      expect((await store.getAssetById("skl-ms"))?.description).toBe("one");
      // An unconditional write raises it too, so a conditional write from before it is refused.
      const before = (await store.getAssetById("skl-ms"))!;
      await store.updateAsset("skl-ms", { description: "by another path" });
      expect(await store.updateAssetIf("skl-ms", { description: "three" }, { version: before.version, content_hash: before.content_hash ?? null, updated_at: before.updated_at, revision: before.revision ?? 0 })).toBeNull();
      expect((await store.getAssetById("skl-ms"))?.description).toBe("by another path");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a reviewer retracts a mistaken correction: it stays on file, the gate stops reading it, the asset is re-decided", async () => {
    await candidateSkill("skl-ret", a, "team");
    await trusted("skl-ret", b);
    const bad = await trusted("skl-ret", b, { state: "corrected", corrected_reason: "wrong" });
    expect((await store.getAssetById("skl-ret"))?.status).toBe("failed");
    await expect(svc.retractAssetOutcomeForCaller(bad.outcome.id, ctx(b), { reason: "x" })).rejects.toMatchObject({ code: "permission_denied" });
    await expect(svc.retractAssetOutcomeForCaller(bad.outcome.id, ctx(r), { reason: "" })).rejects.toMatchObject({ code: "invalid_request" });
    const res = await svc.retractAssetOutcomeForCaller(bad.outcome.id, ctx(r), { reason: "the probe used the wrong port" });
    expect(res.outcome.retracted_by).toBe(r);
    expect(res.decision.decision).toBe("admit");
    expect(res.decision.signals.online.retracted_ignored).toBe(1);
    expect((await store.getAssetById("skl-ret"))?.status).toBe("approved");
    await expect(svc.retractAssetOutcomeForCaller(bad.outcome.id, ctx(r), { reason: "again" })).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("an admit lifts a rule reject only for the corrections it names, with a reason; a later one keeps the asset failed", async () => {
    await candidateSkill("skl-seen", a, "team");
    const bad = await trusted("skl-seen", b, { state: "corrected", corrected_reason: "wrong", occurred_at: "2026-09-05T00:00:00.000Z" });
    expect((await store.getAssetById("skl-seen"))?.status).toBe("failed");
    // A bare admit — the correction is on file, but nothing records that the
    // reviewer read it. Accepted as a review, and the reject stands.
    const bare = await svc.reviewAssetGateForCaller("skl-seen", ctx(r), { decision: "admit", note: "looks fine to me", ...seen((await store.getAssetById("skl-seen"))!) });
    expect(bare.asset.status).toBe("failed");
    expect(bare.effective.reason).toMatch(/did not name 1 corrected outcome/);
    // Naming a row that is not one of the live corrections is a mistake, not an override.
    await expect(svc.reviewAssetGateForCaller("skl-seen", ctx(r), { decision: "admit", overrode: [{ outcome_id: "o-nonexistent", reason: "x" }], ...seen((await store.getAssetById("skl-seen"))!) }))
      .rejects.toMatchObject({ code: "invalid_request" });
    // Naming it without a reason is refused too.
    await expect(svc.reviewAssetGateForCaller("skl-seen", ctx(r), { decision: "admit", overrode: [{ outcome_id: bad.outcome.id, reason: "  " }], ...seen((await store.getAssetById("skl-seen"))!) }))
      .rejects.toMatchObject({ code: "invalid_request" });
    const rev = await svc.reviewAssetGateForCaller("skl-seen", ctx(r), { decision: "admit", note: "verified by hand", overrode: [{ outcome_id: bad.outcome.id, reason: "the probe used the wrong port" }], ...seen((await store.getAssetById("skl-seen"))!) });
    expect(rev.asset.status).toBe("approved");
    expect(rev.effective.reason).toMatch(/overruling 1 corrected outcome\(s\) named in the review/);
    expect(rev.review.overrode).toEqual([{ outcome_id: bad.outcome.id, reason: "the probe used the wrong port" }]);
    await trusted("skl-seen", b, { state: "corrected", corrected_reason: "wrong" }); // new evidence, not named by any review
    const g = await svc.getAssetGateForCaller("skl-seen", ctx(a));
    expect(g.status).toBe("failed");
    expect(g.effective?.reason).toMatch(/did not name 1 corrected outcome/);
  });

  it("a trusted row must name the content when the asset carries a hash; a later resubmission adds the hash in place", async () => {
    await candidateSkill("skl-hash", a, "team");
    await store.updateAsset("skl-hash", { content_hash: "hX" });
    const noHash = await svc.appendAssetOutcomeForCaller({ ...trustedBody("skl-hash", b, { content_hash: undefined }), team_id: team, event_id: "evt-h1" }, ctx(admin));
    expect(noHash.outcome.trusted).toBe(false);
    expect(noHash.outcome.untrusted_reason).toMatch(/no content_hash/);
    const withHash = await svc.appendAssetOutcomeForCaller({ ...trustedBody("skl-hash", b, { content_hash: "hX" }), team_id: team, event_id: "evt-h1" }, ctx(admin));
    expect(withHash.confirmed).toBe(true);
    expect(withHash.outcome.content_hash).toBe("hX");
    expect((await store.getAssetById("skl-hash"))?.status).toBe("approved");
  });

  it("backfill: a legacy status becomes a candidate decided once; draft is counted and left; nothing is approved by migration", async () => {
    await store.createAsset({ asset_id: "skl-legacy", team_id: team, asset_type: "skill", name: "legacy", owner_user_id: a, source_type: "test", visibility: "team", status: "active" as unknown as AssetEntity["status"] });
    await candidateSkill("skl-draft", a, "team", "draft");
    await candidateSkill("skl-ok", a, "team", "approved");
    await store.createAsset({ asset_id: "cm-1", team_id: team, asset_type: "chat_memory", name: "cm", owner_user_id: a, source_type: "test", visibility: "private", status: "active" as unknown as AssetEntity["status"] });
    await expect(svc.backfillAssetGateForCaller(team, ctx(r))).rejects.toMatchObject({ code: "permission_denied" });
    const dry = await svc.backfillAssetGateForCaller(team, ctx(admin), { dry_run: true });
    expect(dry.moved).toEqual([{ asset_id: "skl-legacy", from: "active", decision: null }]);
    expect((await store.getAssetById("skl-legacy"))?.status).toBe("active");
    const done = await svc.backfillAssetGateForCaller(team, ctx(admin));
    expect(done.moved).toEqual([{ asset_id: "skl-legacy", from: "active", decision: "pending" }]);
    expect(done.drafts).toBe(1);
    expect(done.untouched).toBe(1);
    expect((await store.getAssetById("skl-legacy"))?.status).toBe("candidate");
    expect((await store.getAssetById("skl-draft"))?.status).toBe("draft");
    expect((await store.getAssetById("skl-ok"))?.status).toBe("approved");
    expect((await store.getAssetById("cm-1"))?.status).toBe("active"); // not a pool asset; untouched by default
    expect(done.asset_type).toBe("skill");
  });

  it("a new skill enters as a candidate with the cold-start decision written; the author's record sets its priority", async () => {
    const agent = await store.createAgent({ team_id: team, owner_user_id: a, name: "A" });
    const first = await svc.ensureSkillAsset({ skill_id: "skl-new-1", team_id: team, agent_id: agent.agent_id, name: "new-1" });
    expect(first.status).toBe("candidate");
    expect(first.visibility).toBe("private");
    const g1 = JSON.parse(first.metadata_json).gate;
    expect(g1.decision).toBe("pending");
    expect(g1.review_priority).toBe("normal");

    // The author's earlier asset is judged wrong (trusted record); the next new skill is high priority.
    await trusted("skl-new-1", b, { state: "corrected", corrected_reason: "wrong" });
    const second = await svc.ensureSkillAsset({ skill_id: "skl-new-2", team_id: team, agent_id: agent.agent_id, name: "new-2" });
    const g2 = JSON.parse(second.metadata_json).gate;
    expect(g2.review_priority).toBe("high");
    expect(g2.signals.author.recent_wrong_asset_ids).toEqual(["skl-new-1"]);
    expect(second.status).toBe("candidate");
  });
});

describe("as_of: the gate can be asked to act on the evidence base only", () => {
  it("outcomes after as_of are not read, and the decision says so", async () => {
    const store = new SqliteMetadataStore(":memory:"); store.init();
    const svc = new MetadataService(store, "test");
    const admin = (await svc.createNormalUser({ username: `adm-${Date.now()}` })).user_id;
    const a = (await svc.createNormalUser({ username: `a-${Date.now()}` })).user_id;
    const b = (await svc.createNormalUser({ username: `b-${Date.now()}` })).user_id;
    const team = (await store.createTeam({ name: "t", owner_user_id: admin })).team_id;
    await store.addTeamMember({ team_id: team, user_id: a, role: "member" });
    await store.addTeamMember({ team_id: team, user_id: b, role: "member" });
    await store.createAsset({ asset_id: "skl-z", team_id: team, asset_type: "skill", name: "z", owner_user_id: a, source_type: "test", visibility: "team", status: "candidate" });
    // Evidence base: one validated at T1. Later batch: a corrected at T2, recorded but not acted on.
    await svc.appendAssetOutcomeForCaller({ ...trustedBody("skl-z", b), team_id: team, occurred_at: "2026-09-06T08:00:00.000Z" }, ctx(admin), { evaluate: false });
    await svc.appendAssetOutcomeForCaller({ ...trustedBody("skl-z", b, { state: "corrected", corrected_reason: "wrong" }), team_id: team, occurred_at: "2026-09-07T10:00:00.000Z" }, ctx(admin), { evaluate: false });
    const frozen = await svc.evaluateAssetGate("skl-z", { apply: true, asOf: "2026-09-06T08:47:33.000Z" });
    expect(frozen.decision.decision).toBe("admit");
    expect(frozen.decision.evidence_as_of).toBe("2026-09-06T08:47:33.000Z");
    expect(frozen.decision.signals.online.corrected).toBe(0);
    expect((await store.getAssetById("skl-z"))?.status).toBe("approved");
    const all = await svc.evaluateAssetGate("skl-z", { apply: true });
    expect(all.decision.decision).toBe("reject");
    expect(all.decision.evidence_as_of).toBeNull();
    expect((await store.getAssetById("skl-z"))?.status).toBe("failed");
  });
});

describe("the author's own records contradicting the asset", () => {
  it("makes a pending asset high priority, and is reported on a decided one without moving it", () => {
    const meta = JSON.stringify({ gate: { author_assessment: signed({ citations: 4, asset_claim_check: { verdict: "contradicts", record_ids: ["l0:msg-1"], strength: "strong" } }) } });
    const pending = decideAsset({ asset: { ...asset, metadata_json: meta }, outcomes: [], authorOutcomes: [], now: T0 });
    expect(pending.review_priority).toBe("high");
    expect(pending.reasons.join("\n")).toMatch(/own records contradict this asset's claim \(l0:msg-1\)/);
    expect(pending.signals.author.assessment?.asset_claim_check?.verdict).toBe("contradicts");
    const admitted = decideAsset({ asset: { ...asset, metadata_json: meta }, outcomes: [outcome({})], authorOutcomes: [], now: T0 });
    expect(admitted.decision).toBe("admit");
    expect(admitted.review_priority).toBeNull();
    expect(admitted.reasons.join("\n")).toMatch(/reported, not used/);
  });
});

describe("human review", () => {
  it("a reviewer admits or rejects a candidate by hand; the owner and a plain member may not; a re-evaluation keeps the review", async () => {
    const store = new SqliteMetadataStore(":memory:"); store.init();
    const svc = new MetadataService(store, "test");
    const admin = (await svc.createNormalUser({ username: `adm-${Date.now()}` })).user_id;
    const a = (await svc.createNormalUser({ username: `a-${Date.now()}` })).user_id;
    const b = (await svc.createNormalUser({ username: `b-${Date.now()}` })).user_id;
    const r = (await svc.createNormalUser({ username: `r-${Date.now()}` })).user_id;
    const team = (await store.createTeam({ name: "t", owner_user_id: admin })).team_id;
    for (const [u, role] of [[a, "member"], [b, "member"], [r, "reviewer"]] as const) await store.addTeamMember({ team_id: team, user_id: u, role });
    await store.createAsset({ asset_id: "skl-r", team_id: team, asset_type: "skill", name: "r", owner_user_id: a, source_type: "test", visibility: "team", status: "candidate" });
    const a0 = (await store.getAssetById("skl-r"))!;
    await expect(svc.reviewAssetGateForCaller("skl-r", ctx(a), { decision: "admit", ...seen(a0) })).rejects.toMatchObject({ code: "permission_denied" });
    await expect(svc.reviewAssetGateForCaller("skl-r", ctx(b), { decision: "admit", ...seen(a0) })).rejects.toMatchObject({ code: "permission_denied" });
    await expect(svc.reviewAssetGateForCaller("skl-r", ctx(r), { decision: "admit" })).rejects.toMatchObject({ code: "invalid_request" }); // what did the reviewer read?
    await expect(svc.reviewAssetGateForCaller("skl-r", ctx(r), { decision: "admit", expected_version: 2 })).rejects.toMatchObject({ code: "stale_review" });
    const res = await svc.reviewAssetGateForCaller("skl-r", ctx(r), { decision: "admit", note: "checked the address by hand", ...seen(a0) });
    expect(res.asset.status).toBe("approved");
    expect(res.review.by).toBe(r);
    const g = await svc.getAssetGateForCaller("skl-r", ctx(b)); // approved + team: a member may read
    expect((g.review as { decision: string }).decision).toBe("admit");
    expect(g.status).toBe("approved");
    await svc.evaluateAssetGate("skl-r", { apply: true });
    expect(JSON.parse((await store.getAssetById("skl-r"))!.metadata_json).gate.review.note).toBe("checked the address by hand");
    expect((await store.getAssetById("skl-r"))?.status).toBe("approved");
    const rej = await svc.reviewAssetGateForCaller("skl-r", ctx(admin), { decision: "reject", ...seen((await store.getAssetById("skl-r"))!) });
    expect(rej.asset.status).toBe("failed");
  });
});
