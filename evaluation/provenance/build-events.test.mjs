import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEvents,
  callTargetsAsset,
  classifyRelation,
  extractAssetMentions,
  normalizeSessionKey,
  parseJsonl,
  renderSummary,
  summarize,
} from "./build-events.mjs";

const SNAPSHOT = {
  pool_snapshot_at: "2026-09-04T12:00:00Z",
  assets: [
    {
      asset_id: "skl-alice", asset_type: "skill", name: "deploy-conventions",
      producer_user_id: "usr-alice", producer_agent_id: "agt-alice",
      version: 3, asset_created_at: "2026-09-01T10:00:00Z",
    },
    {
      asset_id: "skl-late", asset_type: "skill", name: "leaked-after-freeze",
      producer_user_id: "usr-alice", producer_agent_id: "agt-alice",
      version: 1, asset_created_at: "2026-09-04T18:00:00Z",
    },
  ],
};

/** A captured request whose tool result carries an asset id. */
function captureWithResult(conversationId, resultText) {
  return {
    event: "http.request",
    headers: { "x-conversation-id": conversationId },
    body: {
      json: {
        messages: [
          { role: "assistant", tool_calls: [{ id: "c1", function: { name: "Bash", arguments: "{}" } }] },
          { role: "tool", tool_call_id: "c1", content: resultText },
        ],
      },
    },
  };
}

function bridgeRow(overrides = {}) {
  return {
    kind: "bridge_call",
    session_key: "codebuddy:conv-1",
    user_id: "usr-bob",
    agent_id: "agt-bob",
    bridge_source: "skill-bridge",
    executed_endpoint: "get-by-name",
    request_body: '{"skill_name":"deploy-conventions","team_id":"t"}',
    upstream_status: 200,
    reject_reason: "",
    timestamp: "2026-09-04T13:00:00Z",
    ...overrides,
  };
}

test("relation is derived by comparing producer and consumer identity", () => {
  const alice = { user_id: "usr-alice", agent_id: "agt-1" };
  assert.equal(classifyRelation(alice, { user_id: "usr-bob", agent_id: "agt-9" }), "cross_user");
  assert.equal(classifyRelation(alice, { user_id: "usr-alice", agent_id: "agt-2" }), "cross_agent");
  assert.equal(classifyRelation(alice, { user_id: "usr-alice", agent_id: "agt-1" }), "self");
});

test("a missing identity yields unknown, never a default of self", () => {
  // Defaulting to self would quietly erase genuine cross-person use.
  assert.equal(classifyRelation({ user_id: "", agent_id: "" }, { user_id: "usr-bob" }), "unknown");
  assert.equal(classifyRelation({ user_id: "usr-alice" }, { user_id: "", agent_id: "" }), "unknown");
});

test("the client prefix on session_key is normalised so both sides join", () => {
  // The proxy writes codebuddy:xxx; the knowledge service writes a bare id.
  assert.equal(normalizeSessionKey("codebuddy:conv-1"), "conv-1");
  assert.equal(normalizeSessionKey("conv-1"), "conv-1");
  assert.equal(normalizeSessionKey(undefined), "");
});

test("asset ids are matched in tool results only, never in requests", () => {
  // A tool result echoes the command verbatim first, so scanning the whole
  // blob would mistake the request for the response.
  const inRequest = {
    event: "http.request",
    headers: { "x-conversation-id": "conv-1" },
    body: { json: { messages: [
      { role: "assistant", tool_calls: [{ id: "c1", function: { name: "Bash", arguments: '{"command":"curl ... skl-alice"}' } }] },
    ] } },
  };
  assert.equal(extractAssetMentions([inRequest], ["skl-alice"]).size, 0);

  const inResult = captureWithResult("conv-1", '{"data":{"items":[{"skill_id":"skl-alice"}]}}');
  assert.deepEqual([...extractAssetMentions([inResult], ["skl-alice"]).keys()], ["skl-alice"]);
});

test("asset identity plus a service-side success is marked bridge+wire", () => {
  const events = buildEvents({
    snapshot: SNAPSHOT,
    toolCallRows: [bridgeRow()],
    captureEvents: [captureWithResult("conv-1", '{"skill_id":"skl-alice"}')],
  });

  const hit = events.find((e) => e.asset_id === "skl-alice");
  assert.equal(hit.observation, "bridge+wire");
  assert.equal(hit.producer_user_id, "usr-alice");
  assert.equal(hit.actor_user_id, "usr-bob");
  assert.equal(hit.relation, "cross_user");
  assert.equal(hit.asset_version, 3);
});

test("a rejected bridge call is not a success and degrades to wire_only", () => {
  const events = buildEvents({
    snapshot: SNAPSHOT,
    toolCallRows: [bridgeRow({ upstream_status: 401, reject_reason: "session_not_initialized" })],
    captureEvents: [captureWithResult("conv-1", '{"skill_id":"skl-alice"}')],
  });

  assert.equal(events.find((e) => e.asset_id === "skl-alice").observation, "wire_only");
});

test("a service-side record the capture missed is kept as bridge_only", () => {
  // A gap in collection and an absence of activity are different things;
  // dropping it would suggest the call never happened.
  const events = buildEvents({
    snapshot: SNAPSHOT,
    toolCallRows: [bridgeRow({ session_key: "codebuddy:conv-unseen" })],
    captureEvents: [],
  });

  const only = events.find((e) => e.session_key === "conv-unseen");
  assert.equal(only.observation, "bridge_only");
  assert.equal(only.asset_id, "");
  assert.equal(only.relation, "unknown");
});

test("assets created after the pool freeze are flagged as answer leaks", () => {
  // The system auto-extracts assets from failed sessions (measured: 45 s after
  // the failure). If such an asset flows back into the candidate pool and happens
  // to match the task, that is an answer leak.
  const events = buildEvents({
    snapshot: SNAPSHOT,
    toolCallRows: [bridgeRow()],
    captureEvents: [captureWithResult("conv-1", '{"skill_id":"skl-late"}')],
  });

  assert.equal(events.find((e) => e.asset_id === "skl-late").excluded_by_snapshot, true);
});

test("unknown events stay out of the cross-person rate denominator", () => {
  const summary = summarize([
    { relation: "cross_user", observation: "bridge+wire", asset_id: "a", excluded_by_snapshot: false },
    { relation: "self", observation: "bridge+wire", asset_id: "b", excluded_by_snapshot: false },
    { relation: "unknown", observation: "bridge_only", asset_id: "", excluded_by_snapshot: false },
  ]);

  assert.equal(summary.total, 3);
  assert.equal(summary.crossUserRate, 0.5); // 1 / 2; unknown is not counted
  assert.equal(summary.distinctAssets, 2);
});

test("nothing attributable reports not-computable rather than 0%", () => {
  // 0% reads as "measured, and there was none"; the truth is "nothing measured".
  const summary = summarize([
    { relation: "unknown", observation: "bridge_only", asset_id: "", excluded_by_snapshot: false },
  ]);

  assert.equal(summary.crossUserRate, null);
  assert.match(renderSummary(summary), /not computable/);
});

test("a cross-person count of zero is reported as a finding, not an omission", () => {
  const summary = summarize([
    { relation: "self", observation: "bridge+wire", asset_id: "a", excluded_by_snapshot: false },
  ]);

  assert.match(renderSummary(summary), /never produced/);
});

test("parseJsonl skips malformed lines instead of failing the whole file", () => {
  assert.deepEqual(parseJsonl('{"a":1}\nnot json\n\n{"b":2}\n'), [{ a: 1 }, { b: 2 }]);
});

test("a search hit is not evidence that an asset was fetched", () => {
  // skill/search returns a list. Appearing in it means the asset was offered,
  // not that its content was pulled into the session.
  const asset = { asset_id: "skl-alice", name: "deploy-conventions" };
  const search = { ok: true, executedEndpoint: "search", requestBody: '{"query":"deploy"}' };
  assert.equal(callTargetsAsset(search, asset), false);
});

test("a call is evidence only when it names the asset", () => {
  const asset = { asset_id: "skl-alice", name: "deploy-conventions" };
  assert.equal(callTargetsAsset(
    { ok: true, executedEndpoint: "get", requestBody: '{"skill_id":"skl-alice"}' }, asset), true);
  assert.equal(callTargetsAsset(
    { ok: true, executedEndpoint: "get-by-name", requestBody: '{"skill_name":"deploy-conventions"}' }, asset), true);
  // A successful call for a different asset must not count for this one.
  assert.equal(callTargetsAsset(
    { ok: true, executedEndpoint: "get", requestBody: '{"skill_id":"skl-other"}' }, asset), false);
});

test("an unrelated success in the same session does not mark an asset fetched", () => {
  // The regression this replaces: any ok call in the session was taken as proof
  // that every asset mentioned in the capture had been retrieved.
  const events = buildEvents({
    snapshot: SNAPSHOT,
    toolCallRows: [bridgeRow({ executed_endpoint: "get", request_body: '{"skill_id":"skl-unrelated"}' })],
    captureEvents: [captureWithResult("conv-1", '{"skill_id":"skl-alice"}')],
  });

  const hit = events.find((e) => e.asset_id === "skl-alice");
  assert.equal(hit.observation, "wire_only");
  assert.match(hit.proof_refs[0].detail, /no service-side call targets it/);
});
