/**
 * Tests for the hard-evidence judge.
 *
 * Each case is one way a `used` claim can be false while looking true. The
 * three the earlier verifier actually fell for each have their own test, and so
 * does every clause of the claim: this version, content arrived, arrived first,
 * and the model acted on it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { judgeSession, isContentBearingFetch, precedes, tokenSet } from "./judge-hard.mjs";

const T = {
  fetchA: "2026-09-05T10:00:00Z",
  op: "2026-09-05T10:01:00Z",
  late: "2026-09-05T10:02:00Z",
};

/** A `fetched` event of the shape build-events.mjs emits. */
function fetched(over = {}) {
  return {
    schema_version: "provenance-v1",
    event_id: "evt-fetch-1",
    state: "fetched",
    session_key: "sess-1",
    occurred_at: T.fetchA,
    asset_id: "skl-wrong",
    asset_type: "skill",
    asset_name: "eval-bridge-endpoint-a",
    asset_version: 1,
    producer_user_id: "usr-author",
    producer_agent_id: "agt-author",
    actor_user_id: "usr-consumer",
    actor_agent_id: "agt-consumer",
    relation: "cross_user",
    observation: "bridge+wire",
    // The response was inspected and carried the body, at this position in the
    // message sequence. Both are what make it creditable at all.
    content_delivered: true,
    context_entry_index: 1,
    evidence_tier: null,
    executed_endpoint: "get-by-name",
    proof_refs: [{ kind: "bridge_row", ref: "tool_call_logs:...", detail: "request names skl-wrong" }],
    parent_event_ids: [],
    ...over,
  };
}

function operation(over = {}) {
  return {
    seq: 1,
    kind: "tool_call",
    message_index: 4,
    occurred_at: T.op,
    ordering: "observed",
    call_id: "call-1",
    tool_name: "Bash",
    locus: "request(r1):msg[4]:call-1:arguments",
    text: '{"command":"curl -sSk http://10.244.7.19:8096/skill-bridge/v3/skill/search"}',
    result: null,
    ...over,
  };
}

function run(over = {}) {
  return {
    session_key: "sess-1",
    task_description: "Reach the team's skill bridge and report what it returns.",
    pre_change_files: {},
    offered_content: [],
    operations: [operation()],
    ...over,
  };
}

// Keyed to the revision the tokens were taken from. A flat array is accepted
// too, and treated as version-less — see the test at the bottom.
const TOKENS = { "skl-wrong": { version: 1, tokens: ["10.244.7.19"] } };
const judge = (events, artifacts, tokensByAsset = TOKENS) =>
  judgeSession({ events, artifacts, tokensByAsset });

// ── the positive case ─────────────────────────────────────────────

test("a token in a command issued after the content arrived is used", () => {
  const { events } = judge([fetched()], run());
  assert.equal(events.length, 1);
  assert.equal(events[0].state, "used");
  assert.equal(events[0].evidence_tier, "hard");
  assert.equal(events[0].asset_version, 1);
  assert.equal(events[0].target_type, "tool_call");
  assert.equal(events[0].target_ref, "request(r1):msg[4]:call-1:arguments");
  assert.deepEqual(events[0].parent_event_ids, ["evt-fetch-1"]);
  assert.equal(events[0].relation, "cross_user");
});

test("the right-address asset is judged the same way as the wrong one", () => {
  // Both mainline assets need a positive case, or the scenario only shows that
  // a failure can be attributed — which proves nothing about the gate working.
  const { events } = judge(
    [fetched({ event_id: "evt-fetch-2", asset_id: "skl-right", asset_name: "eval-bridge-endpoint-b", asset_version: 1 })],
    run({ operations: [operation({ text: '{"command":"curl http://127.0.0.1:47318/skill-bridge/v3/skill/search"}' })] }),
    { "skl-right": { version: 1, tokens: ["47318"] } },
  );
  assert.equal(events[0].state, "used");
  assert.equal(events[0].evidence_tier, "hard");
});

// ── the three false positives the earlier verifier fell for ───────

test("a command echo in a result is never evidence", () => {
  // The first one: a tool result repeats the command before its output, so a
  // call that timed out with empty stdout still contains the token. Only what
  // the model wrote is searched, so the echo cannot match at all.
  const { events } = judge([fetched()], run({
    operations: [operation({
      text: '{"command":"curl http://127.0.0.1:8096/skill-bridge/v3/skill/search"}',
      result: {
        locus: "request(r1):msg[5]:call-1",
        command_echo: "Command: curl http://10.244.7.19:8096/skill-bridge/v3/skill/search",
        output: "",
        exit_code: 28,
        stderr: "curl: (28) Operation timed out after 75000 ms",
      },
    })],
  }));
  assert.deepEqual(events, []);
});

test("an asset that merely returned the token is not evidence either", () => {
  // The second: one asset's own text discussed the endpoints being matched.
  // A token in what came *back* shows the service returned it, not that the
  // model acted on it.
  const { events } = judge([fetched()], run({
    operations: [operation({
      text: '{"command":"curl http://127.0.0.1:8096/skill-bridge/v3/skill/get-by-name"}',
      result: { locus: "r", command_echo: "", output: '{"content":"use 10.244.7.19:8096"}', exit_code: 0, stderr: "" },
    })],
  }));
  assert.deepEqual(events, []);
});

test("searching for a token is not using it", () => {
  // The third: the model grepped this repository and the result carried the
  // checker's own pattern, so the detector passed because the model had
  // searched for the detector.
  const { events } = judge([fetched()], run({
    operations: [operation({ text: '{"command":"grep -rn \'10.244.7.19\' evaluation/"}' })],
  }));
  assert.equal(events[0].state, "needs_review");
  assert.match(events[0].proof_refs[0].detail, /looking for it, not using it/);
});

// ── constraints (a) and (b) ───────────────────────────────────────

test("(a) a token the task description already gave is not evidence", () => {
  const { events, skipped } = judge([fetched()], run({
    task_description: "Send a request to http://10.244.7.19:8096 and report what happens.",
  }));
  assert.deepEqual(events, []);
  assert.match(skipped[0].reason, /task description/);
});

test("(b) a token already in the files before the change is not evidence", () => {
  const { events, skipped } = judge([fetched()], run({
    pre_change_files: { "deploy/config.yaml": "bridge: http://10.244.7.19:8096" },
  }));
  assert.deepEqual(events, []);
  assert.match(skipped[0].reason, /already in deploy\/config\.yaml/);
});

// ── the ordering and version clauses ──────────────────────────────

test("a token used before the content arrived is needs_review", () => {
  const { events } = judge([fetched({ context_entry_index: 9 })], run());
  assert.equal(events[0].state, "needs_review");
  assert.equal(events[0].evidence_tier, null);
  assert.equal(events[0].observation, "none");
  assert.deepEqual(events[0].parent_event_ids, []);
});

test("a token with no fetch at all is needs_review, not used", () => {
  const { events } = judge([], run());
  assert.equal(events[0].state, "needs_review");
  assert.match(events[0].proof_refs[0].detail, /may have come from elsewhere/);
});

test("the event carries the version whose content arrived, not the pool's", () => {
  // The tokens came from v2 and v2 is what was delivered, so the event says v2.
  // Whatever revision the pool holds now does not enter into it.
  const { events } = judge(
    [fetched({ asset_version: 2 })],
    run(),
    { "skl-wrong": { version: 2, tokens: ["10.244.7.19"] } },
  );
  assert.equal(events[0].state, "used");
  assert.equal(events[0].asset_version, 2);
});

test("tokenSet accepts both shapes and only one of them carries a revision", () => {
  assert.deepEqual(tokenSet({ version: 3, tokens: ["a"] }), { version: 3, tokens: ["a"] });
  assert.deepEqual(tokenSet(["a"]), { version: null, tokens: ["a"] });
});

test("a needs_review event claims no version", () => {
  // With nothing establishing that content arrived, there is no revision to
  // credit — and filling one in would be the same defect as taking it from the
  // snapshot.
  const { events } = judge([], run());
  assert.equal(events[0].asset_version, null);
});

// ── what counts as a fetch at all ─────────────────────────────────

test("a listing endpoint does not establish that content arrived", () => {
  // The state name is not trusted. An event labelled `fetched` whose endpoint
  // was an enumeration means the asset was offered; promoting on it is exactly
  // the mis-attribution this stage exists to stop.
  assert.equal(isContentBearingFetch(fetched({ executed_endpoint: "search" })), false);
  const { events } = judge([fetched({ executed_endpoint: "search" })], run());
  assert.equal(events[0].state, "needs_review");
});

test("a fetch with no endpoint and no proof establishes nothing", () => {
  assert.equal(isContentBearingFetch(fetched({ executed_endpoint: "" })), false);
  assert.equal(isContentBearingFetch(fetched({ proof_refs: [] })), false);
});

test("a diff hunk alone cannot show the asset was read before the change", () => {
  // A diff is the end state of a run, not an event within it. "After
  // everything" is not evidence of order: a run that edited the file and then
  // read the asset leaves exactly this diff. The edit operation carries a
  // position; the diff does not, so the diff alone stops at needs_review.
  const hunk = { ordering: "end_of_run", message_index: null };
  assert.equal(precedes(fetched(), hunk), false);

  const { events } = judge([fetched()], run({
    operations: [operation({
      kind: "diff_hunk", message_index: null, occurred_at: null, ordering: "end_of_run",
      locus: "diff:deploy/config.yaml:12-18",
      text: "-bridge: http://old\n+bridge: http://10.244.7.19:8096",
    })],
  }));
  assert.equal(events[0].state, "needs_review");
  assert.equal(events[0].target_type, "code_change");
  assert.match(events[0].proof_refs[0].detail, /a diff has no position in the run/);
});

test("edit first, read after: the diff must not rescue it", () => {
  // The reported case. The edit happened at message 2 and the asset's content
  // only arrived at message 5, so the edit operation is correctly
  // needs_review — and the diff of that same change must not then come out
  // `used` on the strength of being at the end.
  const { events } = judge([fetched({ context_entry_index: 5 })], run({
    operations: [
      operation({ seq: 0, message_index: 2, locus: "request(r1):msg[2]:c0:arguments" }),
      operation({
        seq: 1, kind: "diff_hunk", message_index: null, occurred_at: null,
        ordering: "end_of_run", locus: "diff:deploy/config.yaml:12-18",
        text: "+bridge: http://10.244.7.19:8096",
      }),
    ],
  }));
  assert.deepEqual(events.map((e) => e.state), ["needs_review", "needs_review"]);
});

// ── silence is a result ───────────────────────────────────────────

test("an asset fetched and never referenced stays at fetched", () => {
  // Read and ignored is a real outcome, arguably the one a team asset system
  // most needs to see. Promoting it would erase the finding.
  const { events } = judge([fetched()], run({
    operations: [operation({ text: '{"command":"echo done"}' })],
  }));
  assert.deepEqual(events, []);
});

// ── the three defects found in review ─────────────────────────────

test("two calls in one message: the second is not informed by the first", () => {
  // A model can emit several tool calls in one assistant message. They share a
  // timestamp, and the second was written before the first one's result
  // existed — so ordering on the clock reads "content arrived at 10:01, call
  // stamped 10:01" as influence when the model had seen nothing.
  //
  // Both calls sit at message 2; the result of the first arrives at message 3.
  const { events } = judge([fetched({ context_entry_index: 3 })], run({
    operations: [
      operation({ seq: 0, message_index: 2, locus: "request(r1):msg[2]:read:arguments", text: '{"command":"curl .../get-by-name"}' }),
      operation({ seq: 1, message_index: 2, locus: "request(r1):msg[2]:use:arguments" }),
    ],
  }));

  assert.equal(events.length, 1);
  assert.equal(events[0].state, "needs_review", "written in the same message as the read");
  assert.match(events[0].proof_refs[0].detail, /did not arrive before this operation|no delivery/);
});

test("a call written after the result arrives is used", () => {
  // The other side of the same test: once the result is behind it, the call
  // qualifies. Without this the rule would just be "never promote".
  const { events } = judge([fetched({ context_entry_index: 3 })], run({
    operations: [operation({ message_index: 4 })],
  }));
  assert.equal(events[0].state, "used");
  assert.match(events[0].proof_refs[0].detail, /entered the context at message 3, before this operation at message 4/);
});

test("a metadata-only response cannot be credited", () => {
  // `get` with include_content:false is not an enumeration endpoint and does
  // name the asset, so an endpoint allow-list passes it. It returns id, name
  // and version and no body at all.
  assert.equal(isContentBearingFetch(fetched({ content_delivered: false, context_entry_index: null })), false);
  const { events } = judge([fetched({ content_delivered: false, context_entry_index: null })], run());
  assert.equal(events[0].state, "needs_review");
});

test("an uncaptured response is unknown, and unknown does not promote", () => {
  assert.equal(isContentBearingFetch(fetched({ content_delivered: null, context_entry_index: null })), false);
});

test("a token that only exists in v1 is not credited to a read of v2", () => {
  // Reported case: v1 is read, then v2 is read, then a token belonging only to
  // v1 is used. Taking the most recent fetch attributes it to v2.
  const { events } = judge(
    [
      fetched({ event_id: "evt-v1", asset_version: 1, context_entry_index: 1 }),
      fetched({ event_id: "evt-v2", asset_version: 2, context_entry_index: 3 }),
    ],
    run({ operations: [operation({ message_index: 4 })] }),
  );

  assert.equal(events[0].state, "used");
  assert.equal(events[0].asset_version, 1);
  assert.deepEqual(events[0].parent_event_ids, ["evt-v1"], "credited to the read of the revision the token came from");
});

test("a token whose revision was never delivered stays needs_review", () => {
  const { events } = judge(
    [fetched({ event_id: "evt-v2", asset_version: 2, context_entry_index: 1 })],
    run({ operations: [operation({ message_index: 4 })] }),
  );
  assert.equal(events[0].state, "needs_review");
  assert.match(events[0].proof_refs[0].detail, /what did arrive was v2/);
});

test("version-less tokens cannot be credited to any fetch", () => {
  const { events } = judge([fetched()], run(), { "skl-wrong": ["10.244.7.19"] });
  assert.equal(events[0].state, "needs_review");
  assert.match(events[0].proof_refs[0].detail, /carry no version/);
});

test("a needs_review event borrows nothing from a fetch it was not credited with", () => {
  const { events } = judge([fetched({ context_entry_index: 9 })], run());
  const e = events[0];
  assert.equal(e.asset_version, null);
  assert.equal(e.observation, "none");
  assert.equal(e.executed_endpoint, "");
  assert.equal(e.upstream_status, 0);
  assert.deepEqual(e.parent_event_ids, []);
  assert.equal(e.proof_refs.length, 1, "only the operation, not the fetch's proof");
});

// ── snippet leakage: offered is not fetched ───────────────────────

test("a token delivered by a search snippet before use is not hard evidence", () => {
  // The real run's asymmetry: 47318 came back in a search snippet, 10.244.7.19
  // did not. A used judgement on 47318 would credit a full-text fetch it cannot
  // separate from the model having read the snippet.
  const { events } = judge(
    [fetched({ asset_id: "skl-right", asset_name: "eval-bridge-endpoint-b", context_entry_index: 3 })],
    run({
      operations: [operation({ message_index: 6, text: '{"command":"curl http://127.0.0.1:47318/skill-bridge/v3/skill/search -d ..."}' })],
      offered_content: [{ message_index: 2, endpoint: "skill:search", text: '{"items":[{"skill_id":"skl-right","snippet":"reach the bridge at 127.0.0.1:47318"}]}' }],
    }),
    { "skl-right": { version: 1, tokens: ["47318"] } },
  );

  assert.equal(events[0].state, "needs_review");
  assert.match(events[0].proof_refs[0].detail, /in a search snippet .* before this operation/);
});

test("a token that never appeared in a snippet still reaches used", () => {
  // The control, and the asymmetry: 10.244.7.19 was in no snippet, so a real
  // fetch of it before use is still hard evidence.
  const { events } = judge(
    [fetched({ context_entry_index: 3 })],
    run({
      operations: [operation({ message_index: 6 })],
      offered_content: [{ message_index: 2, endpoint: "skill:search", text: '{"items":[{"skill_id":"skl-wrong","snippet":"eval-bridge-endpoint-a"}]}' }],
    }),
  );
  assert.equal(events[0].state, "used");
});

test("a token first delivered by another asset's body is not credited to the later fetch", () => {
  // The second real run's near miss. The consumer read its own auto-extracted
  // skill at message 2, then the credited asset at message 5, then used the
  // token at 6. Had that skill carried the token, crediting the fetch at 5
  // would attribute to the wrong source. The earliest delivery decides.
  const { events } = judge(
    [fetched({ context_entry_index: 5 })],
    run({
      operations: [operation({ message_index: 6 })],
      delivered_content: [
        { message_index: 2, endpoint: "skill:get-by-name", kind: "fetch", source: "curl .../get-by-name -d '{\"skill_name\":\"skill-bridge-http-access\"}'", text: '{"content":"reach 10.244.7.19"}' },
        { message_index: 5, endpoint: "skill:get", kind: "fetch", source: "curl .../get", text: '{"content":"bridge at 10.244.7.19"}' },
      ],
    }),
  );
  assert.equal(events[0].state, "needs_review");
  assert.match(events[0].proof_refs[0].detail, /first reached the model at message 2 via .*skill-bridge-http-access/);
});

test("a token whose earliest delivery is the credited fetch is used", () => {
  // The control: the credited fetch's own response is in delivered_content at
  // the same index as context_entry_index. Equal is not earlier.
  const { events } = judge(
    [fetched({ context_entry_index: 5 })],
    run({
      operations: [operation({ message_index: 6 })],
      delivered_content: [
        { message_index: 2, endpoint: "skill:get-by-name", kind: "fetch", source: "curl .../get-by-name", text: '{"content":"nothing relevant here"}' },
        { message_index: 5, endpoint: "skill:get", kind: "fetch", source: "curl .../get", text: '{"content":"bridge at 10.244.7.19"}' },
      ],
    }),
  );
  assert.equal(events[0].state, "used");
});

test("a snippet that arrives after the operation does not block it", () => {
  // Only exposure that preceded the use matters.
  const { events } = judge(
    [fetched({ context_entry_index: 3 })],
    run({
      operations: [operation({ message_index: 6 })],
      offered_content: [{ message_index: 9, endpoint: "skill:search", text: "reach it at 10.244.7.19" }],
    }),
  );
  assert.equal(events[0].state, "used");
});
