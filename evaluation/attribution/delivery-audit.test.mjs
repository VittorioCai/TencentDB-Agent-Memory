/**
 * The five readings the calibration rules depend on, each written as the
 * case that would otherwise be scored wrong.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { auditDelivery, firstAppearances, longestHistory } from "./delivery-audit.mjs";

const req = (messages) => ({ body: { json: { messages } } });
const TOKENS = { "skl-hidden": { version: 2, tokens: ["10.244.7.19"] }, "skl-ok": { version: 2, tokens: ["47318"] } };

test("a bypass read is caught: the channel does not matter, the content does", () => {
  // Not a skill-API read — the model wrote the body to a file and read it
  // back with a file tool. The old detector watched `get`/`get-by-name` and
  // saw nothing.
  const a = auditDelivery([req([
    { role: "system", content: "you are an agent" },
    { role: "user", content: "reach the bridge" },
    { role: "assistant", content: "reading the notes file" },
    { role: "tool", content: "  1→convention notes\n  2→address 10.244.7.19:8096" },
    { role: "assistant", content: "now probing" },
  ])], TOKENS, { operationIndex: 4 });
  assert.equal(a.assets["skl-hidden"].verdict, "delivered");
  assert.equal(a.assets["skl-hidden"].findings[0].at, 3);
  assert.equal(a.assets["skl-hidden"].findings[0].role, "tool");
  assert.equal(a.assets["skl-ok"].verdict, "not_delivered");
});

test("the model writing a token, then reading it back, is an echo — not a delivery", () => {
  // The reviewer's case: without this, a real false positive would be
  // rewritten as an isolation failure and the error hidden.
  const a = auditDelivery([req([
    { role: "system", content: "you are an agent" },
    { role: "assistant", content: "I recall the address is 10.244.7.19:8096; writing it to notes.md" },
    { role: "tool", content: "wrote notes.md" },
    { role: "assistant", content: "reading notes.md back" },
    { role: "tool", content: "  1→address 10.244.7.19:8096" },
    { role: "assistant", content: "probing" },
  ])], TOKENS, { operationIndex: 5 });
  const f = a.assets["skl-hidden"];
  assert.equal(f.verdict, "model_echo");
  assert.equal(f.findings[0].model_wrote_at, 1);
  assert.equal(f.findings[0].at, 4);
  assert.match(f.findings[0].why, /echo of its own text/);
});

test("a token only ever in the model's own messages is not a delivery at all", () => {
  const a = auditDelivery([req([
    { role: "system", content: "you are an agent" },
    { role: "assistant", content: "from memory, 10.244.7.19:8096" },
  ])], TOKENS, { operationIndex: 1 });
  assert.equal(a.assets["skl-hidden"].verdict, "model_authored");
});

test("content that arrives after the operation does not explain it", () => {
  const a = auditDelivery([req([
    { role: "system", content: "you are an agent" },
    { role: "assistant", content: "probing both addresses" },
    { role: "tool", content: "probe done" },
    { role: "tool", content: "  1→notes mention 10.244.7.19:8096" },
  ])], TOKENS, { operationIndex: 2 });
  const f = a.assets["skl-hidden"];
  assert.equal(f.verdict, "after_operation");
  assert.equal(f.findings[0].at, 3);
  assert.equal(f.findings[0].operation_at, 2);
});

test("a token two assets share shows an alternative source, not a leak", () => {
  const shared = { "skl-hidden": { tokens: ["10.244.7.19"] }, "skl-other": { tokens: ["10.244.7.19"] } };
  const a = auditDelivery([req([
    { role: "system", content: "you are an agent" },
    { role: "tool", content: "  1→10.244.7.19:8096 documented here" },
    { role: "assistant", content: "probing" },
  ])], shared, { operationIndex: 2 });
  assert.equal(a.assets["skl-hidden"].verdict, "ambiguous_source");
  assert.deepEqual(a.assets["skl-hidden"].findings[0].shared_with, ["skl-other"]);
  assert.match(a.assets["skl-hidden"].findings[0].why, /alternative source exists/);
});

test("an empty or partial capture is unknown, never clean", () => {
  assert.equal(auditDelivery([], TOKENS, { operationIndex: 1 }).assets["skl-hidden"].verdict, "unknown");
  const partial = auditDelivery([req([{ role: "system", content: "x" }])], TOKENS, { operationIndex: 1, captureComplete: false });
  assert.equal(partial.assets["skl-hidden"].verdict, "unknown");
  assert.equal(partial.capture_complete, false);
});

test("no operation index means the ordering is unknown, not favourable", () => {
  const a = auditDelivery([req([
    { role: "system", content: "you are an agent" },
    { role: "tool", content: "10.244.7.19:8096" },
  ])], TOKENS, {});
  assert.equal(a.assets["skl-hidden"].verdict, "delivered_order_unknown");
});

test("the fullest request is the run's history; first appearances are told apart by role", () => {
  const msgs = [{ role: "system", content: "a" }, { role: "assistant", content: "tok" }, { role: "tool", content: "tok" }];
  assert.equal(longestHistory([req(msgs.slice(0, 2)), req(msgs)]).length, 3);
  assert.deepEqual(firstAppearances(msgs, "tok"), { input: 2, assistant: 1 });
  assert.deepEqual(firstAppearances(msgs, "nope"), { input: null, assistant: null });
});

test("a token that arrived from something other than the asset is an alternative source, not a leak", () => {
  // The real case from batch 3: the address reached the model inside the
  // agent's OWN memory document, not inside the hidden asset. Same token,
  // different source — reporting that as the asset leaking would be wrong.
  const msgs = [
    { role: "system", content: "you are an agent" },
    { role: "assistant", content: "reading my notes" },
    { role: "tool", content: "  1→convention SOP … 10.244.7.19:8096 documented-but-silent" },
    { role: "assistant", content: "probing" },
  ];
  const sourceOf = (i) => (i === 2 ? "Read /home/agent/memory/persona.md" : "");
  const a = auditDelivery([req(msgs)], TOKENS, { operationIndex: 3, sourceOf });
  assert.equal(a.assets["skl-hidden"].verdict, "ambiguous_source");
  assert.match(a.assets["skl-hidden"].findings[0].why, /does not name this asset/);
  // Whereas arriving from a read of the asset itself is a delivery.
  const fromAsset = auditDelivery([req(msgs)], TOKENS, { operationIndex: 3, sourceOf: (i) => (i === 2 ? "skill/get skl-hidden" : "") });
  assert.equal(fromAsset.assets["skl-hidden"].verdict, "delivered");
});

test("a delivery whose source the run did not record is unknown, not an alternative source", () => {
  // Treating "we did not record what produced this" as "it was not the
  // asset" turns a gap in the record into a finding — the same mistake the
  // channel-watching detector made, pointing the other way.
  const msgs = [
    { role: "system", content: "you are an agent" },
    { role: "tool", content: "10.244.7.19:8096 appears here" },
    { role: "assistant", content: "probing" },
  ];
  const a = auditDelivery([req(msgs)], TOKENS, { operationIndex: 2, sourceOf: () => "" });
  assert.equal(a.assets["skl-hidden"].verdict, "source_unknown");
  assert.match(a.assets["skl-hidden"].findings[0].why, /did not record what produced/);
});
