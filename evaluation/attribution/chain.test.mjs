/**
 * End-to-end regression: raw capture → buildEvents → collectArtifacts → judge.
 *
 * The unit tests either side of this feed the judge events built by hand, so
 * they check the judge's rules but never the events it will actually receive.
 * The defect that motivated this file lived exactly in that gap: buildEvents
 * assembled a record from three different responses, every field of it passed
 * every check, and the judge — correctly, given its input — promoted a
 * retrieval that never happened.
 *
 * So these cases start from captured bytes and assert on the final judgement.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildEvents } from "../provenance/build-events.mjs";
import { collectArtifacts } from "./collect-artifacts.mjs";
import { judge } from "./judge-hard.mjs";

const SNAPSHOT = {
  pool_snapshot_at: "2026-09-01T00:00:00Z",
  team_id: "team-eval",
  assets: [{
    asset_id: "skl-wrong", asset_type: "skill", name: "eval-bridge-endpoint-a",
    producer_user_id: "usr-author", producer_agent_id: "agt-author",
    version: 9, asset_created_at: "2026-08-20T00:00:00Z",
  }],
};

const GET = "http://127.0.0.1:8096/skill-bridge/v3/skill/get";
const TOKENS_V1 = { "skl-wrong": { version: 1, tokens: ["10.244.7.19"] } };

const row = (over) => ({
  kind: "bridge_call", session_key: "codebuddy:conv-1",
  user_id: "usr-consumer", agent_id: "agt-consumer",
  bridge_source: "skill-bridge", executed_endpoint: "get",
  upstream_status: 200, reject_reason: "", ...over,
});

const call = (id) => ({ role: "assistant", tool_calls: [{ id, function: { name: "Bash", arguments: "{}" } }] });
const result = (id, body, stdout) => ({
  role: "tool", tool_call_id: id,
  content: `Command: curl -X POST ${GET} -d '${body}'\nStdout: ${stdout}`,
});
const useToken = (id) => ({
  role: "assistant",
  tool_calls: [{ id, function: { name: "Bash", arguments: '{"command":"curl http://10.244.7.19:8096/health"}' } }],
});

function capture(messages) {
  return [{
    event: "http.request",
    requestId: "req-1",
    timestamp: "2026-09-04T13:30:00Z",
    headers: { "x-conversation-id": "conv-1" },
    body: { json: { messages } },
  }];
}

function runChain(messages, toolCallRows, tokensByAsset = TOKENS_V1) {
  const captureEvents = capture(messages);
  const built = buildEvents({ snapshot: SNAPSHOT, toolCallRows, captureEvents });
  const sessions = collectArtifacts({ captureEvents });
  // `built` is what the provenance stage produced; `events` is the judgement.
  // Keeping the names apart matters here: spreading judge()'s result over a key
  // of the same name silently replaced one with the other.
  return { built, ...judge({ events: built, sessions, tokensByAsset }) };
}

test("a metadata-only read of v1 cannot lend its version to a content read of v2", () => {
  // The reported reproduction, end to end. Read v1 with the body switched off,
  // read v2 with the body on, then use a token that exists only in v1. The
  // answer must be needs_review: v1's content never arrived.
  const judged = runChain(
    [
      call("c1"),
      result("c1", '{"skill_id":"skl-wrong","include_content":false}',
        '{"code":0,"data":{"skill_id":"skl-wrong","version":1,"name":"eval-bridge-endpoint-a"}}'),
      call("c2"),
      result("c2", '{"skill_id":"skl-wrong","include_content":true}',
        '{"code":0,"data":{"skill_id":"skl-wrong","version":2,"content":"bridge at 10.9.9.9"}}'),
      useToken("c3"),
    ],
    [
      row({ request_body: '{"skill_id":"skl-wrong","include_content":false}', timestamp: "2026-09-04T13:00:00Z" }),
      row({ request_body: '{"skill_id":"skl-wrong","include_content":true}', timestamp: "2026-09-04T13:05:00Z" }),
    ],
  );

  assert.equal(judged.built.filter((e) => e.state === "fetched").length, 2, "two reads, two events");

  const verdicts = judged.events.map((e) => e.state);
  assert.deepEqual(verdicts, ["needs_review"]);
  assert.equal(judged.events[0].asset_version, null, "no revision may be claimed");
  assert.match(judged.events[0].proof_refs[0].detail, /what did arrive was v2/);
});

test("a content read of the token's own revision does reach used", () => {
  // The control. Without it the rule above would be indistinguishable from
  // "never promote", and a check that can only fail proves nothing.
  const judged = runChain(
    [
      call("c1"),
      result("c1", '{"skill_id":"skl-wrong","include_content":true}',
        '{"code":0,"data":{"skill_id":"skl-wrong","version":1,"content":"bridge at 10.244.7.19"}}'),
      useToken("c2"),
    ],
    [row({ request_body: '{"skill_id":"skl-wrong","include_content":true}', timestamp: "2026-09-04T13:00:00Z" })],
  );

  assert.deepEqual(judged.events.map((e) => e.state), ["used"]);
  assert.equal(judged.events[0].asset_version, 1);
  assert.equal(judged.events[0].evidence_tier, "hard");
  assert.equal(judged.events[0].relation, "cross_user");
});

test("the pool's version never reaches the judgement", () => {
  // The snapshot holds v9 throughout. If any stage falls back to it, the
  // version match against the v1 token list breaks and this goes to
  // needs_review — so this asserts the whole chain reads from the response.
  const judged = runChain(
    [
      call("c1"),
      result("c1", '{"skill_id":"skl-wrong","include_content":true}',
        '{"code":0,"data":{"skill_id":"skl-wrong","version":1,"content":"bridge at 10.244.7.19"}}'),
      useToken("c2"),
    ],
    [row({ request_body: '{"skill_id":"skl-wrong","include_content":true}', timestamp: "2026-09-04T13:00:00Z" })],
  );
  assert.equal(judged.events[0].asset_version, 1, "not 9");
});

test("using the token in the same message as the read is not use", () => {
  // Both calls sit in one assistant message, so the second was written before
  // the first one's result existed.
  const judged = runChain(
    [
      {
        role: "assistant",
        tool_calls: [
          { id: "c1", function: { name: "Bash", arguments: "{}" } },
          { id: "c2", function: { name: "Bash", arguments: '{"command":"curl http://10.244.7.19:8096/health"}' } },
        ],
      },
      result("c1", '{"skill_id":"skl-wrong","include_content":true}',
        '{"code":0,"data":{"skill_id":"skl-wrong","version":1,"content":"bridge at 10.244.7.19"}}'),
    ],
    [row({ request_body: '{"skill_id":"skl-wrong","include_content":true}', timestamp: "2026-09-04T13:00:00Z" })],
  );

  assert.deepEqual(judged.events.map((e) => e.state), ["needs_review"]);
});

test("a search listing carries the id all the way through without becoming used", () => {
  const judged = runChain(
    [
      call("c1"),
      {
        role: "tool", tool_call_id: "c1",
        content: "Command: curl -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/search -d '{\"query\":\"bridge\"}'\n"
          + 'Stdout: {"code":0,"data":{"items":[{"skill_id":"skl-wrong","version":1}]}}',
      },
      useToken("c2"),
    ],
    [],
  );

  assert.equal(judged.events.length, 1);
  assert.equal(judged.events[0].state, "needs_review");
  assert.deepEqual(judged.events.filter((e) => e.state === "used"), []);
});
