/**
 * One test per reading that would otherwise be scored wrong. Five of them
 * are the cases review found in the first draft of this module; they are
 * kept as tests rather than as notes because each was a real defect.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { auditDelivery, allMessages, pathsModelWroteTokenInto, operationFromTargetRef, attributionFromCapture } from "./delivery-audit.mjs";

const req = (messages, requestId) => ({ requestId, body: { json: { messages } } });
const TOKENS = { "skl-hidden": { version: 2, tokens: ["10.244.7.19"] }, "skl-ok": { version: 2, tokens: ["47318"] } };
/** The collector's answer: what this content actually came from. */
const fromAsset = (idx, assetId) => (pos) => (pos.index === idx ? { asset_id: assetId } : null);

test("a bypass read is caught: the channel does not matter, the content and its attribution do", () => {
  const a = auditDelivery([req([
    { role: "system", content: "you are an agent" },
    { role: "user", content: "reach the bridge" },
    { role: "assistant", content: "reading it" },
    { role: "tool", content: "  1→address 10.244.7.19:8096" },
    { role: "assistant", content: "now probing" },
  ])], TOKENS, { operation: { request: 0, index: 4 }, attributionOf: fromAsset(3, "skl-hidden"), coverageAsserted: true });
  assert.equal(a.assets["skl-hidden"].verdict, "delivered");
  assert.equal(a.assets["skl-ok"].verdict, "not_delivered");
});

test("a token only ever in the model's own messages is not a delivery", () => {
  const a = auditDelivery([req([
    { role: "system", content: "you are an agent" },
    { role: "assistant", content: "from memory, 10.244.7.19:8096" },
  ])], TOKENS, { operation: { request: 0, index: 1 }, attributionOf: () => null, coverageAsserted: true });
  assert.equal(a.assets["skl-hidden"].verdict, "model_authored");
});

test("content that arrives after the operation does not explain it", () => {
  const a = auditDelivery([req([
    { role: "system", content: "you are an agent" },
    { role: "assistant", content: "probing" },
    { role: "tool", content: "probe done" },
    { role: "tool", content: "  1→notes mention 10.244.7.19:8096" },
  ])], TOKENS, { operation: { request: 0, index: 2 }, attributionOf: fromAsset(3, "skl-hidden"), coverageAsserted: true });
  const f = a.assets["skl-hidden"];
  assert.equal(f.verdict, "after_operation");
  assert.match(f.findings[0].why, /later content cannot explain/);
});

test("attribution to something else is an alternative source, not a leak", () => {
  const a = auditDelivery([req([
    { role: "system", content: "you are an agent" },
    { role: "tool", content: "  1→10.244.7.19:8096 documented here" },
    { role: "assistant", content: "probing" },
  ])], TOKENS, { operation: { request: 0, index: 2 }, coverageAsserted: true,
    attributionOf: () => ({ asset_id: null, path: "/home/agent/memory/persona.md" }) });
  assert.equal(a.assets["skl-hidden"].verdict, "ambiguous_source");
  assert.match(a.assets["skl-hidden"].findings[0].why, /alternative source/);
});

test("an empty capture is not seen, never clean; asserted coverage is what upgrades it", () => {
  assert.equal(auditDelivery([], TOKENS, {}).assets["skl-hidden"].verdict, "not_seen_in_capture");
  assert.equal(auditDelivery([], TOKENS, { coverageAsserted: true }).assets["skl-hidden"].verdict, "not_delivered");
});

test("no resolved operation position means the ordering is unknown, not favourable", () => {
  const a = auditDelivery([req([
    { role: "system", content: "you are an agent" },
    { role: "tool", content: "10.244.7.19:8096" },
  ])], TOKENS, { attributionOf: fromAsset(1, "skl-hidden"), coverageAsserted: true });
  assert.equal(a.assets["skl-hidden"].verdict, "delivered_order_unknown");
});

// ── the five review found in the first draft ──

test("REPRO 1a: a token written through a tool ARGUMENT, then read back, is an echo", () => {
  // A content-only scan never saw the Write argument, so the read-back was
  // the first "input" appearance and came out as a delivery.
  const a = auditDelivery([req([
    { role: "system", content: "you are an agent" },
    { role: "assistant", content: null, tool_calls: [{ id: "c1", function: { name: "Write", arguments: JSON.stringify({ file_path: "/tmp/n.md", content: "address 10.244.7.19:8096" }) } }] },
    { role: "tool", tool_call_id: "c1", content: "wrote /tmp/n.md" },
    { role: "assistant", content: null, tool_calls: [{ id: "c2", function: { name: "Read", arguments: JSON.stringify({ file_path: "/tmp/n.md" }) } }] },
    { role: "tool", tool_call_id: "c2", content: "  1→address 10.244.7.19:8096" },
    { role: "assistant", content: "probing" },
  ])], TOKENS, { operation: { request: 0, index: 5 }, coverageAsserted: true,
    attributionOf: (pos) => (pos.index === 4 ? { asset_id: null, path: "/tmp/n.md" } : null) });
  assert.equal(a.assets["skl-hidden"].verdict, "model_echo");
  assert.deepEqual(a.assets["skl-hidden"].findings[0].wrote_paths, ["/tmp/n.md"]);
});

test("REPRO 1b: guessing a token earlier does not make a later genuine read an echo", () => {
  // Order is not an echo relation. The model mentioned the address from
  // memory and then actually read the asset; that read IS a delivery.
  const a = auditDelivery([req([
    { role: "system", content: "you are an agent" },
    { role: "assistant", content: "I think it is 10.244.7.19:8096, let me check the skill" },
    { role: "assistant", content: null, tool_calls: [{ id: "c1", function: { name: "Bash", arguments: JSON.stringify({ command: "curl .../skill/get" }) } }] },
    { role: "tool", tool_call_id: "c1", content: "{\"content\":\"reach it at 10.244.7.19:8096\"}" },
    { role: "assistant", content: "probing" },
  ])], TOKENS, { operation: { request: 0, index: 4 }, attributionOf: fromAsset(3, "skl-hidden"), coverageAsserted: true });
  assert.equal(a.assets["skl-hidden"].verdict, "delivered");
});

test("REPRO 2: every request is scanned — the longest one is not the whole history", () => {
  // Turn one carried the token in a system prompt that turn two replaced.
  const turn1 = req([
    { role: "system", content: "context: the address is 10.244.7.19:8096" },
    { role: "user", content: "go" },
  ], "r1");
  const turn2 = req([
    { role: "system", content: "context: (trimmed)" },
    { role: "user", content: "go" },
    { role: "assistant", content: "working" },
    { role: "tool", content: "done" },
  ], "r2");
  const a = auditDelivery([turn1, turn2], TOKENS, { operation: { request: 1, index: 3 }, coverageAsserted: true,
    attributionOf: (pos) => (pos.request === 0 && pos.index === 0 ? { asset_id: "skl-hidden" } : null) });
  assert.equal(a.assets["skl-hidden"].verdict, "delivered");
  assert.equal(a.messages_scanned, 6);
  assert.equal(a.requests_scanned, 2);
});

test("REPRO 3a: with nothing recorded about the source, a hit is not a delivery", () => {
  const a = auditDelivery([req([
    { role: "system", content: "you are an agent" },
    { role: "tool", content: "10.244.7.19:8096" },
    { role: "assistant", content: "probing" },
  ])], TOKENS, { operation: { request: 0, index: 2 }, coverageAsserted: true });
  assert.equal(a.assets["skl-hidden"].verdict, "source_unknown");
});

test("REPRO 3b: naming an asset in a command is not fetching it", () => {
  // `grep skl-hidden /tmp/other-memory` mentions the id and reads something
  // else. Attribution comes from the collector, not from substrings.
  const a = auditDelivery([req([
    { role: "system", content: "you are an agent" },
    { role: "tool", content: "10.244.7.19:8096 found" },
    { role: "assistant", content: "probing" },
  ])], TOKENS, { operation: { request: 0, index: 2 }, coverageAsserted: true,
    attributionOf: () => ({ asset_id: null, command: "grep skl-hidden /tmp/other-memory" }) });
  assert.equal(a.assets["skl-hidden"].verdict, "ambiguous_source");
});

test("helpers: messages carry their position; written paths are collected from arguments", () => {
  const msgs = [{ role: "system", content: "a" }, { role: "assistant", content: "tok" }];
  assert.equal(allMessages([req(msgs), req(msgs)]).length, 4);
  const entries = allMessages([req([
    { role: "assistant", content: null, tool_calls: [{ function: { name: "Write", arguments: JSON.stringify({ file_path: "/tmp/a.md", content: "tok here" }) } }] },
    { role: "assistant", content: null, tool_calls: [{ function: { name: "Bash", arguments: JSON.stringify({ command: "echo tok > /tmp/b.md" }) } }] },
  ])]);
  const paths = pathsModelWroteTokenInto(entries, "tok");
  assert.ok(paths.has("/tmp/a.md"));
  assert.ok(paths.has("/tmp/b.md"));
});

test("the operation's position comes from the used-event's target_ref", () => {
  const requests = [req([], "aaa"), req([], "b7dcd066")];
  const op = operationFromTargetRef("request(b7dcd066):msg[17]:call_00_x:arguments", requests);
  assert.deepEqual({ request: op.request, index: op.index, resolved: op.resolved_request }, { request: 1, index: 17, resolved: true });
  assert.equal(operationFromTargetRef("nonsense", requests), null);
});

test("attribution is read from the call that produced the result, not from the text", () => {
  const requests = [req([
    { role: "assistant", content: null, tool_calls: [{ id: "c1", function: { name: "Bash", arguments: JSON.stringify({ command: "curl .../skill/get -d '{\"skill_id\":\"skl-hidden\"}'" }) } }] },
    { role: "tool", tool_call_id: "c1", content: "10.244.7.19:8096" },
    { role: "assistant", content: null, tool_calls: [{ id: "c2", function: { name: "Bash", arguments: JSON.stringify({ command: "grep skl-hidden /tmp/other-memory" }) } }] },
    { role: "tool", tool_call_id: "c2", content: "10.244.7.19:8096" },
  ])];
  const attributionOf = attributionFromCapture(requests);
  const entries = allMessages(requests);
  // The skill read is attributed to the asset; the grep is not.
  assert.equal(attributionOf({ request: 0, index: 1 }, entries[1]).asset_id, "skl-hidden");
  assert.equal(attributionOf({ request: 0, index: 3 }, entries[3]).asset_id, null);
  assert.match(attributionOf({ request: 0, index: 3 }, entries[3]).command, /^grep skl-hidden/);
});
