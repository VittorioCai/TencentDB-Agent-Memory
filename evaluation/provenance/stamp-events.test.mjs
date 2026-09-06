import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stampEvents, stampFile } from "./stamp-events.mjs";

test("fills only null run_id / task_id, never overwrites what an event recorded", () => {
  const { events, stamped } = stampEvents([
    { event_id: "a", run_id: null, task_id: null },
    { event_id: "b", run_id: "run-old", task_id: "task-old" },
    { event_id: "c", run_id: null, task_id: "task-c" },
  ], { runId: "run-new", taskId: "task-new" });
  assert.deepEqual(events.map((e) => [e.run_id, e.task_id]), [["run-new", "task-new"], ["run-old", "task-old"], ["run-new", "task-c"]]);
  assert.equal(stamped, 2);
});

test("a missing id stamps nothing for that field", () => {
  const { events } = stampEvents([{ run_id: null, task_id: null }], { runId: "r" });
  assert.equal(events[0].task_id, null);
  assert.equal(events[0].run_id, "r");
});

test("stampFile rewrites a JSONL file in place and reports counts; missing file is reported, not created", () => {
  const dir = mkdtempSync(join(tmpdir(), "stamp-"));
  const p = join(dir, "events.jsonl");
  writeFileSync(p, JSON.stringify({ run_id: null, task_id: null }) + "\n" + JSON.stringify({ run_id: "x", task_id: "y" }) + "\n");
  const r = stampFile(p, { runId: "R", taskId: "T" });
  assert.deepEqual(r, { stamped: 1, total: 2, missing: false });
  const back = readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(back[0].run_id, "R"); assert.equal(back[1].run_id, "x");
  assert.equal(stampFile(join(dir, "nope.jsonl"), { runId: "R" }).missing, true);
});
