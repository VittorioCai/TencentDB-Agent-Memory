import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBaseline, collectRun, renderBaseline } from "./build-baseline.mjs";
import { planVisibility } from "./plan-visibility.mjs";
import { validate, loadSchema } from "../contracts/validate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNS = join(HERE, "..", "runner", "runs");
const RUN3 = join(RUNS, "20260905T220020Z-gate-off");
const RUN4 = join(RUNS, "20260905T223401Z-gate-off");
const GATE_SCHEMA = loadSchema(join(HERE, "..", "contracts", "gate-decision.schema.json"));
const EVENT_SCHEMA = loadSchema(join(HERE, "..", "contracts", "provenance-event.schema.json"));

const WRONG = "skl-sZFb3KatWY6m", RIGHT = "skl-oBaDO5CceKnr";
const TOKENS = { [WRONG]: { version: 2, tokens: ["10.244.7.19"] }, [RIGHT]: { version: 2, tokens: ["47318"] } };

const haveRuns = existsSync(join(RUN3, "used-events.jsonl")) && existsSync(join(RUN4, "used-events.jsonl"));

test("collectRun computes outcomes when a run has none on disk, and says so", { skip: !haveRuns }, () => {
  const r = collectRun(RUN3, { tokensByAsset: TOKENS });
  assert.equal(r.run_id, "20260905T220020Z-gate-off");
  assert.equal(r.verdict, "PASS");
  const states = r.events.map((e) => e.state);
  assert.ok(states.includes("fetched") && states.includes("used"));
  assert.ok(states.includes("corrected") && states.includes("validated"));
  if (!existsSync(join(RUN3, "outcome-events.jsonl"))) assert.match(r.outcome_source, /computed here/);
});

test("baseline from runs 3 and 4: wrong rejected, right admitted, events deduplicated and contract-valid", { skip: !haveRuns }, () => {
  const runs = [collectRun(RUN3, { tokensByAsset: TOKENS }), collectRun(RUN4, { tokensByAsset: TOKENS })];
  const snapshot = JSON.parse(readFileSync(join(RUN4, "asset-pool-snapshot.json"), "utf8"));
  const b = buildBaseline({ runs, snapshot, tokensByAsset: TOKENS, now: "2026-09-06T01:00:00Z" });

  assert.equal(b.schema_version, "gate-baseline-v1");
  assert.equal(b.frozen_at, "2026-09-06T01:00:00Z");
  assert.equal(b.source_runs.length, 2);
  assert.equal(b.event_count, new Set(b.events.map((e) => e.event_id)).size);
  assert.equal(b.event_count, runs.flatMap((r) => r.events).length, "runs 3 and 4 are different sessions; no event should collapse");
  assert.equal(b.by_state.corrected, 2);
  assert.equal(b.by_state.validated, 2);

  const by = Object.fromEntries(b.decisions.map((d) => [d.asset_id, d]));
  assert.equal(by[WRONG].decision, "reject");
  assert.equal(by[RIGHT].decision, "admit");
  assert.equal(by[RIGHT].signals.online.cross_user_validated, 2);
  assert.equal(by[WRONG].signals.online.corrected, 2);
  for (const d of b.decisions) assert.deepEqual(validate(GATE_SCHEMA, d), []);
  for (const e of b.events) assert.deepEqual(validate(EVENT_SCHEMA, e), []);

  // Baseline visibility: contract value when not read, with the source stated.
  assert.equal(b.assets[WRONG].baseline_visibility, "team");
  assert.match(b.assets[WRONG].visibility_source, /not read/);

  // And the plan that apply.sh would execute from it, both arms.
  const current = { [WRONG]: "team", [RIGHT]: "team" };
  const on = planVisibility({ mode: "apply", baseline: b, current });
  assert.deepEqual(on.changes.map((c) => [c.asset_id, c.to]), [[WRONG, "private"]]);
  const off = planVisibility({ mode: "reset", baseline: b, current });
  assert.deepEqual(off.changes, []);

  const text = renderBaseline(b);
  assert.match(text, /2 preparation run\(s\)/);
  assert.match(text, /REJECT.*eval-bridge-endpoint-a/);
});

test("live visibility, when supplied, is recorded as read", () => {
  const snapshot = { pool_snapshot_at: "x", team_id: "t", assets: [{ asset_id: RIGHT, name: "b", version: 2, producer_user_id: "u", producer_agent_id: "a" }] };
  const b = buildBaseline({ runs: [], snapshot, visibility: { [RIGHT]: "team" }, now: "2026-09-06T01:00:00Z" });
  assert.match(b.assets[RIGHT].visibility_source, /read from/);
  assert.equal(b.decisions[0].decision, "pending");
  assert.equal(b.event_count, 0);
});
