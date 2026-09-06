import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildReceipt, buildItem, impactOf, evidenceOf, decisionsMap, STATUS_RANK } from "./build-receipt.mjs";
import { renderReceipt, renderItem, MARK } from "./render-cli.mjs";
import { validate, loadSchema } from "../contracts/validate.mjs";
import { parseJsonl } from "../provenance/build-events.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = loadSchema(join(HERE, "..", "contracts", "receipt.schema.json"));
const RUNS = join(HERE, "..", "runner", "runs");
const WRONG = "skl-sZFb3KatWY6m", RIGHT = "skl-oBaDO5CceKnr";
const AUTHOR = "usr-n68ea5ythq", CONSUMER = "usr-4u07qc2kuj";

function ev(state, asset, extra = {}) {
  return {
    schema_version: "provenance-v1", event_id: `evt-${asset.slice(-4)}-${state}-${Math.random().toString(36).slice(2, 6)}`,
    state, session_key: "sess-1", run_id: null, task_id: null, occurred_at: "2026-09-06T11:00:00Z",
    asset_id: asset, asset_type: "skill", asset_name: asset === WRONG ? "eval-bridge-endpoint-a" : "eval-bridge-endpoint-b",
    asset_version: 2, asset_created_at: "x", pool_snapshot_at: "x", excluded_by_snapshot: false,
    producer_user_id: AUTHOR, producer_agent_id: "agt-a", actor_user_id: CONSUMER, actor_agent_id: "agt-b",
    relation: "cross_user", observation: "bridge+wire", evidence_tier: null, bridge_source: "skill-bridge",
    executed_endpoint: "get", upstream_status: 200, target_type: null, target_ref: null,
    proof_refs: [{ kind: "bridge_row", ref: `tool_call_logs:t:skill-bridge:get`, detail: `request names ${asset}` }],
    corrected_reason: null, parent_event_ids: [], ...extra,
  };
}
const usedRef = (call) => `request(r):msg[9]:${call}:arguments`;
const used = (asset, call, token) => ev("used", asset, {
  evidence_tier: "hard", target_type: "tool_call", target_ref: usedRef(call),
  proof_refs: [{ kind: "tool_arg", ref: usedRef(call), detail: `token ${token}; content of v2 entered the context at message 7, before this operation at message 9` }],
});
// Mirrors judge-outcome: the outcome event keeps the used event's tool_arg proof beside its verify_result.
const outcome = (state, asset, call, host, port, ok, why, reason = null) => ev(state, asset, {
  evidence_tier: "hard", target_type: "tool_call", target_ref: usedRef(call), corrected_reason: reason,
  proof_refs: [
    { kind: "verify_result", ref: `sess-1:verify.mjs:call=${call}:ok=${ok}`, detail: state === "corrected" ? `the call it fed dialled ${host}:${port} — the asset's own value — and ${why}` : `the call it fed succeeded (${why}) and the run's acceptance passed` },
    { kind: "tool_arg", ref: usedRef(call), detail: `token ${asset === WRONG ? "10.244.7.19" : "47318"}; content of v2 entered the context at message 7, before this operation at message 9` },
  ],
  metadata: { call_id: call, attempt: { host, port, ok, why, message_index: 9 } },
});
const SNAPSHOT = { assets: [
  { asset_id: RIGHT, name: "eval-bridge-endpoint-b", asset_type: "skill", version: 2, producer_user_id: AUTHOR, producer_agent_id: "agt-a", asset_updated_at: "2026-09-05T15:07:26Z" },
  { asset_id: WRONG, name: "eval-bridge-endpoint-a", asset_type: "skill", version: 2, producer_user_id: AUTHOR, producer_agent_id: "agt-a", asset_updated_at: "2026-09-05T15:07:26Z" },
] };
const DECISIONS = [
  { asset_id: WRONG, decision: "reject", reasons: ["rule reject: a corrected record exists (reason=wrong)"], signals: { author: { confidence: 0.5 } } },
  { asset_id: RIGHT, decision: "admit", reasons: ["rule admit"], signals: { author: { confidence: 0.5 } } },
];

function mainlineEvents() {
  return [
    ev("recalled", WRONG), ev("injected", WRONG), ev("fetched", WRONG), used(WRONG, "call_00", "10.244.7.19"),
    outcome("corrected", WRONG, "call_00", "10.244.7.19", "8096", false, "timed out", "wrong"),
    ev("recalled", RIGHT), ev("injected", RIGHT), ev("fetched", RIGHT), used(RIGHT, "call_01", "47318"),
    outcome("validated", RIGHT, "call_01", "127.0.0.1", "47318", true, "code 0"),
  ];
}

test("mainline receipt: right validated, wrong corrected, both from the author, cross_user", () => {
  const r = buildReceipt({ events: mainlineEvents(), snapshot: SNAPSHOT, decisions: DECISIONS, runId: "run-x", taskId: "task-t", generatedAt: "2026-09-06T12:00:00Z" });
  assert.deepEqual(validate(SCHEMA, r), []);
  assert.equal(r.summary.applied_count, 2);
  assert.deepEqual(r.summary.by_status, { validated: 1, used: 0, fetched: 0, provided: 0, corrected: 1 });
  const by = Object.fromEntries(r.items.map((i) => [i.asset_id, i]));
  assert.equal(by[RIGHT].status, "validated");
  assert.equal(by[WRONG].status, "corrected");
  for (const i of r.items) {
    assert.equal(i.source.producer_user_id, AUTHOR);
    assert.equal(i.source.relation, "cross_user");
    assert.equal(i.author_confidence, 0.5);
    assert.equal(i.updated_at, "2026-09-05T15:07:26Z");
  }
  assert.equal(by[WRONG].gate_decision, "reject");
  assert.deepEqual(by[WRONG].risks.map((x) => x.kind), ["gate_rejected"]);
  assert.deepEqual(by[WRONG].related_tests, [{ command: "verify.mjs: dial 10.244.7.19:8096 (call_00)", passed: false }]);
  assert.deepEqual(by[RIGHT].related_tests, [{ command: "verify.mjs: dial 127.0.0.1:47318 (call_01)", passed: true }]);
  assert.match(by[RIGHT].impact, /its value 47318 was used in tool call call_01 \(message 9\); the call succeeded/);
  assert.match(by[WRONG].impact, /its value 10.244.7.19 .* and the call failed: .*timed out/);
  // corrected sorts first: the receipt surfaces risk before success
  assert.equal(r.items[0].asset_id, WRONG);
});

test("status ranking: corrected outranks validated on the same asset; needs_review lands at fetched with a risk", () => {
  const both = [used(RIGHT, "c1", "47318"), outcome("validated", RIGHT, "c1", "127.0.0.1", "47318", true, "code 0"), outcome("corrected", RIGHT, "c2", "127.0.0.1", "47318", false, "timed out", "wrong")];
  assert.equal(buildItem({ assetId: RIGHT, events: both, snapshot: SNAPSHOT, decision: null }).status, "corrected");
  const nr = ev("needs_review", RIGHT, { evidence_tier: "hard", target_type: "tool_call", target_ref: usedRef("c3"), proof_refs: [{ kind: "tool_arg", ref: usedRef("c3"), detail: "token 47318; the token was in a search snippet (message 3) before this operation, so its use cannot be told apart from reading that snippet" }] });
  const item = buildItem({ assetId: RIGHT, events: [ev("fetched", RIGHT), nr], snapshot: SNAPSHOT, decision: null });
  assert.equal(item.status, "fetched");
  assert.deepEqual(item.risks.map((x) => x.kind), ["needs_review"]);
  assert.match(item.impact, /cannot be told apart from reading that snippet/);
  assert.ok(STATUS_RANK.corrected > STATUS_RANK.validated);
});

test("provided only: never fetched, no impact, evidence from the listing, counted apart", () => {
  const r = buildReceipt({ events: [ev("recalled", WRONG, { proof_refs: [{ kind: "bridge_response", ref: "capture:search:r1", detail: "listed in search results" }] }), ev("injected", WRONG, { proof_refs: [{ kind: "injected_block", ref: "capture:tool_result:x" }] })], snapshot: SNAPSHOT, generatedAt: "t" });
  assert.deepEqual(validate(SCHEMA, r), []);
  assert.equal(r.summary.applied_count, 0);
  assert.equal(r.summary.by_status.provided, 1);
  const item = r.items[0];
  assert.equal(item.status, "provided");
  assert.equal(item.impact, null);
  assert.deepEqual(item.evidence.map((e) => e.kind).sort(), ["bridge_row", "session_message"]);
  assert.equal(item.gate_decision, null);
});

test("soft evidence stands alone: used_soft status, soft_only_count, never a check mark", () => {
  const soft = ev("used_soft", RIGHT, { evidence_tier: "soft", target_type: "decision", target_ref: "claim:1", proof_refs: [{ kind: "session_message", ref: "msg-17", detail: "cheap model judged claim related" }] });
  const r = buildReceipt({ events: [ev("fetched", RIGHT), soft], snapshot: SNAPSHOT, generatedAt: "t" });
  assert.equal(r.items[0].status, "used_soft");
  assert.equal(r.summary.soft_only_count, 1);
  assert.equal(r.summary.by_status.used, 0);
  const text = renderItem(r.items[0]);
  assert.ok(text.startsWith(MARK.used_soft));
  assert.notEqual(MARK.used_soft, MARK.validated);
  assert.match(text, /a model's judgement only/);
});

test("risks: gate pending, author not computable, not head", () => {
  const item = buildItem({
    assetId: RIGHT, events: [ev("fetched", RIGHT, { asset_version: 1 })], snapshot: SNAPSHOT,
    decision: { asset_id: RIGHT, decision: "pending", reasons: ["cold start"], signals: { author: { confidence: null } } },
  });
  assert.deepEqual(item.risks.map((x) => x.kind).sort(), ["gate_pending", "low_confidence", "not_head"]);
  assert.equal(item.author_confidence, null);
  assert.match(renderItem(item), /no cross-person validation yet/);
  assert.ok(!/confidence 0\b/.test(renderItem(item)));
});

test("excluded-by-snapshot events do not appear", () => {
  const r = buildReceipt({ events: [ev("fetched", "skl-late", { excluded_by_snapshot: true })], generatedAt: "t" });
  assert.equal(r.items.length, 0);
  assert.deepEqual(validate(SCHEMA, r), []);
});

test("wording: related test … passed/failed, never 'verified'", () => {
  const r = buildReceipt({ events: mainlineEvents(), snapshot: SNAPSHOT, decisions: DECISIONS, generatedAt: "t" });
  const text = renderReceipt(r);
  assert.match(text, /related test verify\.mjs: dial 127\.0\.0\.1:47318 \(call_01\) passed/);
  assert.match(text, /related test verify\.mjs: dial 10\.244\.7\.19:8096 \(call_00\) failed/);
  assert.ok(!/verified/i.test(text));
  assert.match(text, /✗ eval-bridge-endpoint-a/);
  assert.match(text, /✓ eval-bridge-endpoint-b/);
  assert.match(text, /applied 2 team asset\(s\)\n- skill：eval-bridge-endpoint-a/);
  assert.match(text, /effect status\n- 1 validated by a related test\n- 1 corrected/);
});

test("helpers: decisionsMap accepts an array or a baseline; evidenceOf dedupes; impactOf null for fetched", () => {
  assert.equal(decisionsMap(DECISIONS).get(WRONG).decision, "reject");
  assert.equal(decisionsMap({ decisions: DECISIONS }).get(RIGHT).decision, "admit");
  const dup = [ev("fetched", RIGHT), ev("fetched", RIGHT)];
  assert.equal(evidenceOf(dup).length, 1);
  assert.equal(impactOf(ev("fetched", RIGHT), "fetched"), null);
});

test("real run: gate-off receipt shows wrong corrected and right validated with the baseline's decisions", () => {
  const dir = join(RUNS, "20260906T111638Z-gate-off");
  const baseline = join(HERE, "..", "gate", "artifacts", "gate_baseline.json");
  if (!existsSync(join(dir, "outcome-events.jsonl")) || !existsSync(baseline)) return;
  const events = ["events.jsonl", "early-events.jsonl", "used-events.jsonl", "outcome-events.jsonl"].flatMap((f) => parseJsonl(readFileSync(join(dir, f), "utf8")));
  const run = JSON.parse(readFileSync(join(dir, "run.json"), "utf8"));
  const r = buildReceipt({
    events, snapshot: JSON.parse(readFileSync(join(dir, "asset-pool-snapshot.json"), "utf8")),
    decisions: JSON.parse(readFileSync(baseline, "utf8")), runId: run.run_id, taskId: run.resolved_identity?.task_id, sessionKey: run.conversation_id,
  });
  assert.deepEqual(validate(SCHEMA, r), []);
  const by = Object.fromEntries(r.items.map((i) => [i.asset_id, i]));
  assert.equal(by[WRONG].status, "corrected");
  assert.equal(by[RIGHT].status, "validated");
  assert.equal(by[WRONG].gate_decision, "reject");
  assert.equal(r.task_id, "task-5e6xp4mrrw");
  assert.equal(by[RIGHT].source.relation, "cross_user");
});

// ── task-four alignment: category, why offered, sample wording, Chinese ──
import { categoryOf, whyApplicableOf } from "./build-receipt.mjs";

const recalled = (asset, rank, total, score, query) => ev("recalled", asset, {
  observation: "wire_only", proof_refs: [{ kind: "bridge_response", ref: `capture:skill:search:${asset}`, detail: `skill:search returned ${total} candidate(s), this one at rank ${rank}` }],
  metadata: { relevance: { query, rank, total, score, description: "Team convention …" } },
});

test("category comes only from what is declared: skill → skill, undeclared knowledge → not_declared, declared category honoured", () => {
  assert.equal(categoryOf({ snapshotRow: { asset_type: "skill" } }), "skill");
  assert.equal(categoryOf({ snapshotRow: { asset_type: "knowledge", description: "Team convention for deploys" } }), "not_declared");
  assert.equal(categoryOf({ snapshotRow: { asset_type: "memory", category: "failure_experience" } }), "failure_experience");
  assert.equal(categoryOf({ snapshotRow: { asset_type: "memory", category: "made-up" } }), "not_declared");
  assert.equal(categoryOf({ events: [{ asset_type: "knowledge", metadata: { category: "code_knowledge" } }] }), "code_knowledge");
});

test("why_applicable is the retrieval system's own record, null when the asset was never offered", () => {
  const q = "skill-bridge convention 接口地址";
  assert.equal(whyApplicableOf([recalled(RIGHT, 3, 3, 7.57e-6, q)]), `offered at rank 3 of 3 (score 7.57e-6) for the query "${q}"`);
  assert.equal(whyApplicableOf([recalled(RIGHT, 1, 2, 4.2, q)]), `offered at rank 1 of 2 (score 4.20) for the query "${q}"`);
  assert.equal(whyApplicableOf([ev("fetched", RIGHT)]), null);
});

test("the receipt carries category and why_applicable, validates, and renders the topic's sample shape in both languages", () => {
  const q = "reach bridge http";
  const events = [recalled(WRONG, 2, 3, 0.5, q), recalled(RIGHT, 3, 3, 0.5, q), ...mainlineEvents()];
  const r = buildReceipt({ events, snapshot: SNAPSHOT, decisions: DECISIONS, generatedAt: "t" });
  assert.deepEqual(validate(SCHEMA, r), []);
  const by = Object.fromEntries(r.items.map((i) => [i.asset_id, i]));
  assert.equal(by[RIGHT].category, "skill");
  assert.match(by[RIGHT].why_applicable, /offered at rank 3 of 3 .* for the query "reach bridge http"/);
  const en = renderReceipt(r, "en");
  assert.match(en, /applied 2 team asset\(s\)/);
  assert.match(en, /- skill：eval-bridge-endpoint-b — its value 47318/);
  assert.match(en, /effect status\n- 1 validated by a related test\n- 1 corrected/);
  assert.match(en, /why offered\s+offered at rank 3 of 3/);
  const zh = renderReceipt(r, "zh");
  assert.match(zh, /本次应用 2 项团队资产/);
  assert.match(zh, /- Skill：eval-bridge-endpoint-b/);
  assert.match(zh, /效果状态\n- 1 项已通过相关测试验证\n- 1 项被证明错误/);
  assert.match(zh, /相关测试 verify\.mjs: dial 127\.0\.0\.1:47318 \(call_01\) 通过/);
  assert.match(zh, /闸门 拒绝/);
  assert.ok(!/verified/i.test(en));
});

test("background-only assets are counted as 'effect unverified', never as used", () => {
  const r = buildReceipt({ events: [recalled(RIGHT, 1, 1, 1, "q"), ev("fetched", RIGHT)], snapshot: SNAPSHOT, generatedAt: "t" });
  const zh = renderReceipt(r, "zh");
  assert.match(zh, /本次应用 1 项团队资产/);
  assert.match(zh, /1 项仅作为背景参考（取回或提供），效果待验证/);
  assert.equal(r.summary.by_status.used, 0);
});
