import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decide, decideAsset, onlineSignals, authorRecentWrong, USAGE_STATES } from "./decide.mjs";
import { renderDecisions } from "./render-decision.mjs";
import { judgeOutcome } from "../attribution/judge-outcome.mjs";
import { validate, loadSchema } from "../contracts/validate.mjs";
import { parseJsonl } from "../provenance/build-events.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE_SCHEMA = loadSchema(join(HERE, "..", "contracts", "gate-decision.schema.json"));
const NOW = "2026-09-06T00:00:00Z";

const AUTHOR = "usr-n68ea5ythq", AUTHOR_AGENT = "agt-5e4hna56j9";
const CONSUMER = "usr-4u07qc2kuj";
const WRONG = "skl-sZFb3KatWY6m", RIGHT = "skl-oBaDO5CceKnr";

function ev(state, asset, { relation = "cross_user", reason = null, id, parents = [], producer = AUTHOR, actor = CONSUMER, task = null, at = "2026-09-05T22:00:00Z", excluded = false, detail = "" } = {}) {
  return {
    schema_version: "provenance-v1", event_id: id ?? `evt-${asset}-${state}-${Math.random().toString(36).slice(2, 8)}`,
    state, session_key: "s", run_id: null, task_id: task, occurred_at: at,
    asset_id: asset, asset_type: "skill", asset_name: asset, asset_version: 2,
    asset_created_at: "2026-09-05T15:07:26Z", pool_snapshot_at: "2026-09-05T15:07:26Z", excluded_by_snapshot: excluded,
    producer_user_id: producer, producer_agent_id: AUTHOR_AGENT, actor_user_id: actor, actor_agent_id: "agt-" + actor,
    relation, observation: "bridge+wire", evidence_tier: state === "fetched" ? null : "hard",
    bridge_source: "skill-bridge", executed_endpoint: "get", upstream_status: 200, target_type: null, target_ref: null,
    proof_refs: [{ kind: "verify_result", ref: "r", detail }], corrected_reason: reason, parent_event_ids: parents,
  };
}

const SNAPSHOT = {
  pool_snapshot_at: "2026-09-05T15:07:26Z", team_id: "team-5ezfoladb5", asset_count: 2,
  assets: [
    { asset_id: RIGHT, asset_type: "skill", name: "eval-bridge-endpoint-b", producer_user_id: AUTHOR, producer_agent_id: AUTHOR_AGENT, version: 2 },
    { asset_id: WRONG, asset_type: "skill", name: "eval-bridge-endpoint-a", producer_user_id: AUTHOR, producer_agent_id: AUTHOR_AGENT, version: 2 },
  ],
};

function assertContract(decisions) {
  for (const d of decisions) assert.deepEqual(validate(GATE_SCHEMA, d), [], `${d.asset_id}: ${JSON.stringify(d).slice(0, 300)}`);
}

test("reject: any corrected(wrong) wins, even with cross_user validated present", () => {
  const used = ev("used", WRONG, { id: "evt-used-w" });
  const events = [used, ev("corrected", WRONG, { reason: "wrong", id: "evt-corr-w", parents: ["evt-used-w"], detail: "dialled 10.244.7.19:8096 and timed out" }), ev("validated", WRONG, { id: "evt-val-w" })];
  const [d] = decide({ events, snapshot: { assets: [SNAPSHOT.assets[1]] }, now: NOW });
  assert.equal(d.decision, "reject");
  assert.match(d.reasons[0], /rule reject.*reason=wrong.*timed out/);
  assert.match(d.reasons[1], /do not override/);
  assert.deepEqual(d.evidence_refs.map((r) => r.event_id).sort(), ["evt-corr-w", "evt-used-w"]);
  assertContract([d]);
});

test("corrected(superseded) does not reject", () => {
  const events = [ev("corrected", WRONG, { reason: "superseded" })];
  const [d] = decide({ events, snapshot: { assets: [SNAPSHOT.assets[1]] }, now: NOW });
  assert.equal(d.decision, "pending");
});

test("admit: cross_user validated ≥ 1 and no corrected, citing the validated and its used parent", () => {
  const events = [ev("fetched", RIGHT), ev("used", RIGHT, { id: "evt-used-r" }), ev("validated", RIGHT, { id: "evt-val-r", parents: ["evt-used-r"] })];
  const [d] = decide({ events, snapshot: { assets: [SNAPSHOT.assets[0]] }, now: NOW });
  assert.equal(d.decision, "admit");
  assert.match(d.reasons[0], /rule admit: cross_user validated >= 1 \(1 record/);
  assert.deepEqual(d.evidence_refs.map((r) => r.event_id).sort(), ["evt-used-r", "evt-val-r"]);
  assert.equal(d.signals.online.cross_user_validated, 1);
  assertContract([d]);
});

test("self validation does not admit", () => {
  const events = [ev("validated", RIGHT, { relation: "self", actor: AUTHOR })];
  const [d] = decide({ events, snapshot: { assets: [SNAPSHOT.assets[0]] }, now: NOW });
  assert.equal(d.decision, "pending");
  assert.match(d.reasons[0], /only by self/);
  assert.equal(d.signals.online.cross_user_validated, 0);
  assert.equal(d.signals.online.validated, 1);
});

test("pending variants name what is missing, and never cite nothing for admit/reject", () => {
  const cases = [
    [[ev("fetched", RIGHT)], /fetched 1 time\(s\) without any evidence of use/],
    [[ev("used", RIGHT)], /used with hard evidence 1 time\(s\) but no outcome/],
    [[ev("used_soft", RIGHT)], /soft evidence only/],
    [[ev("needs_review", RIGHT)], /needs_review only/],
  ];
  for (const [events, re] of cases) {
    const [d] = decide({ events, snapshot: { assets: [SNAPSHOT.assets[0]] }, now: NOW });
    assert.equal(d.decision, "pending");
    assert.match(d.reasons[0], re);
    assert.match(d.reasons[1], /no corrected record/);
    assertContract([d]);
  }
});

test("mainline acceptance: wrong → reject and right → admit from one run's real events", () => {
  const dir = join(HERE, "..", "runner", "runs", "20260905T220020Z-gate-off");
  let usedEvents, verdictDoc, fetched;
  try {
    usedEvents = parseJsonl(readFileSync(join(dir, "used-events.jsonl"), "utf8"));
    verdictDoc = JSON.parse(readFileSync(join(dir, "verdict.json"), "utf8"));
    fetched = parseJsonl(readFileSync(join(dir, "events.jsonl"), "utf8"));
  } catch {
    return; // run directory absent
  }
  const tokens = { [WRONG]: { version: 2, tokens: ["10.244.7.19"] }, [RIGHT]: { version: 2, tokens: ["47318"] } };
  const outcome = judgeOutcome({ usedEvents, verdictDoc, tokensByAsset: tokens }).events;
  const decisions = decide({ events: [...fetched, ...usedEvents, ...outcome], snapshot: SNAPSHOT, now: NOW, tokensByAsset: tokens });
  const by = Object.fromEntries(decisions.map((d) => [d.asset_id, d]));
  assert.equal(by[WRONG].decision, "reject");
  assert.equal(by[RIGHT].decision, "admit");
  // Both cite real event ids from the run, resolvable by a reviewer.
  for (const d of decisions) {
    assert.ok(d.evidence_refs.length >= 2);
    for (const r of d.evidence_refs) assert.ok([...fetched, ...usedEvents, ...outcome].some((e) => e.event_id === r.event_id), r.event_id);
    assert.equal(d.signals.author.user_id, AUTHOR);
  }
  // Author has V=1 (right) and C=1 (wrong) → computable, shrunk to 0.5 on the neutral prior.
  assert.equal(by[RIGHT].signals.author.computable, true);
  assert.equal(by[RIGHT].signals.author.confidence, 0.5);
  assert.equal(by[RIGHT].signals.offline.has_concrete_values, true);
  assertContract(decisions);
  const text = renderDecisions(decisions);
  assert.match(text, /REJECT.*eval-bridge-endpoint-a/);
  assert.match(text, /ADMIT.*eval-bridge-endpoint-b/);
  assert.match(text, /admit 1, pending 0, reject 1/);
});

test("cold start: no usage evidence → pending, author with recent wrong → review priority high", () => {
  const NEW = "skl-new";
  const events = [
    ev("recalled", NEW), ev("injected", NEW),
    ev("used", WRONG, { id: "u-w" }), ev("corrected", WRONG, { reason: "wrong", parents: ["u-w"], at: "2026-09-05T22:00:00Z" }),
  ];
  const snapshot = { assets: [{ asset_id: NEW, asset_type: "skill", name: "brand-new", producer_user_id: AUTHOR, producer_agent_id: AUTHOR_AGENT }] };
  const [d] = decide({ events, snapshot, now: NOW });
  assert.equal(d.decision, "pending");
  assert.match(d.reasons[0], /cold start/);
  assert.ok(d.reasons.some((r) => new RegExp(`author ${AUTHOR} has 1 asset\\(s\\) judged wrong within 30 days \\(${WRONG}\\); review priority: high`).test(r)), d.reasons.join("\n"));
  assert.equal(d.evidence_refs.length, 0);
  // The author's tally is V=0, C=1: computable, shrunk toward the neutral prior → (0 + 5·0.5)/(1+5)
  assert.equal(d.signals.author.computable, true);
  assert.equal(d.signals.author.confidence, 0.417);
  assertContract([d]);
});

test("cold start: an old wrong outside the window does not raise the priority", () => {
  const events = [ev("used", WRONG, { id: "u-w" }), ev("corrected", WRONG, { reason: "wrong", parents: ["u-w"], at: "2026-06-01T00:00:00Z" })];
  const snapshot = { assets: [{ asset_id: "skl-new", asset_type: "skill", producer_user_id: AUTHOR, producer_agent_id: AUTHOR_AGENT }] };
  const [d] = decide({ events, snapshot, now: NOW });
  assert.ok(!d.reasons.some((r) => /review priority: high/.test(r)));
  assert.ok(d.reasons.some((r) => /review priority: normal/.test(r)));
});

test("cold start: reliable author (confidence ≥ 0.8) → review priority low", () => {
  const events = [];
  for (let i = 0; i < 12; i++) events.push(ev("validated", `skl-old-${i}`, { actor: i % 2 ? "usr-bob" : "usr-carol" }));
  const snapshot = { assets: [{ asset_id: "skl-new", asset_type: "skill", producer_user_id: AUTHOR, producer_agent_id: AUTHOR_AGENT }] };
  const [d] = decide({ events, snapshot, now: NOW });
  assert.equal(d.decision, "pending");
  assert.ok(d.signals.author.confidence >= 0.8, String(d.signals.author.confidence));
  assert.ok(d.reasons.some((r) => /author history reliable.*review priority: low/.test(r)), d.reasons.join("\n"));
});

test("cold start: unknown author → not computable, priority normal, confidence null", () => {
  const snapshot = { assets: [{ asset_id: "skl-new", asset_type: "skill", producer_user_id: "usr-nobody", producer_agent_id: "agt-nobody" }] };
  const [d] = decide({ events: [], snapshot, now: NOW });
  assert.equal(d.decision, "pending");
  assert.equal(d.signals.author.confidence, null);
  assert.equal(d.signals.author.computable, false);
  assert.ok(d.reasons.some((r) => /not computable.*review priority: normal/.test(r)));
  assertContract([d]);
});

test("the author signal never changes admit or reject", () => {
  // A reliable author with a rejected asset stays rejected; a wrong-prone author with a validated asset is still admitted.
  const events = [];
  for (let i = 0; i < 12; i++) events.push(ev("validated", `skl-old-${i}`));
  events.push(ev("used", WRONG, { id: "u-w" }), ev("corrected", WRONG, { reason: "wrong", parents: ["u-w"] }));
  const decisions = decide({ events, snapshot: SNAPSHOT, now: NOW });
  const by = Object.fromEntries(decisions.map((d) => [d.asset_id, d]));
  assert.equal(by[WRONG].decision, "reject");
  assert.ok(by[WRONG].signals.author.confidence > 0.8);
});

test("events excluded by the snapshot are reported but never counted", () => {
  const events = [ev("validated", RIGHT, { excluded: true }), ev("validated", RIGHT, { excluded: true })];
  const [d] = decide({ events, snapshot: { assets: [SNAPSHOT.assets[0]] }, now: NOW });
  assert.equal(d.decision, "pending");
  assert.equal(d.signals.online.validated, 0);
  assert.ok(d.reasons.some((r) => /2 event\(s\) excluded by the pool snapshot/.test(r)));
});

test("an asset seen only in events (not in the snapshot) still gets a decision row", () => {
  const events = [ev("fetched", "skl-stranger", { excluded: true })];
  const decisions = decide({ events, snapshot: SNAPSHOT, now: NOW });
  const d = decisions.find((x) => x.asset_id === "skl-stranger");
  assert.ok(d);
  assert.equal(d.decision, "pending");
});

test("decoys are flagged with their expected decision and excluded from the author's tally", () => {
  const events = [ev("used", "skl-decoy", { id: "u-d" }), ev("corrected", "skl-decoy", { reason: "wrong", parents: ["u-d"] }), ev("validated", RIGHT)];
  const snapshot = { assets: [...SNAPSHOT.assets, { asset_id: "skl-decoy", asset_type: "skill", name: "decoy", producer_user_id: AUTHOR, producer_agent_id: AUTHOR_AGENT }] };
  const decisions = decide({ events, snapshot, decoys: [{ asset_id: "skl-decoy", expected_decision: "reject" }], now: NOW });
  const by = Object.fromEntries(decisions.map((d) => [d.asset_id, d]));
  assert.equal(by["skl-decoy"].is_decoy, true);
  assert.equal(by["skl-decoy"].expected_decision, "reject");
  assert.equal(by["skl-decoy"].decision, "reject");
  // Author tally: V=1 from RIGHT, the decoy's corrected excluded → confidence > 0.5
  assert.ok(by[RIGHT].signals.author.confidence > 0.5);
  assertContract(decisions);
  assert.match(renderDecisions(decisions), /decoys not counted/);
});

test("onlineSignals counts distinct tasks only from validated events, and actors from usage states", () => {
  const s = onlineSignals([
    ev("fetched", RIGHT, { actor: "usr-a" }), ev("recalled", RIGHT, { actor: "usr-z" }),
    ev("validated", RIGHT, { actor: "usr-b", task: "t1" }), ev("validated", RIGHT, { actor: "usr-b", task: "t2" }), ev("used", RIGHT, { actor: "usr-b", task: "t9" }),
  ]);
  assert.equal(s.distinct_actors, 2);
  assert.equal(s.distinct_tasks, 2);
  assert.equal(s.fetched, 1);
  assert.equal(s.validated, 2);
  assert.ok(!USAGE_STATES.has("recalled"));
});

test("authorRecentWrong excludes the asset under decision and other authors", () => {
  const events = [
    ev("corrected", "skl-a", { reason: "wrong" }),
    ev("corrected", "skl-b", { reason: "wrong", producer: "usr-other" }),
    ev("corrected", "skl-c", { reason: "stale" }),
  ];
  assert.deepEqual(authorRecentWrong(events, AUTHOR, { exceptAssetId: "skl-a", now: NOW }), []);
  assert.deepEqual(authorRecentWrong(events, AUTHOR, { exceptAssetId: "skl-x", now: NOW }), ["skl-a"]);
});

test("decideAsset with a stub asset row and no producer resolves the author from events", () => {
  const d = decideAsset({ asset: { asset_id: RIGHT }, events: [ev("validated", RIGHT)], now: NOW });
  assert.equal(d.signals.author.user_id, AUTHOR);
  assert.equal(d.decision, "admit");
});
