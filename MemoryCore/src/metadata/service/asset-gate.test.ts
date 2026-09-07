import { beforeEach, describe, expect, it } from "vitest";
import { SqliteMetadataStore } from "../store/sqlite-adapter.js";
import { MetadataService } from "./metadata-service.js";
import { decideAsset, mergeGateIntoMetadata, collapseByCall, GATE_RULES_VERSION } from "./asset-gate.js";
import type { AssetOutcomeEntity, AssetEntity } from "../types.js";
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
    occurred_at: "2026-09-06T10:00:00Z", created_at: "2026-09-06T10:00:00Z",
    ...over,
  };
}
const asset = { asset_id: "skl-x", owner_user_id: "usr-a", metadata_json: "{}" };

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
      metadata_json: JSON.stringify({ gate: { author_assessment: { competence, domain: "bridge address", assessed_at: "2026-09-07T00:00:00Z", citations: 3 } } }),
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

describe("mergeGateIntoMetadata", () => {
  it("writes gate beside other keys and keeps the author assessment, the human review and the review request", () => {
    const d = decideAsset({ asset, outcomes: [], authorOutcomes: [], now: T0 });
    const before = JSON.stringify({ other: 1, gate: { decision: "admit", stale_key: true, author_assessment: { competence: "high" }, review: { decision: "admit", by: "usr-r" }, review_request: { requested_at: "2026-09-08T00:00:00Z" } } });
    const after = JSON.parse(mergeGateIntoMetadata(before, d)) as Record<string, any>;
    expect(after.other).toBe(1);
    expect(after.gate.decision).toBe("pending");
    expect(after.gate.stale_key).toBeUndefined();
    expect(after.gate.author_assessment.competence).toBe("high");
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
  const trusted = (assetId: string, consumer: string, over: Record<string, unknown> = {}) =>
    svc.appendAssetOutcomeForCaller({ ...trustedBody(assetId, consumer, over), team_id: team }, ctx(admin));

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
    const reads = await svc.decideAssetReads({ user_id: b, asset_ids: ["skl-1", "skl-ok", "skl-unregistered"], purpose: "use" });
    expect(reads.get("skl-1")?.allowed).toBe(false);
    expect(reads.get("skl-ok")?.allowed).toBe(true);
    expect(reads.get("skl-unregistered")).toEqual({ allowed: false, reason: "unregistered" });
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
    // The reviewer may now admit it; the human review survives a re-evaluation.
    const rev = await svc.reviewAssetGateForCaller("skl-priv", ctx(r), { decision: "admit", note: "ok" });
    expect(rev.asset.status).toBe("approved");
    const re = await svc.evaluateAssetGate("skl-priv", { apply: true });
    expect(re.decision.decision).toBe("pending");
    const after = JSON.parse((await store.getAssetById("skl-priv"))!.metadata_json).gate;
    expect(after.review.decision).toBe("admit");
    expect(after.review_request.requested_by).toBe(a);
    // Withdraw: gone from the reviewer's sight again.
    await svc.submitAssetForReviewForCaller("skl-priv", ctx(a), { withdraw: true }).catch(() => undefined); // status is candidate again after re-evaluation
    expect((await svc.getAssetGateForCaller("skl-priv", ctx(a))).review_requested).toBe(false);
    await expect(svc.getAssetGateForCaller("skl-priv", ctx(r))).rejects.toMatchObject({ code: "permission_denied" });
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
    const meta = JSON.stringify({ gate: { author_assessment: { competence: "medium", domain: "bridge address", assessed_at: "2026-09-07T10:00:00Z", citations: 4, asset_claim_check: { verdict: "contradicts", record_ids: ["l0:msg-1"] } } } });
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
    await expect(svc.reviewAssetGateForCaller("skl-r", ctx(a), { decision: "admit" })).rejects.toMatchObject({ code: "permission_denied" });
    await expect(svc.reviewAssetGateForCaller("skl-r", ctx(b), { decision: "admit" })).rejects.toMatchObject({ code: "permission_denied" });
    const res = await svc.reviewAssetGateForCaller("skl-r", ctx(r), { decision: "admit", note: "checked the address by hand" });
    expect(res.asset.status).toBe("approved");
    expect(res.review.by).toBe(r);
    const g = await svc.getAssetGateForCaller("skl-r", ctx(b)); // approved + team: a member may read
    expect((g.review as { decision: string }).decision).toBe("admit");
    expect(g.status).toBe("approved");
    await svc.evaluateAssetGate("skl-r", { apply: true });
    expect(JSON.parse((await store.getAssetById("skl-r"))!.metadata_json).gate.review.note).toBe("checked the address by hand");
    const rej = await svc.reviewAssetGateForCaller("skl-r", ctx(admin), { decision: "reject" });
    expect(rej.asset.status).toBe("failed");
  });
});
