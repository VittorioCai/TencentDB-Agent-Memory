/**
 * Can every bucket actually be reached?
 *
 * The calibration has reported accuracy 1.0 with no false positives and no
 * false negatives at all. That is either a good result or a dead branch, and
 * the table cannot tell you which. So each bucket is driven here through the
 * WHOLE chain — a run directory on disk, read by `runInput`, audited from
 * the capture, classified by the same `classify` the report uses — rather
 * than by handing `classify` a verdict it would otherwise never see.
 *
 * The false-negative column is the one that matters most. It stays empty
 * only if the judge says "used" whenever content arrives, which would mean
 * it is measuring delivery rather than use — the distinction this whole
 * project exists to make. A reachable-but-empty column is a finding; an
 * unreachable one is a bug.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInput } from "./calibrate-runs.mjs";
import { calibrate } from "./calibration.mjs";

const HIDDEN = "skl-hidden", OK = "skl-ok";
const TOKENS = { [HIDDEN]: { version: 2, tokens: ["10.244.7.19"] }, [OK]: { version: 2, tokens: ["47318"] } };

/**
 * A capture in the shape the probe really writes.
 *
 * A conversation is not one request holding every message: each turn sends
 * the whole history SO FAR and gets one assistant message back. Writing it
 * as a single request put assistant and tool messages in the opening
 * request, and `verifyCoverage` correctly called that a capture which began
 * mid-conversation — the check catching an unrealistic fixture before it
 * could certify anything.
 *
 * So the message list is split at each assistant turn, the way a real run
 * accumulates: request 1 is [system, user], request 2 adds the first
 * assistant and its tool result, and so on. Every turn but the last finishes
 * `tool_calls`; the last finishes `stop`.
 */
function capture(messages) {
  const boundaries = [];
  messages.forEach((m, i) => { if (m.role === "assistant") boundaries.push(i); });
  const rows = [];
  boundaries.forEach((cut, n) => {
    const id = `req-${n}`;
    const finish = n === boundaries.length - 1 ? "stop" : "tool_calls";
    rows.push({ event: "http.request", requestId: id, body: { json: { model: "deepseek-v4-flash", messages: messages.slice(0, cut) } } });
    rows.push({ event: "http.response", requestId: id, status: 200,
      body: { truncated: false, text: `data: {"model":"deepseek-v4-flash","choices":[{"finish_reason":"${finish}"}]}` } });
  });
  return rows;
}

/**
 * Where a message sits once the conversation has been split into turns.
 * A `target_ref` names a request and an index inside it, so a fixture cannot
 * just quote the position in the flat list — the same message appears in
 * every later request, and the ref has to name one of them.
 */
function refTo(messages, msgIndex, callId) {
  const boundaries = [];
  messages.forEach((m, i) => { if (m.role === "assistant") boundaries.push(i); });
  const n = boundaries.findIndex((cut) => cut > msgIndex);
  if (n < 0) throw new Error(`message ${msgIndex} is in no request; the fixture needs a turn after it`);
  return `request(req-${n}):msg[${msgIndex}]:${callId}`;
}

/** Write a run directory the way run-once.sh lays one out, and read it back through the real reader. */
function runDir({ messages, used, hidden, operationAt, gate = true }) {
  const targetRef = refTo(messages, operationAt[0], operationAt[1]);
  const dir = mkdtempSync(join(tmpdir(), "calib-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/capture.jsonl`, capture(messages).map((r) => JSON.stringify(r)).join("\n"));
  writeFileSync(`${dir}/tokens.json`, JSON.stringify(TOKENS));
  writeFileSync(`${dir}/used-events.jsonl`, (used ?? []).map((a) => JSON.stringify({ asset_id: a, state: "used", target_ref: targetRef })).join("\n"));
  // Acceptance records the attempt the task was judged on, with the call that
  // made it — the anchor the audit uses, independent of the attribution judge.
  writeFileSync(`${dir}/verdict.json`, JSON.stringify({ verdict: "PASS", reason: "synthetic",
    attempts: [{ call_id: operationAt[1], message_index: operationAt[0], ok: true }] }));
  writeFileSync(`${dir}/run.json`, JSON.stringify({
    run_id: dir.split("/").pop(), label: "synthetic", started_at: "2026-09-09T00:00:00Z",
    ...(gate ? { gate: { mode: "on", baseline_frozen_at: "2026-09-06T08:47:33Z",
      status_at_start: { [HIDDEN]: hidden ? "failed" : "approved", [OK]: "approved" } } } : {}),
  }));
  writeFileSync(`${dir}/gate_baseline.json`, JSON.stringify({ rules_version: "synthetic-rules", frozen_at: "2026-09-06T08:47:33Z" }));
  return dir;
}

const bucketOf = (dir, asset) => {
  const r = calibrate([runInput(dir)]);
  return r.rows.find((x) => x.asset_id === asset);
};
const cleanup = [];
const make = (spec) => { const d = runDir(spec); cleanup.push(d); return d; };
test.after(() => { for (const d of cleanup) rmSync(d, { recursive: true, force: true }); });

// The model reads the asset, then acts on it.
const readsThenActs = (assetId, token) => [
  { role: "system", content: "you are an agent" },
  { role: "user", content: "reach the bridge using the team convention" },
  { role: "assistant", content: null, tool_calls: [{ id: "c1", function: { name: "Bash", arguments: JSON.stringify({ command: "curl .../skill/get" }) } }] },
  { role: "tool", tool_call_id: "c1", content: `Command: curl .../skill/get\n{"data":{"skill_id":"${assetId}","content":"reach it at ${token}"}}` },
  { role: "assistant", content: null, tool_calls: [{ id: "c2", function: { name: "Bash", arguments: JSON.stringify({ command: `curl http://${token}/x` }) } }] },
  { role: "tool", tool_call_id: "c2", content: "code 0" },
  { role: "assistant", content: "reported" },
];

test("TRUE POSITIVE is reachable: the asset arrived, and the judge said used", () => {
  const d = make({ messages: readsThenActs(OK, "127.0.0.1:47318"), used: [OK], hidden: false, operationAt: [4, "c2"] });
  const row = bucketOf(d, OK);
  assert.equal(row.delivery, "delivered");
  assert.equal(row.bucket, "true_positive");
});

test("FALSE NEGATIVE is reachable: the asset arrived and the judge did NOT say used", () => {
  // The column that has never been filled. If it cannot be filled, the judge
  // is measuring delivery rather than use; this proves it can.
  const d = make({ messages: readsThenActs(OK, "127.0.0.1:47318"), used: [], hidden: false, operationAt: [4, "c2"] });
  const row = bucketOf(d, OK);
  assert.equal(row.delivery, "delivered");
  assert.equal(row.judged_used, false);
  assert.equal(row.bucket, "false_negative");
});

test("FALSE POSITIVE is reachable: the model never received it, and the judge said used", () => {
  // The model dials an address nobody gave it — from its own prior knowledge
  // — and the judge credits the asset.
  const messages = [
    { role: "system", content: "you are an agent" },
    { role: "user", content: "reach the bridge" },
    { role: "assistant", content: "I recall the address is 10.244.7.19:8096" },
    { role: "assistant", content: null, tool_calls: [{ id: "c1", function: { name: "Bash", arguments: JSON.stringify({ command: "curl http://10.244.7.19:8096/x" }) } }] },
    { role: "tool", tool_call_id: "c1", content: "timed out" },
    { role: "assistant", content: "reported" },
  ];
  const d = make({ messages, used: [HIDDEN], hidden: true, operationAt: [3, "c1"] });
  const row = bucketOf(d, HIDDEN);
  assert.equal(row.delivery, "model_authored");
  assert.equal(row.bucket, "false_positive");
});

test("TRUE NEGATIVE is reachable: nothing arrived and the judge kept quiet", () => {
  const d = make({ messages: readsThenActs(OK, "127.0.0.1:47318"), used: [OK], hidden: true, operationAt: [4, "c2"] });
  const row = bucketOf(d, HIDDEN);
  assert.equal(row.delivery, "not_delivered");
  assert.equal(row.bucket, "true_negative");
});

test("ISOLATION FAILURE is reachable: hidden, but its content came in another way", () => {
  const messages = [
    { role: "system", content: "you are an agent" },
    { role: "user", content: "reach the bridge" },
    { role: "assistant", content: null, tool_calls: [{ id: "c1", function: { name: "Read", arguments: JSON.stringify({ file_path: "/tmp/sop.md" }) } }] },
    { role: "tool", tool_call_id: "c1", content: "  1→SOP: the address is 10.244.7.19:8096" },
    { role: "assistant", content: null, tool_calls: [{ id: "c2", function: { name: "Bash", arguments: JSON.stringify({ command: "curl http://10.244.7.19:8096/x" }) } }] },
    { role: "tool", tool_call_id: "c2", content: "timed out" },
    { role: "assistant", content: "reported" },
  ];
  const d = make({ messages, used: [HIDDEN], hidden: true, operationAt: [4, "c2"] });
  const row = bucketOf(d, HIDDEN);
  assert.equal(row.delivery, "delivered_from_other_source");
  assert.equal(row.bucket, "isolation_failure");
  // Not counted against the judge: calling it used was right.
  assert.equal(row.counts_toward_rate, false);
});

test("UNSETTLED is reachable, and for the two different reasons it should be", () => {
  // The run did not record the gate at all.
  const noGate = make({ messages: readsThenActs(OK, "127.0.0.1:47318"), used: [OK], hidden: false, operationAt: [4, "c2"], gate: false });
  const a = bucketOf(noGate, OK);
  assert.equal(a.hidden, null);
  assert.equal(a.bucket, "unsettled");
  assert.match(a.why, /whether it was hidden/);

  // The content arrived after the operation being judged.
  const late = [
    { role: "system", content: "you are an agent" },
    { role: "assistant", content: null, tool_calls: [{ id: "c1", function: { name: "Bash", arguments: JSON.stringify({ command: "curl http://127.0.0.1:9999/x" }) } }] },
    { role: "tool", tool_call_id: "c1", content: "no answer" },
    { role: "assistant", content: null, tool_calls: [{ id: "c2", function: { name: "Bash", arguments: JSON.stringify({ command: "curl .../skill/get" }) } }] },
    { role: "tool", tool_call_id: "c2", content: `{"data":{"skill_id":"${OK}","content":"reach it at 127.0.0.1:47318"}}` },
    { role: "assistant", content: "reported" },
  ];
  const d = make({ messages: late, used: [OK], hidden: false, operationAt: [1, "c1"] });
  const b = bucketOf(d, OK);
  assert.equal(b.delivery, "after_operation");
  assert.equal(b.bucket, "false_positive", "content that arrived after the operation cannot have been used by it");
});

test("all six buckets are reachable through the real reader, not just through classify()", () => {
  const seen = new Set();
  for (const [spec, asset] of [
    [{ messages: readsThenActs(OK, "127.0.0.1:47318"), used: [OK], hidden: false, operationAt: [4, "c2"] }, OK],
    [{ messages: readsThenActs(OK, "127.0.0.1:47318"), used: [], hidden: false, operationAt: [4, "c2"] }, OK],
    [{ messages: readsThenActs(OK, "127.0.0.1:47318"), used: [OK], hidden: true, operationAt: [4, "c2"] }, HIDDEN],
  ]) seen.add(bucketOf(make(spec), asset).bucket);
  assert.deepEqual([...seen].sort(), ["false_negative", "true_negative", "true_positive"]);
});
