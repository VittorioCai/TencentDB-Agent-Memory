import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gainsOf, contributedEvents, runGainFacts } from "./contributed.mjs";
import { validate, loadSchema } from "../contracts/validate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = loadSchema(join(HERE, "..", "contracts", "provenance-event.schema.json"));
const RIGHT = "skl-right", WRONG = "skl-wrong";
const TOKENS = { [RIGHT]: { version: 2, tokens: ["47318"] }, [WRONG]: { version: 2, tokens: ["10.244.7.19"] } };

/** Write a synthetic run directory in the shape the runner leaves. */
function writeRun(root, id, { visible, passed, attempts, wall, prompt, validated = [], acted = [] }) {
  const dir = join(root, id); mkdirSync(dir, { recursive: true });
  const w = (n, v) => writeFileSync(join(dir, n), typeof v === "string" ? v : JSON.stringify(v));
  w("run.json", { run_id: id, label: "x", verdict: passed ? "PASS" : "FAIL", started_at: "2026-09-06T10:00:00Z", gate: { visibility_at_start: visible } });
  w("verdict.json", { verdict: passed ? "PASS" : "FAIL", attempts });
  w("cost.json", { wall_seconds: wall, prompt_tokens: prompt });
  w("tokens.json", TOKENS);
  w("run-artifacts.json", [{ operations: acted.map((t) => ({ kind: "tool_call", text: `curl http://x:${t}/` })) }]);
  w("used-events.jsonl", validated.map((a) => JSON.stringify({ state: "used", asset_id: a })).join("\n") + (validated.length ? "\n" : ""));
  w("outcome-events.jsonl", validated.map((a) => JSON.stringify({
    event_id: `evt-val-${a}-${id}`, state: "validated", asset_id: a, asset_version: 2, asset_type: "skill", asset_name: a,
    asset_created_at: "c", pool_snapshot_at: "p", producer_user_id: "usr-a", producer_agent_id: "agt-a", actor_user_id: "usr-b", actor_agent_id: "agt-b",
    relation: "cross_user", observation: "bridge+wire", run_id: id, task_id: "task-1", proof_refs: [{ kind: "verify_result", ref: `${id}:verify` }],
  })).join("\n") + (validated.length ? "\n" : ""));
}

function scenario({ absentPass = false, omitValidated = false, absentActs = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "contrib-"));
  const both = { [RIGHT]: "team", [WRONG]: "team" }, noRight = { [RIGHT]: "private", [WRONG]: "team" };
  const okAttempt = { host: "127.0.0.1", port: "47318", ok: true, why: "code 0", message_index: 7 };
  const badAttempt = { host: "10.244.7.19", port: "8096", ok: false, why: "timed out", message_index: 7 };
  for (let i = 0; i < 3; i++) writeRun(root, `p${i}`, { visible: both, passed: true, attempts: [badAttempt, okAttempt], wall: 50, prompt: 130000, validated: omitValidated ? [] : [RIGHT], acted: ["47318", "8096"] });
  // When the absent runs pass, they pass through an address that carries no asset token (the
  // system prompt's own port) — otherwise the calibration rightly reads a leak, which is a
  // different case from "no gain".
  const altAttempt = { host: "127.0.0.1", port: "8096", ok: true, why: "code 0", message_index: 7 };
  for (let i = 0; i < 3; i++) writeRun(root, `a${i}`, { visible: noRight, passed: absentPass, attempts: absentPass ? [altAttempt] : [badAttempt], wall: absentPass ? 30 : 55, prompt: absentPass ? 120000 : 145000, validated: [], acted: absentActs ? ["47318"] : ["8096"] });
  return root;
}

test("gainsOf keeps raw values on both sides and judges direction per metric", () => {
  const g = gainsOf([{ passed: 1, failed_attempts: 0, wall_seconds: 30, prompt_tokens: 100 }], [{ passed: 0, failed_attempts: 1, wall_seconds: 50, prompt_tokens: 120 }]);
  assert.deepEqual(g.pass_rate, { present: 1, absent: 0, gain: true });
  assert.deepEqual(g.wall_seconds_mean, { present: 30, absent: 50, gain: true });
  const worse = gainsOf([{ passed: 1, failed_attempts: 2, wall_seconds: 60, prompt_tokens: null }], [{ passed: 1, failed_attempts: 0, wall_seconds: 40, prompt_tokens: null }]);
  assert.equal(worse.pass_rate.gain, null); // equal
  assert.equal(worse.failed_attempts_mean.gain, false);
  assert.equal(worse.prompt_tokens_mean.gain, null); // unmeasured
});

test("the mainline shape yields one contributed event for the right asset, none for the wrong one, and it passes the contract", () => {
  const root = scenario();
  const { events, rows } = contributedEvents({ runsDir: root, tokensByAsset: TOKENS, rulesCommit: "abc1234", batchDate: "2026-09-06", now: "2026-09-06T20:00:00Z" });
  assert.equal(events.length, 1);
  const e = events[0];
  assert.equal(e.asset_id, RIGHT); assert.equal(e.state, "contributed"); assert.equal(e.asset_version, 2);
  assert.deepEqual(validate(SCHEMA, e), []);
  assert.equal(e.metadata.contrast_batch.id, `loo-${RIGHT}-2026-09-06`);
  assert.equal(e.metadata.contrast_batch.rules_commit, "abc1234");
  assert.deepEqual(e.metadata.present_runs.sort(), ["p0", "p1", "p2"]);
  assert.deepEqual(e.metadata.absent_runs.sort(), ["a0", "a1", "a2"]);
  assert.equal(e.metadata.gains.pass_rate.present, 1); assert.equal(e.metadata.gains.pass_rate.absent, 0);
  assert.ok(e.parent_event_ids.length === 3);
  assert.equal(e.proof_refs[0].kind, "contrast_batch");
  // The wrong asset was never hidden in this scenario, so its first failing condition is the missing contrast.
  const wrong = rows.find((r) => r.asset_id === WRONG);
  assert.match(wrong.why, /no run with this asset hidden/);
});

test("condition 1: without a validated event there is no contributed, however good the contrast", () => {
  const { events, rows } = contributedEvents({ runsDir: scenario({ omitValidated: true }), tokensByAsset: TOKENS, now: "t" });
  assert.equal(events.length, 0);
  assert.match(rows.find((r) => r.asset_id === RIGHT).why, /no validated event/);
});

test("condition 2: without hidden runs of the asset itself there is no contrast", () => {
  const root = mkdtempSync(join(tmpdir(), "contrib-"));
  writeRun(root, "p0", { visible: { [RIGHT]: "team", [WRONG]: "team" }, passed: true, attempts: [], wall: 1, prompt: 1, validated: [RIGHT], acted: ["47318"] });
  const { events, rows } = contributedEvents({ runsDir: root, tokensByAsset: TOKENS, now: "t" });
  assert.equal(events.length, 0);
  assert.match(rows.find((r) => r.asset_id === RIGHT).why, /no run with this asset hidden/);
});

test("condition 3: no positive gain metric → not contributed; a leak → not contributed", () => {
  const same = contributedEvents({ runsDir: scenario({ absentPass: true }), tokensByAsset: TOKENS, now: "t" });
  assert.equal(same.events.length, 0);
  assert.match(same.rows.find((r) => r.asset_id === RIGHT).why, /no gain metric is positive/);
  const leak = contributedEvents({ runsDir: scenario({ absentActs: true }), tokensByAsset: TOKENS, now: "t" });
  assert.equal(leak.events.length, 0);
  assert.match(leak.rows.find((r) => r.asset_id === RIGHT).why, /status is "leak"/);
});

test("runGainFacts reads a run directory; null for a non-run", () => {
  const root = scenario();
  const f = runGainFacts(join(root, "p0"));
  assert.equal(f.passed, 1); assert.equal(f.failed_attempts, 1); assert.equal(f.validated.length, 1);
  assert.equal(runGainFacts("/nonexistent"), null);
});
