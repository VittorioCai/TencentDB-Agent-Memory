import { test } from "node:test";
import assert from "node:assert/strict";
import { authorConfidence, authorTallies, leaveOneOutMean, allAuthors, countsForAuthor, renderAuthors, ALPHA, NEUTRAL_PRIOR } from "./author-confidence.mjs";

function ev(state, { producer = "usr-alice", agent = "agt-alice", actor = "usr-bob", relation = "cross_user", reason = null, asset = "skl-1", task = null, at = "2026-09-05T10:00:00Z", excluded = false } = {}) {
  return {
    state, producer_user_id: producer, producer_agent_id: agent, actor_user_id: actor, actor_agent_id: "agt-" + actor,
    relation, corrected_reason: reason, asset_id: asset, task_id: task, occurred_at: at, excluded_by_snapshot: excluded,
  };
}

test("no cross-person outcomes → null, not 0, and computable=false", () => {
  const r = authorConfidence([ev("fetched"), ev("used")], "usr-alice");
  assert.equal(r.confidence, null);
  assert.equal(r.computable, false);
  assert.equal(r.validated, 0);
});

test("self validation counts as zero", () => {
  const r = authorConfidence([ev("validated", { relation: "self", actor: "usr-alice" })], "usr-alice");
  assert.equal(r.computable, false);
  assert.equal(r.confidence, null);
});

test("cross_agent validation does not count either — only cross_user is team evidence", () => {
  const r = authorConfidence([ev("validated", { relation: "cross_agent" })], "usr-alice");
  assert.equal(r.computable, false);
});

test("shrinkage: one validation out of one is not 1.0", () => {
  const r = authorConfidence([ev("validated")], "usr-alice");
  assert.equal(r.computable, true);
  assert.equal(r.raw_rate, 1);
  // Only author in the pool → neutral prior, stated as such.
  assert.equal(r.prior, NEUTRAL_PRIOR);
  assert.match(r.prior_source, /neutral/);
  assert.equal(r.confidence, Math.round(((1 + ALPHA * 0.5) / (1 + ALPHA)) * 1000) / 1000); // 0.583
  assert.ok(r.confidence < 1);
});

test("a corrected(wrong) on another asset of the same author pulls the score down", () => {
  const r = authorConfidence([ev("validated", { asset: "skl-right" }), ev("corrected", { reason: "wrong", asset: "skl-wrong" })], "usr-alice");
  assert.equal(r.validated, 1);
  assert.equal(r.corrected, 1);
  assert.equal(r.confidence, 0.5); // (1 + 2.5) / (2 + 5)
});

test("corrected with a non-downweighting reason (superseded) does not count", () => {
  const r = authorConfidence([ev("validated"), ev("corrected", { reason: "superseded", asset: "skl-2" })], "usr-alice");
  assert.equal(r.corrected, 0);
});

test("decoy assets are excluded from the author's tally", () => {
  const events = [ev("validated", { asset: "skl-real" }), ev("corrected", { reason: "wrong", asset: "skl-decoy" })];
  const r = authorConfidence(events, "usr-alice", { decoyIds: new Set(["skl-decoy"]) });
  assert.equal(r.corrected, 0);
  assert.equal(r.validated, 1);
});

test("events excluded by the snapshot never count", () => {
  const r = authorConfidence([ev("validated", { excluded: true })], "usr-alice");
  assert.equal(r.computable, false);
});

test("the prior is leave-one-out: the author being scored does not set their own prior", () => {
  const events = [
    ev("validated", { producer: "usr-alice" }),
    ev("validated", { producer: "usr-carol", asset: "skl-c1" }),
    ev("corrected", { producer: "usr-carol", asset: "skl-c2", reason: "wrong" }),
    ev("corrected", { producer: "usr-carol", asset: "skl-c3", reason: "stale" }),
  ];
  const tallies = authorTallies(events);
  assert.equal(leaveOneOutMean(tallies, "usr-alice"), 1 / 3); // carol's rate only
  assert.equal(leaveOneOutMean(tallies, "usr-carol"), 1); // alice's rate only
  // Carol's 3 outcomes at rate 1/3, shrunk toward neutral: (3·⅓ + 5·0.5)/(3+5) = 0.4375
  const alice = authorConfidence(events, "usr-alice");
  assert.equal(alice.prior, 0.438);
  assert.match(alice.prior_source, /1 other author\(s\) over 3 outcome\(s\)/);
  assert.equal(alice.confidence, Math.round(((1 + ALPHA * 0.4375) / (1 + ALPHA)) * 1000) / 1000);
  // and the neighbour's single extreme does not flip the ordering: alice (1/0) above carol (1/2)
  assert.ok(alice.confidence > authorConfidence(events, "usr-carol").confidence);
});

test("two authors with one outcome each: one validation still scores above one correction", () => {
  const events = [ev("validated", { producer: "usr-a" }), ev("corrected", { producer: "usr-b", asset: "skl-b", reason: "wrong" })];
  const a = authorConfidence(events, "usr-a"), b = authorConfidence(events, "usr-b");
  assert.ok(a.confidence > b.confidence, `${a.confidence} vs ${b.confidence}`);
});

test("person and agent are scored separately", () => {
  const events = [
    ev("validated", { producer: "usr-alice", agent: "agt-a1", asset: "skl-1" }),
    ev("corrected", { producer: "usr-alice", agent: "agt-a2", asset: "skl-2", reason: "wrong" }),
  ];
  const user = authorConfidence(events, "usr-alice", { by: "user" });
  const a1 = authorConfidence(events, "agt-a1", { by: "agent" });
  const a2 = authorConfidence(events, "agt-a2", { by: "agent" });
  assert.equal(user.validated, 1); assert.equal(user.corrected, 1);
  assert.equal(a1.validated, 1); assert.equal(a1.corrected, 0);
  assert.equal(a2.validated, 0); assert.equal(a2.corrected, 1);
  assert.ok(a1.confidence > a2.confidence);
});

test("distinct consumers and tasks are reported, not folded into the score", () => {
  const events = [
    ev("validated", { actor: "usr-bob", task: "task-1" }),
    ev("validated", { actor: "usr-bob", task: "task-1", asset: "skl-2" }),
    ev("validated", { actor: "usr-carol", task: "task-2", asset: "skl-3" }),
  ];
  const r = authorConfidence(events, "usr-alice");
  assert.equal(r.distinct_consumers, 2);
  assert.equal(r.distinct_tasks, 2);
  assert.equal(r.validated, 3);
});

test("allAuthors lists every producer under both keys, and renders", () => {
  const events = [ev("validated"), ev("fetched", { producer: "usr-dave", agent: "agt-dave" })];
  const all = allAuthors(events);
  assert.deepEqual(all.user.map((r) => r.author), ["usr-alice", "usr-dave"]);
  assert.deepEqual(all.agent.map((r) => r.author), ["agt-alice", "agt-dave"]);
  assert.equal(all.user[1].computable, false);
  const text = renderAuthors(all);
  assert.match(text, /usr-dave.*not computable/);
});

test("countsForAuthor gate", () => {
  assert.equal(countsForAuthor(ev("validated"), new Set()), true);
  assert.equal(countsForAuthor(ev("corrected", { reason: "wrong" }), new Set()), true);
  assert.equal(countsForAuthor(ev("corrected", { reason: "inapplicable" }), new Set()), false);
  assert.equal(countsForAuthor(ev("used"), new Set()), false);
});
