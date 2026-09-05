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

import { judgeSession, isContentBearingFetch, precedes } from "./judge-hard.mjs";

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
    evidence_tier: null,
    executed_endpoint: "get-by-name",
    proof_refs: [{ kind: "bridge_row", ref: "tool_call_logs:...", detail: "request names skl-wrong" }],
    parent_event_ids: [],
    ...over,
  };
}

function operation(over = {}) {
  return {
    seq: 0,
    kind: "tool_call",
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
    operations: [operation()],
    ...over,
  };
}

const TOKENS = { "skl-wrong": ["10.244.7.19"] };
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
    { "skl-right": ["47318"] },
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
  const { events } = judge([fetched({ occurred_at: T.late })], run());
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
  const { events } = judge([fetched({ asset_version: 2 })], run());
  assert.equal(events[0].asset_version, 2);
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

test("a diff hunk follows every timed fetch in the run", () => {
  // A diff is the end state of a run, not an event within it. It has no time,
  // so it is ordered after everything observed rather than dropped.
  const hunk = { ordering: "end_of_run", occurred_at: null };
  assert.equal(precedes(fetched(), hunk), true);
  assert.equal(precedes(fetched({ occurred_at: "" }), hunk), false);

  const { events } = judge([fetched()], run({
    operations: [operation({
      kind: "diff_hunk", occurred_at: null, ordering: "end_of_run",
      locus: "diff:deploy/config.yaml:12-18",
      text: "-bridge: http://old\n+bridge: http://10.244.7.19:8096",
    })],
  }));
  assert.equal(events[0].state, "used");
  assert.equal(events[0].target_type, "code_change");
  assert.equal(events[0].proof_refs[0].kind, "diff_hunk");
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
