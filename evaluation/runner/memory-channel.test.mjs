/**
 * The memory channel the profile snapshot does not cover.
 *
 * Batch 4 (2026-09-10): two gate-off runs called the product's
 * `memory-bridge/v3/atomic/search` and got back items the memory pipeline had
 * written from EARLIER sessions of the same consumer in the same batch — one
 * of them "eval-bridge-endpoint-a … times out and conflicts with the working
 * eval-bridge-endpoint-b address". The L2/L3 profile tree was snapshotted and
 * restored per run; the atomic store (vectors.db, records/, skill_buffer/) was
 * not, and nothing in the checkpoints or the confounder scan looked at what a
 * memory read returned. These tests pin the reading: every memory item a model
 * received is listed with its creation time, and an item created before the
 * run started is residue — from this batch or from before it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { memoryItemsFromCapture, memoryResidue } from "./memory-channel.mjs";

const STARTED = "2026-09-10T23:26:27Z";

function capture(steps) {
  const messages = [{ role: "user", content: "do the task" }];
  steps.forEach(({ command, result }, i) => {
    messages.push({ role: "assistant", tool_calls: [{ id: `c${i}`, function: { name: "Bash", arguments: JSON.stringify({ command }) } }] });
    if (result !== undefined) messages.push({ role: "tool", tool_call_id: `c${i}`, content: `Command: ${command}\nStdout: ${result}\nExit Code: 0` });
  });
  return [
    { event: "http.request", requestId: "r0", timestamp: "2026-09-10T23:26:30Z", body: { json: { messages: messages.slice(0, 1) } } },
    { event: "http.request", requestId: "r1", timestamp: "2026-09-10T23:26:50Z", body: { json: { messages } } },
  ];
}

const SEARCH = `curl -sSk -X POST http://127.0.0.1:8096/memory-bridge/v3/atomic/search -H 'x-tdai-service-id: default' -d '{"query":"bridge endpoint","limit":8}'`;
const envelope = (items) => JSON.stringify({ code: 0, message: "ok", data: { items } });
const item = (id, created_at, content, type = "work_fact") => ({ id, type, content, created_at, agent_id: "agt-consumer", task_id: "task-x" });

test("every item a memory read returned is listed with where it arrived and when it was created", () => {
  const cap = capture([{ command: SEARCH, result: envelope([
    item("m_1", "2026-09-10T23:25:51.748Z", "two conflicting conventions …"),
    item("m_2", "2026-09-10T23:26:40.000Z", "written by this very session"),
  ]) }]);
  const got = memoryItemsFromCapture(cap);
  assert.deepEqual(got.problems, []);
  assert.deepEqual(got.reads.map((r) => r.message_index), [1]);
  assert.deepEqual(got.items.map((i) => [i.id, i.created_at, i.message_index, i.endpoint]),
    [["m_1", "2026-09-10T23:25:51.748Z", 2, "atomic/search"], ["m_2", "2026-09-10T23:26:40.000Z", 2, "atomic/search"]]);
});

test("an item created before the run started is residue; one created during the run is not", () => {
  const items = [
    { id: "m_1", created_at: "2026-09-10T23:25:51.748Z" },
    { id: "m_2", created_at: "2026-09-10T23:26:40.000Z" },
    { id: "m_0", created_at: "2026-09-10T23:05:56.892Z" },
  ];
  const r = memoryResidue(items, STARTED, { batch_started_at: "2026-09-10T23:13:29Z" });
  assert.deepEqual(r.residue.map((i) => i.id), ["m_1", "m_0"]);
  assert.deepEqual(r.from_this_batch.map((i) => i.id), ["m_1"]);
  assert.deepEqual(r.from_before_batch.map((i) => i.id), ["m_0"]);
  assert.deepEqual(r.own.map((i) => i.id), ["m_2"]);
});

test("a memory read that returned nothing is a read with zero items, not an absence of reads", () => {
  const got = memoryItemsFromCapture(capture([{ command: SEARCH, result: envelope([]) }]));
  assert.equal(got.reads.length, 1);
  assert.equal(got.items.length, 0);
});

test("a memory read whose result cannot be parsed is reported, not silently counted as clean", () => {
  const got = memoryItemsFromCapture(capture([{ command: SEARCH, result: "{not json" }]));
  assert.equal(got.reads.length, 1);
  assert.equal(got.problems.length, 1);
  assert.match(got.problems[0], /c0/);
});

test("a memory read whose result was never captured is reported too", () => {
  const got = memoryItemsFromCapture(capture([{ command: SEARCH }]));
  assert.equal(got.reads.length, 1);
  assert.equal(got.problems.length, 1);
  assert.match(got.problems[0], /no result/);
});

test("the L2 scene read of batch 3 is a memory read as well", () => {
  const scenario = `curl -sSk -X POST http://127.0.0.1:8096/memory-bridge/v3/scenario/read -d '{"scene":"x"}'`;
  const got = memoryItemsFromCapture(capture([{ command: scenario, result: envelope([item("s_1", "2026-09-08T07:56:30Z", "endpoint-b outranks endpoint-a", "scene_block")]) }]));
  assert.deepEqual(got.items.map((i) => [i.id, i.endpoint]), [["s_1", "scenario/read"]]);
});

test("skill-bridge reads are not memory reads", () => {
  const skill = `curl -sSk -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/search -d '{"query":"x"}'`;
  const got = memoryItemsFromCapture(capture([{ command: skill, result: envelope([{ skill_id: "skl-1", created_at_ms: 1 }]) }]));
  assert.equal(got.reads.length, 0);
  assert.equal(got.items.length, 0);
});

test("without a start time nothing can be called residue", () => {
  const r = memoryResidue([{ id: "m_1", created_at: "2026-09-10T23:25:51.748Z" }], null);
  assert.equal(r.residue, null);
});

// ── the conversation store (found after the atomic store, same batch) ──────
// `conversation/search` returns `data.messages` with a `timestamp` and a
// `source_agent_id`; `conversation/query` returns `data.messages` with a
// `session_id`. Run 9 of batch 4 got prep run 1's whole final report that way.

const CONV_SEARCH = `curl -sSk -X POST http://127.0.0.1:8096/memory-bridge/v3/conversation/search -d '{"query":"bridge endpoint decision"}'`;
const CONV_QUERY = `curl -sSk -X POST http://127.0.0.1:8096/memory-bridge/v3/conversation/query -d '{"limit":20}'`;
const OWN_SESSION = "0320e82f-c456-464b-a7de-b1b9b478bffc";

test("conversation messages are memory items, dated by their timestamp", () => {
  const cap = capture([{ command: CONV_SEARCH, result: JSON.stringify({ code: 0, message: "ok", data: { searched_agents: 1, messages: [
    { id: "msg-a", role: "assistant", timestamp: "2026-09-10T23:14:12.757Z", source_agent_id: "agt-consumer", content: "Key finding: …" },
    { id: "msg-b", role: "assistant", timestamp: "2026-09-10T23:28:59.676Z", source_agent_id: "agt-consumer", content: "Two conflicting records …" },
  ] } }) }]);
  const got = memoryItemsFromCapture(cap);
  assert.deepEqual(got.items.map((i) => [i.id, i.type, i.created_at, i.endpoint]),
    [["msg-a", "message", "2026-09-10T23:14:12.757Z", "conversation/search"], ["msg-b", "message", "2026-09-10T23:28:59.676Z", "conversation/search"]]);
});

test("a message from another session is residue even when its timestamp is not older than the run", () => {
  const items = [
    { id: "msg-x", created_at: "2026-09-10T23:28:50.000Z", session_id: "8698690a-other" },
    { id: "msg-y", created_at: "2026-09-10T23:28:50.000Z", session_id: OWN_SESSION },
  ];
  const r = memoryResidue(items, "2026-09-10T23:28:35Z", { own_session: OWN_SESSION });
  assert.deepEqual(r.residue.map((i) => i.id), ["msg-x"]);
  assert.deepEqual(r.own.map((i) => i.id), ["msg-y"]);
});

test("conversation/query carries the session id, so a whole earlier session read back is residue by session, not by guesswork", () => {
  const cap = capture([{ command: CONV_QUERY, result: JSON.stringify({ code: 0, message: "ok", data: { total: 20, messages: [
    { id: "msg-final", session_id: "8698690a-other", agent_id: "agt-consumer", role: "assistant", timestamp: "2026-09-10T23:14:38.958Z", content: "Done. Here's the outcome." },
  ] } }) }]);
  const got = memoryItemsFromCapture(cap);
  assert.equal(got.items[0].session_id, "8698690a-other");
  const r = memoryResidue(got.items, "2026-09-10T23:28:35Z", { own_session: OWN_SESSION, batch_started_at: "2026-09-10T23:21:51Z" });
  assert.deepEqual(r.residue.map((i) => i.id), ["msg-final"]);
  assert.deepEqual(r.from_before_batch.map((i) => i.id), ["msg-final"]);
});

test("an item with neither a date nor a session is undated, never assumed own", () => {
  const r = memoryResidue([{ id: "m_nodate" }], "2026-09-10T23:28:35Z", { own_session: OWN_SESSION });
  assert.deepEqual(r.undated.map((i) => i.id), ["m_nodate"]);
  assert.deepEqual(r.residue, []);
  assert.deepEqual(r.own, []);
});

// ── per-run record (fresh consumer per run, review 2026-09-11 item 5) ──
import { memoryChannelRecord } from "./memory-channel.mjs";

function captureWithRead(items) {
  const call_id = "call_m1";
  return [{ event: "http.request", timestamp: "2026-09-11T10:00:05Z", body: { json: { messages: [
    { role: "assistant", tool_calls: [{ id: call_id, function: { name: "Bash", arguments: JSON.stringify({ command: "curl http://127.0.0.1:8096/memory-bridge/v3/atomic/search -d '{}'" }) } }] },
    { role: "tool", tool_call_id: call_id, content: JSON.stringify({ code: 0, data: { items } }) },
  ] } } }];
}

test("an item owned by another agent is borrowed even when it is dated inside this run", () => {
  const rows = captureWithRead([
    { id: "m1", type: "work_fact", content: "own", created_at: "2026-09-11T10:00:02Z", agent_id: "agt-fresh" },
    { id: "m2", type: "work_fact", content: "someone else's", created_at: "2026-09-11T10:00:03Z", agent_id: "agt-older" },
  ]);
  const rec = memoryChannelRecord(rows, { started_at: "2026-09-11T10:00:00Z", consumer: "agt-fresh" });
  assert.equal(rec.reads, 1);
  assert.equal(rec.items, 2);
  assert.equal(rec.residue, 0);
  assert.equal(rec.borrowed_from_other_agents, 1);
  assert.equal(rec.ok, false);
  assert.deepEqual(rec.borrowed_items.map((i) => i.id), ["m2"]);
});

test("a clean run — only its own, later-dated items — is ok; an undated item leaves ok undecided", () => {
  const clean = memoryChannelRecord(captureWithRead([{ id: "m1", content: "x", created_at: "2026-09-11T10:00:02Z", agent_id: "agt-fresh" }]), { started_at: "2026-09-11T10:00:00Z", consumer: "agt-fresh" });
  assert.equal(clean.ok, true);
  const undated = memoryChannelRecord(captureWithRead([{ id: "m1", content: "x", agent_id: "agt-fresh" }]), { started_at: "2026-09-11T10:00:00Z", consumer: "agt-fresh" });
  assert.equal(undated.ok, null);
  assert.equal(undated.undated, 1);
  const none = memoryChannelRecord([], { started_at: "2026-09-11T10:00:00Z", consumer: "agt-fresh" });
  assert.equal(none.reads, 0);
  assert.equal(none.ok, true);
});
