import { describe, expect, it } from "vitest";
import { decideReadVisibility, type TeamSkillRef } from "../skill-bridge.js";

/**
 * The three read paths used to disagree about scope: search was team-visible,
 * get-by-name was owner-only, and get / files/read were team-wide with no
 * visibility check. These cases pin the single rule that replaces that:
 * a read sees exactly what search would have shown.
 */

const CALLER = "agt-consumer";
const OTHER = "agt-author";

const team: TeamSkillRef[] = [
  { skill_id: "skl-own", name: "my-notes", owner_agent_id: CALLER },
  { skill_id: "skl-shared", name: "eval-bridge-endpoint-a", owner_agent_id: OTHER },
  { skill_id: "skl-private", name: "author-secret", owner_agent_id: OTHER },
];

// A = team-shared (skl-shared), B = caller's own (skl-own). skl-private is in
// the team but visible to no one but its owner.
const whitelist = new Set(["skl-shared", "skl-own"]);

const decide = (sub: string, inboundBody: Record<string, unknown>, over: Partial<Parameters<typeof decideReadVisibility>[0]> = {}) =>
  decideReadVisibility({ sub, inboundBody, whitelist, teamSkills: team, callerAgentId: CALLER, ...over });

describe("get / files/read: the id must be visible", () => {
  it("forwards a visible id", () => {
    expect(decide("get", { skill_id: "skl-shared" })).toEqual({ kind: "forward" });
    expect(decide("files/read", { skill_id: "skl-own", path: "x" })).toEqual({ kind: "forward" });
  });

  it("rejects another agent's private skill by id — this is the bypass being closed", () => {
    // Core scopes get by team only, so without this any skill_id in the team
    // was readable, private or not.
    const d = decide("get", { skill_id: "skl-private" });
    expect(d.kind).toBe("reject");
    expect((d as { reason: string }).reason).toBe("not_visible");
  });

  it("rejects an unknown id the same way as a private one, so the error is not an oracle", () => {
    const priv = decide("get", { skill_id: "skl-private" }) as { message: string };
    const gone = decide("get", { skill_id: "skl-does-not-exist" }) as { message: string };
    expect(priv.message.replace("skl-private", "X")).toBe(gone.message.replace("skl-does-not-exist", "X"));
  });

  it("leaves a missing id to schema validation", () => {
    expect(decide("get", {})).toEqual({ kind: "forward" });
  });
});

describe("get-by-name: resolve among visible skills, then read by id", () => {
  it("rewrites another agent's team-shared skill to a get by id — the cross-agent read that returned 40401", () => {
    // A consumer finds the author's skill through search, which is
    // team-visible; reading it by name then looked it up under the consumer's
    // own agent and found nothing.
    expect(decide("get-by-name", { skill_name: "eval-bridge-endpoint-a" }))
      .toEqual({ kind: "rewrite", skillId: "skl-shared" });
  });

  it("rewrites the caller's own skill too, so own reads keep working", () => {
    expect(decide("get-by-name", { skill_name: "my-notes" })).toEqual({ kind: "rewrite", skillId: "skl-own" });
  });

  it("forwards another agent's private skill unchanged, so core's 40401 stands and nothing is revealed", () => {
    expect(decide("get-by-name", { skill_name: "author-secret" })).toEqual({ kind: "forward" });
  });

  it("forwards an unknown name unchanged", () => {
    expect(decide("get-by-name", { skill_name: "nope" })).toEqual({ kind: "forward" });
  });

  it("prefers the caller's own skill on a name clash", () => {
    const clash: TeamSkillRef[] = [
      { skill_id: "skl-theirs", name: "deploy", owner_agent_id: OTHER },
      { skill_id: "skl-mine", name: "deploy", owner_agent_id: CALLER },
    ];
    expect(decide("get-by-name", { skill_name: "deploy" }, { teamSkills: clash, whitelist: new Set(["skl-theirs", "skl-mine"]) }))
      .toEqual({ kind: "rewrite", skillId: "skl-mine" });
  });

  it("does not guess between two other agents' visible skills with the same name", () => {
    const clash: TeamSkillRef[] = [
      { skill_id: "skl-a", name: "deploy", owner_agent_id: "agt-a" },
      { skill_id: "skl-b", name: "deploy", owner_agent_id: "agt-b" },
    ];
    expect(decide("get-by-name", { skill_name: "deploy" }, { teamSkills: clash, whitelist: new Set(["skl-a", "skl-b"]) }))
      .toEqual({ kind: "forward" });
  });
});

describe("everything else is untouched", () => {
  it("does not touch search, list, or writes", () => {
    for (const sub of ["search", "list", "listing", "update", "patch", "create", "delete", "extract"]) {
      expect(decide(sub, { skill_id: "skl-private", skill_name: "author-secret" })).toEqual({ kind: "forward" });
    }
  });
});
