/**
 * The gate under contention.
 *
 * Binding a decision write to the evidence set it was read from
 * (2026-09-08f) made refusals ordinary rather than rare: in a burst of
 * outcomes, each one re-decides, and every decision reads evidence the next
 * append has already moved. The first measurement of that was 8 of 12
 * concurrent submissions failing with `stale_write` — while their rows were
 * already on file, so callers were told their outcome was rejected when it
 * had been recorded (2026-09-08g).
 *
 * Two things are pinned here: recording an outcome never fails because the
 * decision was contended, and the asset still converges — the writer that
 * refused a decision was deciding with evidence that included the refused
 * one's row.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { SqliteMetadataStore } from "../store/sqlite-adapter.js";
import { MetadataService } from "./metadata-service.js";
import type { V3AuthContext } from "../router/auth.js";

describe("the gate under contention", () => {
  let store: SqliteMetadataStore; let svc: MetadataService;
  let team: string, a: string, b: string, admin: string;
  beforeEach(async () => {
    store = new SqliteMetadataStore(":memory:"); store.init();
    svc = new MetadataService(store, "test");
    const mk = async (n: string) => (await svc.createNormalUser({ username: `${n}-${Date.now()}-${Math.random()}` })).user_id;
    admin = await mk("admin"); a = await mk("a"); b = await mk("b");
    team = (await store.createTeam({ name: "t", owner_user_id: admin })).team_id;
    await store.addTeamMember({ team_id: team, user_id: a, role: "member" });
    await store.addTeamMember({ team_id: team, user_id: b, role: "member" });
  });
  const ctx = (userId: string): V3AuthContext => ({ token: "", userId, isAdmin: false, isSystemAdmin: false });

  it("a burst of outcomes, each evaluating, does not exhaust the retry budget", async () => {
    await store.createAsset({ asset_id: "skl-burst", team_id: team, asset_type: "skill", name: "s",
      owner_user_id: a, source_type: "test", visibility: "team", status: "candidate" });
    const one = (i: number) => svc.appendAssetOutcomeForCaller({
      team_id: team, asset_id: "skl-burst", asset_version: 1, state: "validated", relation: "cross_user",
      consumer_user_id: b, task_id: `t${i}`, run_id: `r${i}`, call_id: `call-${i}`, event_id: `evt-${i}`,
      evidence_json: JSON.stringify({ probe: i }),
    }, ctx(admin));
    const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => one(i)));
    const failed = results.filter((r) => r.status === "rejected");
    for (const f of failed) console.log("REJECTED:", (f as PromiseRejectedResult).reason?.code, (f as PromiseRejectedResult).reason?.message?.slice(0, 90));
    expect(failed.length).toBe(0);
    expect((await store.listAssetOutcomes({ team_id: team, asset_id: "skl-burst" })).total).toBe(12);
    const d = await svc.evaluateAssetGate("skl-burst", { apply: false });
    expect(d.decision.signals.online.calls).toBe(12);
    // The point of letting a contended decision go: the asset still converges,
    // because the writer that refused this one was deciding with newer evidence.
    expect((await store.getAssetById("skl-burst"))?.status).toBe(d.effective.status);
  });

  it("a burst that includes a correction converges on the correction, whatever order the decisions land in", async () => {
    await store.createAsset({ asset_id: "skl-burst2", team_id: team, asset_type: "skill", name: "s",
      owner_user_id: a, source_type: "test", visibility: "team", status: "candidate" });
    const row = (i: number, corrected: boolean) => svc.appendAssetOutcomeForCaller({
      team_id: team, asset_id: "skl-burst2", asset_version: 1,
      state: corrected ? "corrected" : "validated", corrected_reason: corrected ? "wrong" : undefined,
      relation: "cross_user", consumer_user_id: b, task_id: `t${i}`, run_id: `r${i}`,
      call_id: `call-${i}`, event_id: `evt2-${i}`, evidence_json: JSON.stringify({ probe: i }),
    }, ctx(admin));
    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => row(i, i === 7)));
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(0);
    const fresh = await svc.evaluateAssetGate("skl-burst2", { apply: false });
    expect(fresh.decision.decision).toBe("reject");
    // Whatever raced, the row on file agrees with a decision taken now.
    expect((await store.getAssetById("skl-burst2"))?.status).toBe(fresh.effective.status);
    expect((await store.getAssetById("skl-burst2"))?.status).toBe("failed");
  });
});
