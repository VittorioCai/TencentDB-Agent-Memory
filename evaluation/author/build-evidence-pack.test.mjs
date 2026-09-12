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
import { pairCalls, outcomeRecord, bodyTokens, l0Record, mergeRecord, outcomeQueries, mergeOutcomeRows } from "./build-evidence-pack.mjs";

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

test("the same message from two endpoints merges instead of overwriting", () => {
  // conversation/query returns session_id; conversation/search returns only
  // content/id/role/score/timestamp. A plain overwrite let the search copy
  // replace the query copy, and every message the search found lost its
  // session id — which the chain then reported as "carries no session id"
  // about data the product had returned (2026-09-08g).
  const fromQuery = l0Record({ id: "m1", role: "assistant", content: "probed 10.244.7.19:8096", timestamp: "2026-09-05T10:00:00Z", session_id: "sess-1", task_id: "t1" });
  const fromSearch = l0Record({ id: "m1", role: "assistant", content: "probed 10.244.7.19:8096", timestamp: "2026-09-05T10:00:00Z" });
  assert.equal(fromQuery.meta.session_id, "sess-1");
  assert.equal(fromSearch.meta.session_id, null);
  // The merge keeps what the richer copy had.
  const merged = mergeRecord(fromQuery, fromSearch);
  assert.equal(merged.meta.session_id, "sess-1");
  assert.equal(merged.meta.task_id, "t1");
  // …in either arrival order.
  assert.equal(mergeRecord(fromSearch, fromQuery).meta.session_id, "sess-1");
});

test("the pack asks for the author's results as a consumer, not only results on the author's assets", () => {
  // B validated A's note twice as its consumer. A pack built from the owner
  // query alone holds no harness-verified row for B, and B's competence reads
  // "unknown" with two successes on file (2026-09-11, the second dev-loop task).
  const qs = outcomeQueries({ team_id: "team-1", user_id: "usr-b" }, "2026-09-11T18:00:00.000Z");
  assert.equal(qs.length, 2);
  assert.deepEqual(qs.map((q) => q.owner_user_id ?? null), ["usr-b", null]);
  assert.deepEqual(qs.map((q) => q.consumer_user_id ?? null), [null, "usr-b"]);
  assert.ok(qs.every((q) => q.occurred_before === "2026-09-11T18:00:00.000Z" && q.team_id === "team-1"));
});

test("rows from both queries are merged once per outcome id", () => {
  const onAssets = [{ id: "o1", asset_id: "skl-mine", consumer_user_id: "usr-b" }, { id: "o2", asset_id: "skl-mine", consumer_user_id: "usr-me" }];
  const asConsumer = [{ id: "o2", asset_id: "skl-mine", consumer_user_id: "usr-me" }, { id: "o3", asset_id: "skl-theirs", consumer_user_id: "usr-me" }];
  const merged = mergeOutcomeRows(onAssets, asConsumer);
  assert.deepEqual(merged.map((o) => o.id), ["o1", "o2", "o3"]);   // o2 once; o3 (my result on their asset) present
});

// --- 2026-09-12 第二人复核:"来源链完整"其实只是三个集合各自非空 -----------------------
import { chainFacts } from "./build-evidence-pack.mjs";

test("三个集合非空 ≠ 生产链成立:写入者是事实,生产来源标未证实", () => {
  const f = chainFacts({
    assetVersion: 2, contentHash: "h2", writer: "usr-a",
    sessions: ["s1"], naming: [{ record_id: "l0:1" }], ops: [{ record_id: "call:1" }], results: [{ record_id: "outcome:1" }],
  });
  assert.equal(f.writer_known, true);
  assert.equal(f.production_link, "unproven");
  assert.equal(f.complete, undefined, "不再给 complete 这种会被读成生产链成立的字段");
  assert.match(f.what_this_is, /相关证据汇集|related evidence/);
  assert.match(f.production_note, /相邻|adjacen|未验证/);
  assert.deepEqual(f.collected, { source_sessions: 1, naming_messages: 1, operations: 1, results: 1 });
});

test("集合为空按缺口列出,但缺口不改变「生产来源未证实」这一点", () => {
  const f = chainFacts({ assetVersion: 2, contentHash: null, writer: null, sessions: [], naming: [], ops: [], results: [] });
  assert.equal(f.writer_known, false);
  assert.equal(f.production_link, "unproven");
  assert.equal(f.gaps.length, 4);
  assert.ok(f.gaps.some((g) => /写入者|producer/.test(g)));
});
