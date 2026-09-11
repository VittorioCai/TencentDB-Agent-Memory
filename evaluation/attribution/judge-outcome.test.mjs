import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { judgeOutcome, outcomeOf, callIdOf, dialledToken, renderOutcome } from "./judge-outcome.mjs";
import { validate, loadSchema } from "../contracts/validate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = loadSchema(join(HERE, "..", "contracts", "provenance-event.schema.json"));

// Shapes copied from run 3 (20260905T220020Z-gate-off): the model dialled the
// wrong asset's address first, timed out, then the right one and succeeded.
const SESSION = "f2bf3856-ba09-466d-9f36-4ea379b10d3a";
const WRONG_CALL = "call_00_G9aDxkOvysoOoLobMkc56726";
const RIGHT_CALL = "call_01_zEo9sgfRF9BvaP8sOaqG1636";

function used(assetId, name, callId, token, extra = {}) {
  return {
    schema_version: "provenance-v1",
    event_id: `evt-used-${assetId}-${callId.slice(-4)}`,
    state: "used",
    session_key: SESSION,
    run_id: null, task_id: null,
    occurred_at: "2026-09-05T22:00:32.000Z",
    asset_id: assetId, asset_type: "skill", asset_name: name, asset_version: 2,
    asset_created_at: "2026-09-05T15:07:26Z", pool_snapshot_at: "2026-09-05T15:07:26Z",
    excluded_by_snapshot: false,
    producer_user_id: "usr-n68ea5ythq", producer_agent_id: "agt-5e4hna56j9",
    actor_user_id: "usr-4u07qc2kuj", actor_agent_id: "agt-5e0y4l8a7a",
    relation: "cross_user", observation: "bridge+wire", evidence_tier: "hard",
    bridge_source: "skill-bridge", executed_endpoint: "get", upstream_status: 200,
    target_type: "tool_call",
    target_ref: `request(0cb5d538):msg[22]:${callId}:arguments`,
    proof_refs: [
      { kind: "tool_arg", ref: `request(0cb5d538):msg[22]:${callId}:arguments`, detail: `token ${token}; content of v2 entered the context at message 20, before this operation at message 22` },
      { kind: "bridge_row", ref: "tool_call_logs:…:skill-bridge:get", detail: `request names ${assetId}` },
    ],
    corrected_reason: null,
    parent_event_ids: [`evt-fetched-${assetId}`],
    ...extra,
  };
}

const WRONG = "skl-sZFb3KatWY6m";
const RIGHT = "skl-oBaDO5CceKnr";
const TOKENS = { [WRONG]: { version: 2, tokens: ["10.244.7.19"] }, [RIGHT]: { version: 2, tokens: ["47318"] } };
// The independent probe the judge needs before it may call an asset wrong.
const REACH = { targets: {
  "10.244.7.19:8096": { ok: false, why: "timed out", source: "harness probe at run time", checked_at: "2026-09-06T11:16:40Z" },
  "127.0.0.1:47318": { ok: true, why: "tcp connect ok", source: "harness probe at run time", checked_at: "2026-09-06T11:16:40Z" },
} };

function attempt(callId, host, port, ok, why) {
  return { session_key: SESSION, call_id: callId, message_index: 22, host, port, endpoint: "skill:search", ok, why };
}
const VERDICT_PASS = {
  verdict: "PASS",
  reason: "the final attempt at 127.0.0.1:47318 succeeded (code 0) after 1 earlier failure(s)",
  attempts: [attempt(WRONG_CALL, "10.244.7.19", "8096", false, "timed out"), attempt(RIGHT_CALL, "127.0.0.1", "47318", true, "code 0")],
};

const mainline = () => judgeOutcome({
  usedEvents: [used(WRONG, "eval-bridge-endpoint-a", WRONG_CALL, "10.244.7.19"), used(RIGHT, "eval-bridge-endpoint-b", RIGHT_CALL, "47318")],
  verdictDoc: VERDICT_PASS,
  tokensByAsset: TOKENS,
  reachability: REACH,
});

test("mainline: wrong → corrected(wrong), right → validated, from the same passing run", () => {
  const { events } = mainline();
  const byAsset = Object.fromEntries(events.map((e) => [e.asset_id, e]));
  assert.equal(byAsset[WRONG].state, "corrected");
  assert.equal(byAsset[WRONG].corrected_reason, "wrong");
  assert.equal(byAsset[RIGHT].state, "validated");
  assert.equal(byAsset[RIGHT].corrected_reason, null);
});

test("trap 1: a passing run does NOT validate the asset whose call failed", () => {
  const { events } = mainline();
  const validated = events.filter((e) => e.state === "validated").map((e) => e.asset_id);
  assert.deepEqual(validated, [RIGHT]);
});

test("trap 2: the right asset's call failing on a service fault is needs_review, not corrected", () => {
  const { events } = judgeOutcome({
    usedEvents: [used(RIGHT, "b", RIGHT_CALL, "47318")],
    verdictDoc: { verdict: "FAIL", attempts: [attempt(RIGHT_CALL, "127.0.0.1", "47318", false, "http 503")] },
    tokensByAsset: TOKENS,
  });
  assert.equal(events[0].state, "needs_review");
  assert.match(events[0].proof_refs[0].detail, /service-side fault/);
});

test("reachability failure at an address that is not the asset's value is needs_review", () => {
  const { events } = judgeOutcome({
    usedEvents: [used(WRONG, "a", WRONG_CALL, "10.244.7.19")],
    verdictDoc: { verdict: "FAIL", attempts: [attempt(WRONG_CALL, "192.168.9.9", "8096", false, "timed out")] },
    tokensByAsset: TOKENS, reachability: REACH,
  });
  assert.equal(events[0].state, "needs_review");
  assert.match(events[0].proof_refs[0].detail, /not the asset's value/);
});

test("call succeeded but the run did not pass → needs_review, never validated", () => {
  const { events } = judgeOutcome({
    usedEvents: [used(RIGHT, "b", RIGHT_CALL, "47318")],
    verdictDoc: { verdict: "FAIL", attempts: [attempt(RIGHT_CALL, "127.0.0.1", "47318", true, "code 0"), attempt("call_02_x", "10.0.0.1", "1", false, "timed out")] },
    tokensByAsset: TOKENS,
  });
  assert.equal(events[0].state, "needs_review");
  assert.match(events[0].proof_refs[0].detail, /acceptance read FAIL/);
});

test("used event whose call is not an acceptance attempt → needs_review", () => {
  const { events } = judgeOutcome({
    usedEvents: [used(WRONG, "a", "call_09_echo", "10.244.7.19")],
    verdictDoc: VERDICT_PASS,
    tokensByAsset: TOKENS,
  });
  assert.equal(events[0].state, "needs_review");
  assert.match(events[0].proof_refs[0].detail, /not an acceptance attempt/);
  assert.equal(events[0].metadata.attempt, null);
});

test("unreadable call outcome → needs_review", () => {
  const { events } = judgeOutcome({
    usedEvents: [used(RIGHT, "b", RIGHT_CALL, "47318")],
    verdictDoc: { verdict: "ERROR", attempts: [attempt(RIGHT_CALL, "127.0.0.1", "47318", null, "no result was captured for this call")] },
    tokensByAsset: TOKENS,
  });
  assert.equal(events[0].state, "needs_review");
  assert.match(events[0].proof_refs[0].detail, /could not be read/);
});

test("used_soft produces nothing and is listed as skipped", () => {
  const soft = used(RIGHT, "b", RIGHT_CALL, "47318", { state: "used_soft", evidence_tier: "soft" });
  const { events, skipped } = judgeOutcome({ usedEvents: [soft], verdictDoc: VERDICT_PASS, tokensByAsset: TOKENS });
  assert.equal(events.length, 0);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /used_soft/);
});

test("tokens for another version cannot tie a failure to this version", () => {
  const { events } = judgeOutcome({
    usedEvents: [used(WRONG, "a", WRONG_CALL, "10.244.7.19")],
    verdictDoc: VERDICT_PASS,
    tokensByAsset: { [WRONG]: { version: 3, tokens: ["10.244.7.19"] } }, reachability: REACH,
  });
  assert.equal(events[0].state, "needs_review");
  assert.match(events[0].proof_refs[0].detail, /v3.*v2/);
});

test("every outcome event passes the provenance contract and points at its used event", () => {
  const { events } = mainline();
  for (const e of events) {
    assert.deepEqual(validate(SCHEMA, e), [], JSON.stringify(e).slice(0, 200));
    assert.equal(e.parent_event_ids.length, 1);
    assert.match(e.parent_event_ids[0], /^evt-used-/);
    assert.equal(e.evidence_tier, "hard");
    assert.equal(e.proof_refs[0].kind, "verify_result");
  }
});

test("the same asset fed two calls → two distinct outcome events", () => {
  const { events } = judgeOutcome({
    usedEvents: [used(RIGHT, "b", "call_01_a", "47318"), used(RIGHT, "b", "call_02_b", "47318")],
    verdictDoc: { verdict: "PASS", attempts: [attempt("call_01_a", "127.0.0.1", "47318", true, "code 0"), attempt("call_02_b", "127.0.0.1", "47318", true, "code 0")] },
    tokensByAsset: TOKENS,
  });
  assert.equal(events.length, 2);
  assert.notEqual(events[0].event_id, events[1].event_id);
});

test("helpers: callIdOf and dialledToken", () => {
  assert.equal(callIdOf("request(x):msg[8]:call_00_po2EaBdfFVj3or2ywENy5238:arguments"), "call_00_po2EaBdfFVj3or2ywENy5238");
  assert.equal(callIdOf("diff:…"), null);
  assert.equal(dialledToken({ host: "10.244.7.19", port: "8096" }, ["10.244.7.19"]), "10.244.7.19");
  assert.equal(dialledToken({ host: "127.0.0.1", port: "47318" }, ["47318"]), "47318");
  assert.equal(dialledToken({ host: "127.0.0.1", port: "8096" }, ["47318"]), null);
});

test("outcomeOf with no attempt at all", () => {
  assert.equal(outcomeOf({ used: {}, attempt: null, tokens: [], verdict: "PASS" }).state, "needs_review");
});

test("real run 3 data: wrong corrected, right validated", () => {
  const dir = join(HERE, "..", "runner", "runs", "20260905T220020Z-gate-off");
  let usedEvents, verdictDoc;
  try {
    usedEvents = readFileSync(join(dir, "used-events.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    verdictDoc = JSON.parse(readFileSync(join(dir, "verdict.json"), "utf8"));
  } catch {
    return; // run directory not present in this checkout
  }
  const { events } = judgeOutcome({ usedEvents, verdictDoc, tokensByAsset: TOKENS, reachability: REACH });
  const states = Object.fromEntries(events.map((e) => [e.asset_id, e.state]));
  assert.equal(states[WRONG], "corrected");
  assert.equal(states[RIGHT], "validated");
  assert.match(renderOutcome({ events, skipped: [] }), /corrected\(wrong\)/);
});

// ── following an asset is not proof the asset is wrong ────────────
test("the right address timing out once is needs_review, not corrected: the probe reaches it", () => {
  const { events } = judgeOutcome({
    usedEvents: [used(RIGHT, "b", RIGHT_CALL, "47318")],
    verdictDoc: { verdict: "FAIL", attempts: [attempt(RIGHT_CALL, "127.0.0.1", "47318", false, "timed out")] },
    tokensByAsset: TOKENS, reachability: REACH,
  });
  assert.equal(events[0].state, "needs_review");
  assert.match(events[0].proof_refs[0].detail, /an independent probe reached 127\.0\.0\.1:47318/);
});

test("a failure at an address that succeeded elsewhere in the same run is transient, not the content", () => {
  const { events } = judgeOutcome({
    usedEvents: [used(RIGHT, "b", "call_01_first", "47318")],
    verdictDoc: { verdict: "PASS", attempts: [attempt("call_01_first", "127.0.0.1", "47318", false, "timed out"), { ...attempt("call_02_retry", "127.0.0.1", "47318", true, "code 0"), message_index: 24 }] },
    tokensByAsset: TOKENS, reachability: { targets: { "127.0.0.1:47318": { ok: false, why: "timed out" } } },
  });
  assert.equal(events[0].state, "needs_review");
  assert.match(events[0].proof_refs[0].detail, /succeeded at message 24 in this run; the failure was transient/);
});

test("with no independent probe on record the failure is unconfirmed — never corrected on one call alone", () => {
  const { events } = judgeOutcome({
    usedEvents: [used(WRONG, "a", WRONG_CALL, "10.244.7.19")],
    verdictDoc: VERDICT_PASS, tokensByAsset: TOKENS,
  });
  assert.equal(events[0].state, "needs_review");
  assert.match(events[0].proof_refs[0].detail, /no independent reachability check .* on record/);
});

test("corrected cites the probe that reproduced the failure", () => {
  const { events } = mainline();
  const wrong = events.find((e) => e.asset_id === WRONG);
  assert.equal(wrong.state, "corrected");
  assert.match(wrong.proof_refs[0].detail, /an independent probe also failed to reach it \(timed out, harness probe at run time/);
});

// ---------------------------------------------------------------------------
// 判别值在 attempts[].value 里(追踪头),不在地址里 —— 2026-09-11 准备运行 #1
//
// 批次四的判别值是每条资产各自的 x-team-trace 值,验收把它记在 attempt.value;地址
// 仍是两条资产各自的 host:port,但不再是判别值。dialledToken 只看 host/port,于是拨错
// 地址超时的那次判成 needs_review("地址不是资产的值"),错资产永远拿不到 corrected,
// 证据基础缺一半。
// ---------------------------------------------------------------------------
import { dialledToken as _dt } from "./judge-outcome.mjs";

test("attempt.value 等于资产判别值 → 算这次尝试拨的是该资产的值", () => {
  const a = { host: "10.244.7.19", port: "8096", value: "bt-tracewrong9", ok: false, why: "timed out" };
  assert.equal(_dt(a, ["bt-tracewrong9"]), "bt-tracewrong9");
});

test("value 不等于判别值、地址也不含 → 仍然 null", () => {
  const a = { host: "10.244.7.19", port: "8096", value: "bt-other", ok: false, why: "timed out" };
  assert.equal(_dt(a, ["bt-tracewrong9"]), null);
});

test("value 只按整值比,不按子串:bt-trace 不能命中 bt-tracewrong9", () => {
  const a = { host: "1.2.3.4", port: "9", value: "bt-tracewrong9", ok: false, why: "timed out" };
  assert.equal(_dt(a, ["bt-trace"]), null);
});

// ── one tool call, several requests (attempts-2026-09-11) ─────────
// Batch 4 run 5: one Bash command dialled the right address and then the
// wrong one. Both used events point at the same call id; each asset's outcome
// must be read from the request that carried ITS value, not from whichever
// attempt happened to be stored last under that id.
const ONE_CALL = "call_00_qitA9lGDUjEoxP4ADzJ69247";
const TOKENS_V4 = { [WRONG]: { version: 4, tokens: ["10.244.7.19", "bt-testwrong"] }, [RIGHT]: { version: 4, tokens: ["47318", "bt-testright"] } };
const VERDICT_ONE_CALL = {
  verdict: "FAIL",
  reason: "the final attempt at 10.244.7.19:8096 failed (timed out) despite 1 earlier success(es)",
  attempts: [
    { ...attempt(ONE_CALL, "127.0.0.1", "47318", true, "code 0"), request_index: 0, value: "bt-testright" },
    { ...attempt(ONE_CALL, "10.244.7.19", "8096", false, "timed out"), request_index: 1, value: "bt-testwrong" },
  ],
};

test("several requests in one call: each asset is judged by the request that carried its own value", () => {
  const usedV4 = (id, name, token) => ({ ...used(id, name, ONE_CALL, token), asset_version: 4 });
  const r = judgeOutcome({
    usedEvents: [usedV4(WRONG, "eval-bridge-endpoint-a", "bt-testwrong"), usedV4(RIGHT, "eval-bridge-endpoint-b", "bt-testright")],
    verdictDoc: VERDICT_ONE_CALL, tokensByAsset: TOKENS_V4, reachability: REACH,
  });
  const by = Object.fromEntries(r.events.map((e) => [e.asset_id, e]));
  assert.equal(by[WRONG].state, "corrected", by[WRONG].proof_refs?.[0]?.detail);
  assert.equal(by[WRONG].metadata.attempt.host, "10.244.7.19");
  assert.equal(by[RIGHT].metadata.attempt.host, "127.0.0.1");
  // the run did not pass, so the right asset's successful call is not validated either
  assert.notEqual(by[RIGHT].state, "validated");
});

test("a used event whose call made several requests, none carrying that asset's value, is needs_review, not judged by a stranger's request", () => {
  const twoStrangers = { ...VERDICT_ONE_CALL, attempts: [VERDICT_ONE_CALL.attempts[0], { ...VERDICT_ONE_CALL.attempts[0], request_index: 1 }] };
  const r = judgeOutcome({ usedEvents: [{ ...used(WRONG, "eval-bridge-endpoint-a", ONE_CALL, "bt-testwrong"), asset_version: 4 }], verdictDoc: twoStrangers, tokensByAsset: TOKENS_V4, reachability: REACH });
  assert.equal(r.events[0].state, "needs_review");
  assert.match(r.events[0].proof_refs[0].detail, /no request in that call carries/);
});
