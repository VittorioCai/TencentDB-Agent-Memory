/**
 * Stamp run_id and task_id onto provenance events that carry neither.
 *
 * The event builders work from a capture and service rows, which know the
 * session but not the run the runner assigned to it or the task the proxy
 * resolved it to. Those are known only to the runner, so it stamps them after
 * the fact. Only null fields are filled: an event that already names a run or
 * task is never overwritten, because a stamp that disagreed with what the
 * event recorded would be the kind of silent rewrite the whole chain exists
 * to prevent.
 *
 * Why it matters: the gate counts generalisation as distinct task ids on
 * validated events. Without the stamp every asset reads 0 distinct tasks —
 * a missing signal that looks like a measured zero.
 *
 * Usage:
 *   node evaluation/provenance/stamp-events.mjs <events.jsonl ...> --run-id=ID [--task-id=ID]
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";

export function stampEvents(events, { runId = null, taskId = null } = {}) {
  let stamped = 0;
  const out = events.map((e) => {
    const next = { ...e };
    let touched = false;
    if (runId && (next.run_id === null || next.run_id === undefined)) { next.run_id = runId; touched = true; }
    if (taskId && (next.task_id === null || next.task_id === undefined)) { next.task_id = taskId; touched = true; }
    if (touched) stamped += 1;
    return next;
  });
  return { events: out, stamped };
}

export function stampFile(path, opts) {
  if (!existsSync(path)) return { stamped: 0, total: 0, missing: true };
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim());
  const events = lines.map((l) => JSON.parse(l));
  const { events: out, stamped } = stampEvents(events, opts);
  writeFileSync(path, out.map((e) => JSON.stringify(e)).join("\n") + (out.length ? "\n" : ""));
  return { stamped, total: out.length, missing: false };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const files = args.filter((a) => !a.startsWith("--"));
  const arg = (n) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
  const runId = arg("run-id"), taskId = arg("task-id");
  if (files.length === 0 || (!runId && !taskId)) {
    console.error("usage: node stamp-events.mjs <events.jsonl ...> --run-id=ID [--task-id=ID]");
    process.exit(2);
  }
  for (const f of files) {
    const r = stampFile(f, { runId, taskId });
    console.log(r.missing ? `${f}: missing` : `${f}: stamped ${r.stamped} of ${r.total}`);
  }
}
