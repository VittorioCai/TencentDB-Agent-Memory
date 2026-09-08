/**
 * The evidence pack's two structural rules, each pinned by the
 * counter-example that broke the earlier version (review of 2026-09-08):
 *
 *   1. a bridge_call is tied to the command it answered only when the match
 *      is unique from BOTH sides. Checking one side let two results claim
 *      one command, and the second overwrote the first — both were then
 *      reported as paired;
 *   2. an outcome record carries what the registry binds it to (version,
 *      content hash) and whether a reviewer retracted it, so the pipeline
 *      that reads the pack applies the same filters the gate does.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { pairCalls, outcomeRecord, bodyTokens } from "./build-evidence-pack.mjs";

const call = (id, kind, at, body, over = {}) => ({
  record_id: `call:${id}`, kind: "call", evidence_class: "proxy_observed", at,
  text: `${at} ${kind} ${body}`,
  meta: { kind, session_key: "s1", endpoint: "search", request_body: body, upstream_status: kind === "bridge_call" ? 200 : 0, ...over },
});

test("one command, two matching results: neither is paired — both sides must be unique", () => {
  const body = '{"query":"convention address reach skill bridge"}';
  const records = [
    call("i1", "model_intent", "2026-09-06T06:00:00.000Z", `curl -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/search -d '${body}'`),
    call("r1", "bridge_call", "2026-09-06T06:00:05.000Z", body),
    call("r2", "bridge_call", "2026-09-06T06:00:09.000Z", body),   // a duplicated service record, a retry, or the other command missing from the export
  ];
  const counts = pairCalls(records);
  assert.equal(counts.paired, 0);        // was 2
  assert.equal(counts.ambiguous, 2);
  assert.equal(records[0].meta.pairing, "ambiguous");
  assert.equal(records[0].meta.paired_call, undefined);   // the second no longer overwrites the first
  assert.match(records[1].meta.pairing_reason, /2 results match this one command/);
});

test("one command, one result: paired, and the pairing is recorded on both rows", () => {
  const body = '{"query":"convention address reach skill bridge"}';
  const records = [
    call("i1", "model_intent", "2026-09-06T06:00:00.000Z", `curl -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/search -d '${body}'`),
    call("r1", "bridge_call", "2026-09-06T06:00:05.000Z", body),
  ];
  const counts = pairCalls(records);
  assert.equal(counts.paired, 1);
  assert.equal(records[0].meta.paired_call, "call:r1");
  assert.equal(records[1].meta.paired_intent, "call:i1");
});

test("two commands could have produced one result: ambiguous, as before", () => {
  const body = '{"query":"convention address reach skill bridge"}';
  const records = [
    call("i1", "model_intent", "2026-09-06T06:00:00.000Z", `curl -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/search -d '${body}'`),
    call("i2", "model_intent", "2026-09-06T06:00:02.000Z", `curl -X POST http://10.244.7.19:8096/skill-bridge/v3/skill/search -d '${body}'`),
    call("r1", "bridge_call", "2026-09-06T06:00:05.000Z", body),
  ];
  const counts = pairCalls(records);
  assert.equal(counts.paired, 0);
  assert.equal(counts.ambiguous, 1);
  assert.match(records[2].meta.pairing_reason, /2 commands could have produced/);
});

test("a result outside the window, or in another session, is unpaired", () => {
  const body = '{"query":"convention address reach skill bridge"}';
  const late = [
    call("i1", "model_intent", "2026-09-06T06:00:00.000Z", `curl http://127.0.0.1:8096/skill-bridge/v3/skill/search -d '${body}'`),
    call("r1", "bridge_call", "2026-09-06T06:01:00.000Z", body),   // 60 s later
  ];
  assert.equal(pairCalls(late).unpaired, 1);
  const elsewhere = [
    call("i1", "model_intent", "2026-09-06T06:00:00.000Z", `curl http://127.0.0.1:8096/skill-bridge/v3/skill/search -d '${body}'`),
    call("r1", "bridge_call", "2026-09-06T06:00:05.000Z", body, { session_key: "s2" }),
  ];
  assert.equal(pairCalls(elsewhere).unpaired, 1);
});

test("an outcome record carries its binding and its retraction, so the reader can apply the gate's own filters", () => {
  const r = outcomeRecord({
    id: "o1", asset_id: "skl-a", asset_version: 2, content_hash: "hNEW", state: "corrected", corrected_reason: "wrong",
    relation: "cross_user", consumer_user_id: "usr-b", occurred_at: "2026-09-05T00:00:00Z", created_at: "2026-09-06T00:00:00Z",
    call_id: "c-9", trusted: true, retracted_at: "2026-09-07T00:00:00Z", evidence_json: "{}",
  });
  assert.equal(r.meta.content_hash, "hNEW");
  assert.equal(r.meta.retracted_at, "2026-09-07T00:00:00Z");
  assert.equal(r.meta.recorded_at, "2026-09-06T00:00:00Z");   // when the registry learned it, beside when it happened
  assert.equal(r.meta.call_id, "c-9");
});

test("body tokens are exact host:port and skill ids, never a bare host", () => {
  assert.deepEqual(bodyTokens("reach it at 10.244.7.19:8096 or skl-sZFb3KatWY6m"), ["10.244.7.19:8096", "skl-sZFb3KatWY6m"]);
  assert.deepEqual(bodyTokens("the host is 10.244.7.19"), []);
});
