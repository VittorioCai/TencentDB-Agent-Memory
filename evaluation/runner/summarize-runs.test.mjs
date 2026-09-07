import { test } from "node:test";
import assert from "node:assert/strict";

import { summarizeRuns, renderRuns } from "./summarize-runs.mjs";

const run = (label, verdict, run_id) => ({ label, verdict, run_id });

test("an unjudgeable run stays in the denominator", () => {
  // Six runs, four broken, two passed. Over judged runs alone that reads 100%.
  const s = summarizeRuns([
    run("gate-off", "PASS", "r1"), run("gate-off", "PASS", "r2"),
    run("gate-off", "ERROR", "r3"), run("gate-off", "ERROR", "r4"),
    run("gate-off", "ERROR", "r5"), run("gate-off", "ERROR", "r6"),
  ]);
  const g = s.groups[0];
  assert.equal(g.started, 6);
  assert.equal(g.pass_rate, 2 / 6);
  assert.equal(g.pass_rate_of_judged, 1);
  assert.match(renderRuns(s), /4 of 6 could not be judged/);
});

test("both numbers are printed, so the gap is visible", () => {
  const out = renderRuns(summarizeRuns([run("x", "PASS", "r1"), run("x", "ERROR", "r2")]));
  assert.match(out, /50%/);
  assert.match(out, /it would read 100%/);
});

test("unjudgeable runs are named, not just counted", () => {
  const out = renderRuns(summarizeRuns([run("x", "PASS", "r1"), run("x", "ERROR", "broken-run")]));
  assert.match(out, /broken-run/);
});

test("no runs is not a result of zero", () => {
  assert.match(renderRuns(summarizeRuns([])), /nothing has been measured/);
});

test("labels are grouped so gate-on and gate-off stay comparable", () => {
  const s = summarizeRuns([
    run("gate-off", "FAIL", "a"), run("gate-off", "FAIL", "b"),
    run("gate-on", "PASS", "c"),
  ]);
  assert.deepEqual(s.groups.map((g) => [g.label, g.pass, g.fail]), [["gate-off", 0, 2], ["gate-on", 1, 0]]);
});

// ── where the gate shows ────────────────────────────────────────
import { runFacts, loadRun } from "./summarize-runs.mjs";

const WRONG = "skl-wrong";
const attempt = (host, ok, why) => ({ host, port: "1", ok, why });
const richRun = (label, run_id, { first, seen, corrected, wall, started_at }) => ({
  label, run_id, verdict: "PASS", started_at,
  verdict_doc: { verdict: "PASS", attempts: first === "wrong" ? [attempt("10.0.0.1", false, "timed out"), attempt("127.0.0.1", true, "code 0")] : [attempt("127.0.0.1", true, "code 0")] },
  events: [
    ...(seen ? [{ asset_id: WRONG, state: "recalled" }, { asset_id: WRONG, state: "fetched" }] : []),
    { asset_id: "skl-right", state: "fetched" },
    ...(corrected ? [{ asset_id: WRONG, state: "corrected" }] : []),
    { asset_id: "skl-right", state: "validated" },
  ],
  cost: { wall_seconds: wall },
});
const BASELINE = { frozen_at: "2026-09-06T08:47:33Z", source_runs: [{ run_id: "prep-1" }], decisions: [{ asset_id: WRONG, decision: "reject" }] };

test("runFacts: null for every field when the run has no extras", () => {
  const f = runFacts(run("x", "PASS", "r"));
  assert.deepEqual(f, { first_dial_failed: null, first_batch_size: null, first_batch_all_ok: null, first_batch_any_failed: null, failed_attempts: null, attempts: null, rejected_seen: null, corrected: null, validated: null, wall_seconds: null, prompt_tokens: null, total_tokens: null, cached_tokens: null, profile_memory_present: null, l3_watch_hits: null, non_pool_skill_read: null });
});

test("the gate shows in seen / first-dial / corrected, while the pass rate is identical", () => {
  const runs = [
    richRun("gate-off", "o1", { first: "wrong", seen: true, corrected: true, wall: 50, started_at: "2026-09-06T09:00:00Z" }),
    richRun("gate-off", "o2", { first: "wrong", seen: true, corrected: true, wall: 48, started_at: "2026-09-06T09:10:00Z" }),
    richRun("gate-on", "n1", { first: "right", seen: false, corrected: false, wall: 24, started_at: "2026-09-06T11:00:00Z" }),
    richRun("gate-on", "n2", { first: "right", seen: false, corrected: false, wall: 28, started_at: "2026-09-06T11:10:00Z" }),
  ];
  const s = summarizeRuns(runs, { baseline: BASELINE });
  const off = s.groups.find((g) => g.label === "gate-off"), on = s.groups.find((g) => g.label === "gate-on");
  assert.equal(off.pass_rate, 1); assert.equal(on.pass_rate, 1);
  assert.deepEqual(off.rejected_seen, { n: 2, of: 2 }); assert.deepEqual(on.rejected_seen, { n: 0, of: 2 });
  assert.deepEqual(off.first_dial_failed, { n: 2, of: 2 }); assert.deepEqual(on.first_dial_failed, { n: 0, of: 2 });
  assert.equal(off.corrected, 2); assert.equal(on.corrected, 0);
  assert.equal(off.failed_attempts, 2); assert.equal(on.failed_attempts, 0);
  assert.equal(off.wall_seconds_mean, 49); assert.equal(on.wall_seconds_mean, 26);
  const text = renderRuns(s);
  assert.match(text, /Where the gate shows/);
  assert.match(text, /\| gate-off \| 2\/2 \| 0\/2 \| 2\/2 \| 2 \| 2 \| 2 \| 49 \|/);
  assert.match(text, /\| gate-on \| 0\/2 \| 2\/2 \| 0\/2 \| 0 \| 0 \| 2 \| 26 \|/);
});

test("evidence-base and pre-baseline runs are grouped apart from the comparison", () => {
  const runs = [
    { label: "gate-off", run_id: "prep-1", verdict: "PASS", started_at: "2026-09-05T22:00:00Z" },
    { label: "gate-off", run_id: "old-error", verdict: "ERROR", started_at: "2026-09-05T15:35:00Z" },
    richRun("gate-off", "o1", { first: "wrong", seen: true, corrected: true, wall: 50, started_at: "2026-09-06T09:00:00Z" }),
  ];
  const s = summarizeRuns(runs, { baseline: BASELINE });
  assert.deepEqual(s.groups.map((g) => [g.label, g.started]).sort(), [["gate-off", 1], ["gate-off (evidence base)", 1], ["gate-off (pre-baseline)", 1]].sort());
  assert.match(renderRuns(s), /Neither is part of the comparison/);
});

test("without a baseline nothing is regrouped and the old table is unchanged", () => {
  const s = summarizeRuns([run("gate-off", "PASS", "a"), run("gate-on", "PASS", "b")]);
  assert.deepEqual(s.groups.map((g) => g.label), ["gate-off", "gate-on"]);
  assert.ok(!/Where the gate shows/.test(renderRuns(s)));
});

test("loadRun returns null for a directory without run.json", () => {
  assert.equal(loadRun("/nonexistent/dir"), null);
});

test("token columns: means over runs that carried usage, dash when none did", () => {
  const withTok = (id, label, p, t) => ({ ...richRun(label, id, { first: "right", seen: false, corrected: false, wall: 30, started_at: "2026-09-06T11:00:00Z" }), cost: { wall_seconds: 30, prompt_tokens: p, total_tokens: t, cached_tokens: 0 } });
  const s = summarizeRuns([withTok("a", "gate-on", 100000, 104000), withTok("b", "gate-on", 120000, 125000), { ...richRun("gate-off", "c", { first: "wrong", seen: true, corrected: true, wall: 50, started_at: "2026-09-06T09:00:00Z" }), cost: { wall_seconds: 50 } }], { baseline: BASELINE });
  const on = s.groups.find((g) => g.label === "gate-on"), off = s.groups.find((g) => g.label === "gate-off");
  assert.equal(on.prompt_tokens_mean, 110000);
  assert.equal(on.total_tokens_mean, 114500);
  assert.equal(off.prompt_tokens_mean, null);
  const text = renderRuns(s);
  assert.match(text, /\| gate-on \| 0\/2 \| 2\/2 \| 0\/2 \| 0 \| 0 \| 2 \| 30 \| 110\.0k \| 114\.5k \|/);
  assert.match(text, /\| gate-off \| 1\/1 \| 0\/1 \| 1\/1 \| 1 \| 1 \| 1 \| 50 \| — \| — \|/);
});

test("first batch: calls issued in the same message count together; a later retry is not the first batch", () => {
  const sameMessage = { verdict: "PASS", attempts: [
    { host: "10.0.0.1", port: "1", ok: false, why: "timed out", message_index: 8 },
    { host: "127.0.0.1", port: "2", ok: true, why: "code 0", message_index: 8 },
  ] };
  const f = runFacts({ verdict_doc: sameMessage });
  assert.equal(f.first_batch_size, 2);
  assert.equal(f.first_batch_all_ok, false);
  assert.equal(f.first_batch_any_failed, true);
  const retry = { verdict: "PASS", attempts: [
    { host: "127.0.0.1", port: "2", ok: true, why: "code 0", message_index: 5 },
    { host: "10.0.0.1", port: "1", ok: false, why: "timed out", message_index: 9 },
  ] };
  const g = runFacts({ verdict_doc: retry });
  assert.equal(g.first_batch_size, 1);
  assert.equal(g.first_batch_all_ok, true);
  assert.equal(g.failed_attempts, 1);
  const text = renderRuns(summarizeRuns([{ label: "x", run_id: "r", verdict: "PASS", verdict_doc: sameMessage }]));
  assert.match(text, /issued in the same model message/);
});
