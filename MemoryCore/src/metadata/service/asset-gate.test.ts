import { beforeEach, describe, expect, it } from "vitest";
import { SqliteMetadataStore } from "../store/sqlite-adapter.js";
import { MetadataService } from "./metadata-service.js";
import { decideAsset, mergeGateIntoMetadata, GATE_RULES_VERSION } from "./asset-gate.js";
import type { AssetOutcomeEntity, AssetEntity } from "../types.js";
import type { V3AuthContext } from "../router/auth.js";

/**
 * The admission gate inside Core. Three things are pinned here:
 *
 *   1. the decision is a pure function of recorded outcomes — reject on
 *      corrected(wrong/stale), admit on a cross-person validated, pending
 *      otherwise — and the author signal only orders the review queue;
 *   2. the decision lands on the asset's own record (status / confidence /
 *      metadata_json.gate), so the product's read paths do the admitting and
 *      the dropping: a candidate is invisible to plain members, a failed
 *      asset leaves list-accessible, an approved one is governed by
 *      visibility as before;
 *   3. a skill enters the pool as a candidate, with the cold-start decision
 *      already written.
 */

const T0 = new Date("2026-09-07T12:00:00Z");
let seq = 0;
function outcome(over: Partial<AssetOutcomeEntity>): AssetOutcomeEntity {
  seq += 1;
  return {
    id: `o${seq}`, team_id: "team", asset_id: "skl-x", asset_version: 2,
    state: "validated", relation: "cross_user", corrected_reason: null,
    consumer_user_id: "usr-b", consumer_agent_id: null, task_id: "task-1", run_id: null,
    source: "test", evidence_json: "{}", occurred_at: "2026-09-06T10:00:00Z", created_at: "2026-09-06T10:00:00Z",
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
    expect(d.confidence).toBe(0.5); // 1 validated of 2 cross-person outcomes on file
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

describe("mergeGateIntoMetadata", () => {
  it("writes gate beside other keys and keeps an author assessment through re-evaluation", () => {
    const d = decideAsset({ asset, outcomes: [], authorOutcomes: [], now: T0 });
    const before = JSON.stringify({ other: 1, gate: { author_assessment: { competence: "high" } } });
    const after = JSON.parse(mergeGateIntoMetadata(before, d)) as { other: number; gate: { decision: string; author_assessment: { competence: string } } };
    expect(after.other).toBe(1);
    expect(after.gate.decision).toBe("pending");
    expect(after.gate.author_assessment.competence).toBe("high");
    expect(JSON.parse(mergeGateIntoMetadata("not json", d)).gate.decision).toBe("pending");
  });
});

// ── Store + service + permissions, on an in-memory SQLite ──

const ctx = (userId: string): V3AuthContext => ({ token: "", userId, isAdmin: false, isSystemAdmin: false });

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

  async function candidateSkill(id = "skl-1", owner = a): Promise<AssetEntity> {
    return store.createAsset({ asset_id: id, team_id: team, asset_type: "skill", name: id, owner_user_id: owner, source_type: "test", visibility: "team", status: "candidate" });
  }
  async function visibleTo(userId: string): Promise<string[]> {
    const page = await svc.listAccessibleAssets({ user_id: userId, team_id: team, action: "read" });
    return page.items.map((x) => x.asset_id).sort();
  }

  it("outcomes are appended and listed, including by the author's ownership", async () => {
    await candidateSkill("skl-1", a);
    await candidateSkill("skl-2", a);
    await store.appendAssetOutcome({ team_id: team, asset_id: "skl-1", state: "validated", relation: "cross_user", consumer_user_id: b, task_id: "t1" });
    await store.appendAssetOutcome({ team_id: team, asset_id: "skl-2", state: "corrected", corrected_reason: "wrong", relation: "cross_user", consumer_user_id: b });
    expect((await store.listAssetOutcomes({ team_id: team, asset_id: "skl-1" })).total).toBe(1);
    expect((await store.listAssetOutcomes({ team_id: team, owner_user_id: a })).total).toBe(2);
    expect((await store.listAssetOutcomes({ team_id: team, states: ["corrected"] })).items[0].corrected_reason).toBe("wrong");
    const row = (await store.listAssetOutcomes({ team_id: team, asset_id: "skl-1" })).items[0];
    expect(row.corrected_reason).toBeNull();
    expect(row.relation).toBe("cross_user");
  });

  it("a candidate is visible to its owner, a reviewer and an admin — not to a plain member", async () => {
    await candidateSkill();
    expect(await visibleTo(a)).toEqual(["skl-1"]);
    expect(await visibleTo(r)).toEqual(["skl-1"]);
    expect(await visibleTo(admin)).toEqual(["skl-1"]);
    expect(await visibleTo(b)).toEqual([]);
    const perm = await svc.checkAssetPermission({ user_id: b, asset_id: "skl-1", action: "read" });
    expect(perm).toEqual({ allowed: false, reason: "status_candidate" });
  });

  it("a cross-person validated outcome admits the asset, and the plain member can now read it", async () => {
    await candidateSkill();
    const res = await svc.appendAssetOutcomeForCaller({ team_id: team, asset_id: "skl-1", state: "validated", task_id: "t1", source: "test" }, ctx(b));
    expect(res.outcome.relation).toBe("cross_user"); // derived: consumer ≠ owner
    expect(res.gate?.decision).toBe("admit");
    const after = await store.getAssetById("skl-1");
    expect(after?.status).toBe("approved");
    expect(after?.confidence).toBe(1);
    expect(JSON.parse(after!.metadata_json).gate.decision).toBe("admit");
    expect(await visibleTo(b)).toEqual(["skl-1"]);
  });

  it("a corrected(wrong) outcome rejects it, and list-accessible drops it for everyone", async () => {
    await candidateSkill();
    await svc.appendAssetOutcomeForCaller({ team_id: team, asset_id: "skl-1", state: "validated" }, ctx(b));
    const res = await svc.appendAssetOutcomeForCaller({ team_id: team, asset_id: "skl-1", state: "corrected", corrected_reason: "wrong" }, ctx(b));
    expect(res.gate?.decision).toBe("reject");
    expect((await store.getAssetById("skl-1"))?.status).toBe("failed");
    expect(await visibleTo(b)).toEqual([]);
    expect(await visibleTo(r)).toEqual([]);
  });

  it("the author's own validation does not admit; the record says self", async () => {
    await candidateSkill();
    const res = await svc.appendAssetOutcomeForCaller({ team_id: team, asset_id: "skl-1", state: "validated" }, ctx(a));
    expect(res.outcome.relation).toBe("self");
    expect(res.gate?.decision).toBe("pending");
    expect((await store.getAssetById("skl-1"))?.status).toBe("candidate");
  });

  it("recording for someone else needs team admin; a non-member cannot record at all", async () => {
    await candidateSkill();
    await expect(svc.appendAssetOutcomeForCaller({ team_id: team, asset_id: "skl-1", state: "validated", consumer_user_id: r }, ctx(b))).rejects.toMatchObject({ code: "permission_denied" });
    const asAdmin = await svc.appendAssetOutcomeForCaller({ team_id: team, asset_id: "skl-1", state: "validated", consumer_user_id: b }, ctx(admin));
    expect(asAdmin.outcome.consumer_user_id).toBe(b);
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
    const g = await svc.getAssetGateForCaller("skl-1", ctx(b));
    expect(g.gate?.decision).toBe("pending");
    expect(g.gate?.review_priority).toBe("normal");
  });

  it("a new skill enters as a candidate with the cold-start decision written; the author's record sets its priority", async () => {
    const agent = await store.createAgent({ team_id: team, owner_user_id: a, name: "A" });
    const first = await svc.ensureSkillAsset({ skill_id: "skl-new-1", team_id: team, agent_id: agent.agent_id, name: "new-1" });
    expect(first.status).toBe("candidate");
    expect(first.visibility).toBe("private");
    const g1 = JSON.parse(first.metadata_json).gate;
    expect(g1.decision).toBe("pending");
    expect(g1.review_priority).toBe("normal");

    // The author's earlier asset is judged wrong; the next new skill is high priority.
    await svc.appendAssetOutcomeForCaller({ team_id: team, asset_id: "skl-new-1", state: "corrected", corrected_reason: "wrong" }, ctx(b));
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
    await svc.appendAssetOutcomeForCaller({ team_id: team, asset_id: "skl-z", state: "validated", occurred_at: "2026-09-06T08:00:00.000Z" }, ctx(b), { evaluate: false });
    await svc.appendAssetOutcomeForCaller({ team_id: team, asset_id: "skl-z", state: "corrected", corrected_reason: "wrong", occurred_at: "2026-09-07T10:00:00.000Z" }, ctx(b), { evaluate: false });
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
  it("a reviewer admits or rejects a candidate by hand; the owner and a plain member may not", async () => {
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
    const g = await svc.getAssetGateForCaller("skl-r", ctx(b));
    expect((g.review as { decision: string }).decision).toBe("admit");
    expect(g.status).toBe("approved");
    const rej = await svc.reviewAssetGateForCaller("skl-r", ctx(admin), { decision: "reject" });
    expect(rej.asset.status).toBe("failed");
  });
});
