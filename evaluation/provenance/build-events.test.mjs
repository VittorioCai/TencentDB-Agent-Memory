import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEvents,
  callTargetsAsset,
  classifyRelation,
  commandEndpoint,
  extractAssetMentions,
  inspectDelivery,
  isListingAction,
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

/**
 * A tool result shaped the way a real Bash curl call comes back: the command
 * echoed first, then the output. The two halves have to be separable, because
 * whether the call *asked for* this asset is decided by the command and whether
 * it *came back* is decided by the output.
 */
function curlResult(conversationId, { url, body = "{}", stdout }) {
  return captureWithResult(
    conversationId,
    `Command: curl -sSk -X POST ${url} -d '${body}'\nStdout: ${stdout}`,
  );
}

const SEARCH_URL = "http://127.0.0.1:8096/skill-bridge/v3/skill/search";
const GET_URL = "http://127.0.0.1:8096/skill-bridge/v3/skill/get-by-name";
const GET_URL2 = "http://127.0.0.1:8096/skill-bridge/v3/skill/get";

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
  assert.equal(extractAssetMentions([inRequest], SNAPSHOT.assets).size, 0);

  const inResult = captureWithResult("conv-1", '{"data":{"items":[{"skill_id":"skl-alice"}]}}');
  assert.deepEqual([...extractAssetMentions([inResult], SNAPSHOT.assets).keys()], ["skl-alice"]);
});

test("producer and consumer are joined onto one event", () => {
  // The edge the existing telemetry never had: tool_call_logs records only the
  // consumer, the owner lives in the asset record, and nothing joined them.
  //
  // The result here carries no command envelope, so nothing shows this response
  // answered a call for this asset — it could as easily be a search listing. So
  // the wire half witnesses no retrieval and the observation is bridge_only,
  // even though the asset id is in the capture.
  const events = buildEvents({
    snapshot: SNAPSHOT,
    toolCallRows: [bridgeRow()],
    captureEvents: [captureWithResult("conv-1", '{"skill_id":"skl-alice"}')],
  });

  const hit = events.find((e) => e.asset_id === "skl-alice");
  assert.equal(hit.observation, "bridge_only");
  assert.equal(hit.content_delivered, null, "an uninspectable result establishes nothing");
  assert.equal(hit.producer_user_id, "usr-alice");
  assert.equal(hit.actor_user_id, "usr-bob");
  assert.equal(hit.relation, "cross_user");
  // The response stated no version, so the event claims none. The snapshot
  // holds v3, and it is not entitled to say which revision came back.
  assert.equal(hit.asset_version, null);
});

test("the version is read from the response, not from the pool", () => {
  const events = buildEvents({
    snapshot: SNAPSHOT, // holds v3
    toolCallRows: [bridgeRow()],
    captureEvents: [curlResult("conv-1", {
      url: GET_URL,
      body: '{"skill_name":"deploy-conventions","include_content":true}',
      stdout: '{"code":0,"data":{"skill_id":"skl-alice","version":2,"content":"# Deploy\\nuse 10.244.7.19"}}',
    })],
  });

  const hit = events.find((e) => e.asset_id === "skl-alice");
  assert.equal(hit.asset_version, 2, "the response said v2; the pool holding v3 is irrelevant");
  assert.equal(hit.content_delivered, true);
});

test("a metadata-only response is not a delivery of content", () => {
  // `get` with include_content:false answers with id, name and version. It
  // names the asset, it is not an enumeration endpoint, and it hands back no
  // content at all — so an endpoint allow-list passes it.
  const events = buildEvents({
    snapshot: SNAPSHOT,
    toolCallRows: [bridgeRow({ executed_endpoint: "get", request_body: '{"skill_id":"skl-alice","include_content":false}' })],
    captureEvents: [curlResult("conv-1", {
      url: "http://127.0.0.1:8096/skill-bridge/v3/skill/get",
      body: '{"skill_id":"skl-alice","include_content":false,"include_manifest":false}',
      stdout: '{"code":0,"data":{"skill_id":"skl-alice","name":"deploy-conventions","version":3}}',
    })],
  });

  const hit = events.find((e) => e.asset_id === "skl-alice");
  assert.equal(hit.state, "fetched", "the call did happen and is still recorded");
  assert.equal(hit.content_delivered, false, "but nothing was delivered");
  assert.equal(hit.context_entry_index, null, "so nothing entered the context");
});

test("an empty content field is a delivery of nothing", () => {
  const events = buildEvents({
    snapshot: SNAPSHOT,
    toolCallRows: [bridgeRow()],
    captureEvents: [curlResult("conv-1", {
      url: GET_URL,
      body: '{"skill_name":"deploy-conventions"}',
      stdout: '{"code":0,"data":{"skill_id":"skl-alice","version":3,"content":"   "}}',
    })],
  });
  assert.equal(events.find((e) => e.asset_id === "skl-alice").content_delivered, false);
});

test("an uncaptured response leaves delivery unknown, not false", () => {
  // Unknown and absent are different, and a later stage may promote on neither.
  const events = buildEvents({
    snapshot: SNAPSHOT,
    toolCallRows: [bridgeRow({ session_key: "codebuddy:conv-unseen" })],
    captureEvents: [],
  });
  const only = events.find((e) => e.session_key === "conv-unseen");
  assert.equal(only.content_delivered, null);
  assert.equal(only.asset_version, null);
});

test("the context entry index is the message carrying the response", () => {
  // Not the call that asked for it. That distinction is what stops a second
  // tool call written in the same message from counting as informed by the
  // first one's result.
  const events = buildEvents({
    snapshot: SNAPSHOT,
    toolCallRows: [bridgeRow()],
    captureEvents: [curlResult("conv-1", {
      url: GET_URL,
      body: '{"skill_name":"deploy-conventions"}',
      stdout: '{"code":0,"data":{"skill_id":"skl-alice","version":3,"content":"use 10.244.7.19"}}',
    })],
  });
  // captureWithResult puts the assistant call at index 0 and the result at 1.
  assert.equal(events.find((e) => e.asset_id === "skl-alice").context_entry_index, 1);
});

test("a rejected bridge call is not a success", () => {
  // The command asked for this asset and the output carried it, so the wire
  // shows a retrieval. The service says the call was refused. That is a real
  // disagreement between the two tiers and it is recorded as such rather than
  // resolved in either direction.
  const events = buildEvents({
    snapshot: SNAPSHOT,
    toolCallRows: [bridgeRow({ upstream_status: 401, reject_reason: "session_not_initialized" })],
    captureEvents: [curlResult("conv-1", {
      url: GET_URL,
      body: '{"skill_name":"deploy-conventions"}',
      stdout: '{"code":0,"data":{"skill_id":"skl-alice"}}',
    })],
  });

  const hit = events.find((e) => e.asset_id === "skl-alice");
  assert.equal(hit.observation, "wire_only");
  assert.match(hit.proof_refs[0].detail, /telemetry gap/);
});

test("a refused call and a bare mention together are still not a fetch", () => {
  const events = buildEvents({
    snapshot: SNAPSHOT,
    toolCallRows: [bridgeRow({ upstream_status: 401, reject_reason: "session_not_initialized" })],
    captureEvents: [captureWithResult("conv-1", '{"skill_id":"skl-alice"}')],
  });

  assert.equal(events.find((e) => e.asset_id === "skl-alice"), undefined);
  assert.equal(events.offeredNotRetrieved.length, 1);
});

test("a service-side record the capture missed is kept, and named when the row names it", () => {
  // A gap in collection and an absence of activity are different things;
  // dropping it would suggest the call never happened. And when the row itself
  // names the asset, the event can say which one — the capture is only needed
  // to see the response, not to identify the request.
  const events = buildEvents({
    snapshot: SNAPSHOT,
    toolCallRows: [bridgeRow({ session_key: "codebuddy:conv-unseen" })],
    captureEvents: [],
  });

  const only = events.find((e) => e.session_key === "conv-unseen");
  assert.equal(only.observation, "bridge_only");
  assert.equal(only.asset_id, "skl-alice");
  assert.equal(only.relation, "cross_user");
});

test("a listing call the capture missed names no asset", () => {
  // skill/search does not identify an asset in its request, so the row alone
  // cannot say which asset — reporting one would be a guess.
  const events = buildEvents({
    snapshot: SNAPSHOT,
    toolCallRows: [bridgeRow({
      session_key: "codebuddy:conv-unseen",
      executed_endpoint: "search",
      request_body: '{"query":"deploy"}',
    })],
    captureEvents: [],
  });

  const only = events.find((e) => e.session_key === "conv-unseen");
  assert.equal(only.asset_id, "");
  assert.equal(only.relation, "unknown");
});

test("assets created after the pool freeze are flagged as answer leaks", () => {
  // The system auto-extracts assets from failed sessions (measured: 45 s after
  // the failure). If such an asset flows back into the candidate pool and happens
  // to match the task, that is an answer leak.
  const events = buildEvents({
    snapshot: SNAPSHOT,
    toolCallRows: [bridgeRow({ request_body: '{"skill_id":"skl-late"}', executed_endpoint: "get" })],
    captureEvents: [curlResult("conv-1", {
      url: GET_URL,
      body: '{"skill_id":"skl-late"}',
      stdout: '{"code":0,"data":{"skill_id":"skl-late"}}',
    })],
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

  assert.equal(events.find((e) => e.asset_id === "skl-alice"), undefined);
});

test("appearing in a search response is never written as fetched", () => {
  // The second half of the same defect. The earlier fix stopped an unrelated
  // bridge row from standing in as evidence, but the event was still written —
  // as `fetched` with observation wire_only, on nothing but the asset id being
  // present. A later stage that keys off the state name would read that as a
  // retrieval and promote it.
  const events = buildEvents({
    snapshot: SNAPSHOT,
    toolCallRows: [],
    captureEvents: [curlResult("conv-1", {
      url: SEARCH_URL,
      body: '{"query":"deploy"}',
      stdout: '{"code":0,"data":{"items":[{"skill_id":"skl-alice"},{"skill_id":"skl-late"}]}}',
    })],
  });

  assert.deepEqual(events.filter((e) => e.state === "fetched"), []);
  assert.deepEqual(
    events.offeredNotRetrieved.map((o) => o.asset_id).sort(),
    ["skl-alice", "skl-late"],
  );
  assert.match(renderSummary(summarize(events)), /Offered, not fetched/);
});

test("a targeted call the service never logged is a fetch with the gap recorded", () => {
  // The wire shows the model asked for this asset by name and got it back. No
  // bridge row exists. That is a hole in the tap, not a stronger result, and
  // the event says so rather than presenting itself as ordinary evidence.
  const events = buildEvents({
    snapshot: SNAPSHOT,
    toolCallRows: [],
    captureEvents: [curlResult("conv-1", {
      url: GET_URL,
      body: '{"skill_name":"deploy-conventions"}',
      stdout: '{"code":0,"data":{"skill_id":"skl-alice","version":3}}',
    })],
  });

  const hit = events.find((e) => e.asset_id === "skl-alice");
  assert.equal(hit.state, "fetched");
  assert.equal(hit.observation, "wire_only");
  assert.match(hit.proof_refs[0].detail, /no service-side row recorded it/);
});

test("the knowledge service's endpoint form is recognised too", () => {
  // It runs on its own port and takes the operation in the body rather than in
  // the path. A path-only pattern does not see it, and an unrecognised command
  // means the response is never inspected — which reads as "delivery unknown"
  // for a channel where delivery is perfectly knowable.
  assert.equal(commandEndpoint('curl http://127.0.0.1:8424/v3/tools/call -d \'{"knowledge_id":"wiki-x","tool_name":"get_info"}\''), "knowledge:get_info");
  assert.equal(commandEndpoint("curl http://127.0.0.1:8424/v3/tools/list"), "knowledge:list");
  assert.equal(isListingAction("knowledge:list"), true);
  assert.equal(isListingAction("knowledge:get_info"), false);
  // get_info answers with metadata, so it is not a listing and still delivers
  // nothing — which only inspecting the response can tell you.
  assert.equal(
    inspectDelivery('{"code":0,"data":{"wiki_id":"wiki-x","name":"kb","status":"draft"}}', "wiki-x").delivered,
    false,
  );
});

// ── one response, one event ───────────────────────────────────────

test("two reads of one asset produce two events, each self-consistent", () => {
  // The reported defect. Aggregating per asset per session took the first
  // version it saw, any delivery, the earliest delivered position and the first
  // call id — from different responses. A metadata-only read of v1 followed by
  // a content read of v2 produced a single record saying "v1, content
  // delivered, at the second response's position, evidenced by the first
  // call" — a retrieval that never happened, and one the contract accepts,
  // because a contract constrains fields and not their provenance.
  const events = buildEvents({
    snapshot: SNAPSHOT,
    toolCallRows: [
      bridgeRow({ executed_endpoint: "get", request_body: '{"skill_id":"skl-alice","include_content":false}', timestamp: "2026-09-04T13:00:00Z" }),
      bridgeRow({ executed_endpoint: "get", request_body: '{"skill_id":"skl-alice","include_content":true}', timestamp: "2026-09-04T13:05:00Z" }),
    ],
    captureEvents: [{
      event: "http.request",
      headers: { "x-conversation-id": "conv-1" },
      timestamp: "2026-09-04T13:06:00Z",
      body: { json: { messages: [
        { role: "assistant", tool_calls: [{ id: "c1", function: { name: "Bash", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "c1", content:
          "Command: curl -X POST " + GET_URL2 + " -d '{\"skill_id\":\"skl-alice\",\"include_content\":false}'\n"
          + 'Stdout: {"code":0,"data":{"skill_id":"skl-alice","version":1,"name":"deploy-conventions"}}' },
        { role: "assistant", tool_calls: [{ id: "c2", function: { name: "Bash", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "c2", content:
          "Command: curl -X POST " + GET_URL2 + " -d '{\"skill_id\":\"skl-alice\",\"include_content\":true}'\n"
          + 'Stdout: {"code":0,"data":{"skill_id":"skl-alice","version":2,"content":"# Deploy\\nuse 10.244.7.19"}}' },
      ] } },
    }],
  });

  const fetched = events.filter((e) => e.asset_id === "skl-alice");
  assert.equal(fetched.length, 2, "two reads, two events");

  const v1 = fetched.find((e) => e.asset_version === 1);
  assert.equal(v1.content_delivered, false, "v1 was metadata only");
  assert.equal(v1.context_entry_index, null, "so v1 never entered the context");

  const v2 = fetched.find((e) => e.asset_version === 2);
  assert.equal(v2.content_delivered, true);
  assert.equal(v2.context_entry_index, 3);

  // Each event's service row is the one for its own request.
  assert.match(v1.proof_refs[0].ref, /13:00:00/);
  assert.match(v2.proof_refs[0].ref, /13:05:00/);
});

test("a row is paired with its own request, not by arrival order", () => {
  // Order only holds when nothing was dropped, and a dropped row is exactly the
  // case where the pairing matters.
  const events = buildEvents({
    snapshot: SNAPSHOT,
    toolCallRows: [
      bridgeRow({ executed_endpoint: "get", request_body: '{"skill_id":"skl-alice","include_content":true}', timestamp: "2026-09-04T13:09:00Z" }),
    ],
    captureEvents: [curlResult("conv-1", {
      url: GET_URL2,
      body: '{"skill_id":"skl-alice","include_content":true}',
      stdout: '{"code":0,"data":{"skill_id":"skl-alice","version":2,"content":"body"}}',
    })],
  });
  const hit = events.find((e) => e.asset_id === "skl-alice");
  assert.equal(hit.observation, "bridge+wire");
  assert.match(hit.proof_refs[0].ref, /13:09:00/);
});
