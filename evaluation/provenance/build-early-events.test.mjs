/**
 * Tests for the early lifecycle collector.
 *
 * The point of every case here is one distinction that is easy to lose:
 * candidate vs selected vs in-context, request vs response, a real injected
 * block vs prose that mentions one. Each of those, collapsed, turns "not
 * observed" into a confident wrong answer.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  extractBlocks,
  parseAvailableSkills,
  splitCommandAndOutput,
  listingEndpoint,
  extractBridgeListings,
  buildEarlyEvents,
  summarizeEarly,
} from "./build-early-events.mjs";
import { parseJsonl } from "./build-events.mjs";

// ── fixtures ──────────────────────────────────────────────────────

const SNAPSHOT = {
  pool_snapshot_at: "2026-09-01T00:00:00Z",
  team_id: "team-eval",
  assets: [
    {
      asset_id: "skl-AAA", asset_type: "skill", name: "bridge-addr-right",
      producer_user_id: "usr-author", producer_agent_id: "agt-author",
      version: 3, asset_created_at: "2026-08-20T00:00:00Z",
    },
    {
      asset_id: "skl-BBB", asset_type: "skill", name: "bridge-addr-wrong",
      producer_user_id: "usr-author", producer_agent_id: "agt-author",
      version: 1, asset_created_at: "2026-08-20T00:00:00Z",
    },
  ],
};

const CONSUMER_ROWS = [{
  kind: "bridge_call", session_key: "codebuddy:sess-1",
  user_id: "usr-consumer", agent_id: "agt-consumer", upstream_status: 200,
}];

/** A captured request carrying a system prompt and any number of tool results. */
function capturedRequest({ system = "", toolResults = [], requestId = "req-1", ts = "2026-09-02T10:00:00Z" }) {
  return {
    event: "http.request",
    requestId,
    timestamp: ts,
    headers: { "x-conversation-id": "sess-1" },
    body: { json: { messages: [
      { role: "system", content: system },
      { role: "user", content: "do the task" },
      ...toolResults.map((t) => ({ role: "tool", content: t })),
    ] } },
  };
}

function searchResult(items) {
  return "Command: curl -sSk -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/search"
    + " -d '{\"query\": \"bridge address\"}'\n"
    + "Stdout: " + JSON.stringify({ code: 0, message: "ok", data: { items } });
}

const REAL_ITEMS = [
  { skill_id: "skl-AAA", name: "bridge-addr-right", version: 3, owner_user_id: "usr-author", owner_agent_id: "agt-author" },
  { skill_id: "skl-BBB", name: "bridge-addr-wrong", version: 1, owner_user_id: "usr-author", owner_agent_id: "agt-author" },
];

const states = (events) => events.map((e) => e.state).sort();

// ── block extraction: the mention trap ────────────────────────────

test("a prose mention of a block tag is not mistaken for the block", () => {
  // Shape taken from a real captured system prompt, where the literal string
  // <available_skills> appears twice inside <skill_tools> prose before the
  // block itself. A non-anchored regex starts at the first mention and returns
  // a paragraph of English instructions as the "skill list".
  const prompt = [
    "<skill_tools>",
    "skill_name is the name from <available_skills>, or from skill_search results.",
    "</skill_tools>",
    "",
    "<available_skills>",
    "- bridge-addr-right: the working address",
    "</available_skills>",
  ].join("\n");

  const blocks = extractBlocks(prompt, "available_skills");
  assert.equal(blocks.length, 1);
  assert.deepEqual(parseAvailableSkills(blocks[0]), ["bridge-addr-right"]);
});

test("a listing block yields names only — ids come from the snapshot", () => {
  const names = parseAvailableSkills([
    "- bridge-addr-right: the working address",
    "- bridge-addr-wrong: the container address",
    "Only proceed without loading a skill if genuinely none are relevant.",
  ].join("\n"));
  assert.deepEqual(names, ["bridge-addr-right", "bridge-addr-wrong"]);
});

// ── request vs response ───────────────────────────────────────────

test("a command echo is not read as a response", () => {
  // The exact failure that made the first verifier report three channels as
  // used: a call that timed out with empty stdout still carries the bridge URL
  // and the query in its echoed command.
  const timedOut = "Command: curl -sSk -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/search"
    + " -d '{\"query\": \"bridge-addr-right skl-AAA\"}'\n"
    + "Exit code: 28\nStdout: \nStderr: curl: (28) Operation timed out after 75000 ms";

  const { command, output } = splitCommandAndOutput(timedOut);
  assert.match(command, /skill\/search/);
  assert.doesNotMatch(output, /skill\/search/);

  const result = buildEarlyEvents({
    snapshot: SNAPSHOT, toolCallRows: CONSUMER_ROWS,
    captureEvents: [capturedRequest({ toolResults: [timedOut] })],
  });
  assert.deepEqual(result.events, [], "a timed-out search recalled nothing");
});

test("fetching one asset by name is not a candidate listing", () => {
  const byName = "Command: curl -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/get-by-name"
    + " -d '{\"skill_name\": \"bridge-addr-right\"}'\n"
    + "Stdout: " + JSON.stringify({ code: 0, data: { skill_id: "skl-AAA", name: "bridge-addr-right" } });
  assert.equal(listingEndpoint(byName), "");
  const result = buildEarlyEvents({
    snapshot: SNAPSHOT, toolCallRows: CONSUMER_ROWS,
    captureEvents: [capturedRequest({ toolResults: [byName] })],
  });
  assert.deepEqual(result.events, [], "a targeted fetch is not a recall");
});

// ── the bridge path, which is the cross-person path ───────────────

test("a team search recalls and injects, but never selects", () => {
  // The consumer identity owns nothing, so its <available_skills> block is
  // empty and every team asset arrives as a tool result. There is no narrowing
  // step on this path: the service returns a list and the model's next move is
  // a fetch. Writing `selected` here would invent a stage.
  const { events } = buildEarlyEvents({
    snapshot: SNAPSHOT, toolCallRows: CONSUMER_ROWS,
    captureEvents: [capturedRequest({ system: "<available_skills>\n(none)\n</available_skills>", toolResults: [searchResult(REAL_ITEMS)] })],
  });

  assert.deepEqual(states(events), ["injected", "injected", "recalled", "recalled"]);
  assert.equal(events.filter((e) => e.state === "selected").length, 0);
  for (const e of events) assert.equal(e.relation, "cross_user");
});

test("recalled and injected are proved by different references", () => {
  const { events } = buildEarlyEvents({
    snapshot: SNAPSHOT, toolCallRows: CONSUMER_ROWS,
    captureEvents: [capturedRequest({ toolResults: [searchResult([REAL_ITEMS[0]])] })],
  });
  const recalled = events.find((e) => e.state === "recalled");
  const injected = events.find((e) => e.state === "injected");

  assert.equal(recalled.proof_refs[0].kind, "bridge_response");
  assert.equal(injected.proof_refs[0].kind, "session_message");
  assert.notEqual(recalled.proof_refs[0].ref, injected.proof_refs[0].ref);
  assert.deepEqual(injected.parent_event_ids, [recalled.event_id]);
});

test("the version the service reported is kept, not the snapshot's", () => {
  // The pool rolls forward. An event that silently used the snapshot version
  // would attribute a run to a revision the model never saw.
  const { events } = buildEarlyEvents({
    snapshot: SNAPSHOT, toolCallRows: CONSUMER_ROWS,
    captureEvents: [capturedRequest({
      toolResults: [searchResult([{ ...REAL_ITEMS[0], version: 2 }])],
    })],
  });
  assert.equal(events[0].asset_version, 2);
});

// ── the injector path, and what it cannot show alone ──────────────

test("an injected block alone proves injection and nothing earlier", () => {
  const { events } = buildEarlyEvents({
    snapshot: SNAPSHOT, toolCallRows: CONSUMER_ROWS,
    captureEvents: [capturedRequest({
      system: "<available_skills>\n- bridge-addr-right: the working address\n</available_skills>",
    })],
  });
  assert.deepEqual(states(events), ["injected"]);
  assert.equal(events[0].proof_refs[0].kind, "injected_block");
  assert.deepEqual(events[0].parent_event_ids, [], "no parent, because no earlier stage was observed");
});

test("a hit count is not a candidate set", () => {
  // skill-injector.ts logs `hits=<count>`. A count cannot be traced to an
  // asset, so an entry carrying only a count must produce nothing.
  const { events } = buildEarlyEvents({
    snapshot: SNAPSHOT, toolCallRows: CONSUMER_ROWS,
    candidateLog: [{ session_key: "sess-1", timestamp: "2026-09-02T09:00:00Z", mode: "full", hit_count: 2 }],
  });
  assert.deepEqual(events, []);
});

test("selected is what survived the narrowing, not a copy of the candidates", () => {
  // Session-init <available_skills> caps at 20 entries, so hits can exceed
  // what is rendered. The dropped candidate is recalled and not selected.
  const { events } = buildEarlyEvents({
    snapshot: SNAPSHOT, toolCallRows: CONSUMER_ROWS,
    candidateLog: [{
      session_key: "sess-1", timestamp: "2026-09-02T09:00:00Z", mode: "full",
      hits: [
        { skill_id: "skl-AAA", name: "bridge-addr-right", version: 3 },
        { skill_id: "skl-BBB", name: "bridge-addr-wrong", version: 1 },
      ],
      listing: "<available_skills>\n- bridge-addr-right: the working address\n</available_skills>",
    }],
  });

  const byAsset = (id) => events.filter((e) => e.asset_id === id).map((e) => e.state).sort();
  assert.deepEqual(byAsset("skl-AAA"), ["recalled", "selected"]);
  assert.deepEqual(byAsset("skl-BBB"), ["recalled"], "dropped by the cap: candidate, never selected");
});

test("candidates with no rendered listing yield no selected", () => {
  const { events } = buildEarlyEvents({
    snapshot: SNAPSHOT, toolCallRows: CONSUMER_ROWS,
    candidateLog: [{
      session_key: "sess-1", timestamp: "2026-09-02T09:00:00Z", mode: "full",
      hits: [{ skill_id: "skl-AAA", name: "bridge-addr-right", version: 3 }],
    }],
  });
  assert.deepEqual(states(events), ["recalled"], "the narrowing step is unobservable without its output");
});

// ── merging and honesty ───────────────────────────────────────────

test("the same asset in context across turns is one event, not one per turn", () => {
  const turns = [1, 2, 3].map((n) => capturedRequest({
    requestId: `req-${n}`,
    ts: `2026-09-02T10:0${n}:00Z`,
    system: "<available_skills>\n- bridge-addr-right: the working address\n</available_skills>",
  }));
  const { events } = buildEarlyEvents({ snapshot: SNAPSHOT, toolCallRows: CONSUMER_ROWS, captureEvents: turns });

  assert.equal(events.length, 1);
  assert.equal(events[0].occurred_at, "2026-09-02T10:01:00Z", "the earliest turn is when it entered context");
  assert.match(events[0].proof_refs[0].detail, /present in 3 captured turn\(s\)/);
});

test("two injection channels merge into one event with both proofs", () => {
  const { events } = buildEarlyEvents({
    snapshot: SNAPSHOT, toolCallRows: CONSUMER_ROWS,
    captureEvents: [capturedRequest({
      system: "<available_skills>\n- bridge-addr-right: the working address\n</available_skills>",
      toolResults: [searchResult([REAL_ITEMS[0]])],
    })],
  });
  const injected = events.filter((e) => e.state === "injected");
  assert.equal(injected.length, 1, "injected once, by two channels");
  assert.deepEqual(
    injected[0].proof_refs.map((p) => p.kind).sort(),
    ["injected_block", "session_message"],
  );
});

test("a service-side candidate plus a captured listing is bridge+wire", () => {
  const { events } = buildEarlyEvents({
    snapshot: SNAPSHOT, toolCallRows: CONSUMER_ROWS,
    candidateLog: [{
      session_key: "sess-1", timestamp: "2026-09-02T09:00:00Z", mode: "full",
      hits: [{ skill_id: "skl-AAA", name: "bridge-addr-right", version: 3 }],
    }],
    captureEvents: [capturedRequest({ toolResults: [searchResult([REAL_ITEMS[0]])] })],
  });
  assert.equal(events.find((e) => e.state === "recalled").observation, "bridge+wire");
});

test("an asset the frozen snapshot does not know is reported, not invented", () => {
  const result = buildEarlyEvents({
    snapshot: SNAPSHOT, toolCallRows: CONSUMER_ROWS,
    captureEvents: [capturedRequest({
      system: "<available_skills>\n- some-skill-added-later: written after the freeze\n</available_skills>",
      toolResults: [searchResult([{ skill_id: "skl-ZZZ", name: "some-skill-added-later", version: 1 }])],
    })],
  });
  assert.deepEqual(result.events, []);
  assert.equal(result.unresolved["listing:skl-ZZZ"], 1);
  assert.equal(result.unresolved["available_skills:some-skill-added-later"], 1);
});

test("an owner disagreement between the response and the freeze is surfaced", () => {
  const result = buildEarlyEvents({
    snapshot: SNAPSHOT, toolCallRows: CONSUMER_ROWS,
    captureEvents: [capturedRequest({
      toolResults: [searchResult([{ ...REAL_ITEMS[0], owner_user_id: "usr-someone-else" }])],
    })],
  });
  assert.equal(result.ownerMismatches.length, 1);
  assert.equal(result.ownerMismatches[0].snapshot, "usr-author");
});

test("relation is unknown when no service-side row identifies the consumer", () => {
  const { events } = buildEarlyEvents({
    snapshot: SNAPSHOT, toolCallRows: [],
    captureEvents: [capturedRequest({ toolResults: [searchResult([REAL_ITEMS[0]])] })],
  });
  for (const e of events) assert.equal(e.relation, "unknown");
});

test("the summary says not observed rather than zero", () => {
  const rendered = summarizeEarly(buildEarlyEvents({ snapshot: SNAPSHOT, toolCallRows: CONSUMER_ROWS }));
  assert.equal(rendered.total, 0);
  assert.equal(rendered.byState.selected ?? 0, 0);
});

// ── against the recorded session ──────────────────────────────────

test("the recorded three-channel session yields recalled and injected, and no selected", () => {
  const snapshot = JSON.parse(readFileSync("evaluation/provenance/artifacts/asset-pool-snapshot.json", "utf8"));
  const captureEvents = parseJsonl(readFileSync("evaluation/gate0/artifacts/gate0-threechannel-capture.jsonl", "utf8"));
  const toolCallRows = parseJsonl(readFileSync("evaluation/gate0/artifacts/tool-call-logs.jsonl", "utf8"));

  const { events, unresolved } = buildEarlyEvents({ snapshot, toolCallRows, captureEvents });
  const byState = {};
  for (const e of events) byState[e.state] = (byState[e.state] ?? 0) + 1;

  assert.equal(byState.recalled, 2, "both skills came back from one skill/search");
  assert.equal(byState.injected, 2);
  assert.equal(byState.selected ?? 0, 0, "no candidate log was recorded for that session");

  // The memory hits in that session are real, and the snapshot covers only
  // skill and knowledge. They are reported as unresolved rather than dropped.
  assert.ok(Object.keys(unresolved).some((k) => k.startsWith("listing:m_")));
});
