/**
 * What the exit-line fix in collect-artifacts.mjs changes on the recorded
 * runs, measured rather than asserted (the second dev-loop task's fix applied
 * to the main branch, 2026-09-11).
 *
 * For every tool result in each run's capture, the exit status is read with
 * the OLD `outcomeOf` (the file as it was before the fix, passed in with
 * --old) and with the current one, and the two readings are counted: results
 * that carry an exit line at all, how many of those read `null` before, how
 * many after, and how many results changed reading. The used-event judge
 * (`judge-hard.mjs`) reads `op.text` — the whole result — and never
 * `exit_code` or `stderr`, so the used events of these runs cannot move; the
 * table below is what did move, and the markdown is generated, not typed.
 *
 *   node evaluation/attribution/reparse-exit-status.mjs --old=<old collect-artifacts.mjs> \
 *        [--old-label=<commit>] [--md=<out.md>] <run dir…>
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const opt = (n) => (args.find((a) => a.startsWith(`--${n}=`)) ?? "").slice(n.length + 3) || null;
const runDirs = args.filter((a) => !a.startsWith("--"));
if (!opt("old") || !runDirs.length) { console.error("usage: reparse-exit-status.mjs --old=<old collect-artifacts.mjs> [--old-label=L] [--md=F] <run dir…>"); process.exit(2); }
const OLD = await import(pathToFileURL(resolve(opt("old"))).href);
const NEW = await import(new URL("./collect-artifacts.mjs", import.meta.url).href);

const text = (c) => (typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (typeof b === "string" ? b : b?.text ?? "")).join("\n") : c == null ? "" : JSON.stringify(c));
/** Every tool result the model saw, once per tool_call_id, from the last request of the capture. */
function toolResults(captureFile) {
  const rows = readFileSync(captureFile, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const reqs = rows.filter((e) => e?.event === "http.request" && Array.isArray(e?.body?.json?.messages));
  const msgs = reqs[reqs.length - 1]?.body?.json?.messages ?? [];
  const seen = new Map();
  for (const m of msgs) {
    if (m?.role === "tool" && !seen.has(m.tool_call_id)) seen.set(m.tool_call_id, text(m.content));
    if (Array.isArray(m?.content)) for (const b of m.content) if (b?.type === "tool_result" && !seen.has(b.tool_use_id)) seen.set(b.tool_use_id, text(b.content));
  }
  return [...seen.values()];
}

const rows = [];
for (const d of runDirs) {
  const cap = join(d, "capture.jsonl");
  if (!existsSync(cap)) { rows.push({ run: basename(d), error: "no capture.jsonl" }); continue; }
  const results = toolResults(cap);
  let withExitLine = 0, nullBefore = 0, nullAfter = 0, changed = 0, spelledCapital = 0;
  for (const r of results) {
    const hasLine = /(?:^|\n)Exit [Cc]ode:\s*-?\d+/.test(r);
    if (!hasLine) continue;
    withExitLine += 1;
    if (/(?:^|\n)Exit Code:/.test(r)) spelledCapital += 1;
    const before = OLD.outcomeOf(r).exit_code, after = NEW.outcomeOf(r).exit_code;
    if (before === null) nullBefore += 1;
    if (after === null) nullAfter += 1;
    if (before !== after) changed += 1;
  }
  rows.push({ run: basename(d), results: results.length, with_exit_line: withExitLine, spelled_capital: spelledCapital, null_before: nullBefore, null_after: nullAfter, changed });
}
const tot = (k) => rows.reduce((s, r) => s + (r[k] ?? 0), 0);
const L = [];
L.push(`# Re-parse of exit status — collect-artifacts.mjs exit-line fix on the main branch (${new Date().toISOString().replace(/\.\d+Z$/, "Z")})`);
L.push(``);
L.push(`Generated: \`node evaluation/attribution/reparse-exit-status.mjs --old=${opt("old-label") ?? opt("old")} <${runDirs.length} run dir(s)>\`. Old reader: \`outcomeOf\` as it was before the fix (${opt("old-label") ?? "file given with --old"}); new reader: the current \`evaluation/attribution/collect-artifacts.mjs\`. Tool results are taken once per tool call from each capture's last request.`);
L.push(``);
L.push(`| run | tool results | with an exit line | spelled \`Exit Code:\` | exit_code null before | null after | readings changed |`);
L.push(`|---|---|---|---|---|---|---|`);
for (const r of rows) L.push(r.error ? `| ${r.run} | ${r.error} | | | | | |` : `| ${r.run} | ${r.results} | ${r.with_exit_line} | ${r.spelled_capital} | ${r.null_before} | ${r.null_after} | ${r.changed} |`);
L.push(`| **total** | ${tot("results")} | ${tot("with_exit_line")} | ${tot("spelled_capital")} | ${tot("null_before")} | ${tot("null_after")} | ${tot("changed")} |`);
L.push(``);
L.push(`Across ${rows.length} run(s): ${tot("with_exit_line")} tool result(s) carry an exit line, ${tot("spelled_capital")} of them spelled \`Exit Code:\`; the old reader returned null for ${tot("null_before")} of them, the new one for ${tot("null_after")}; ${tot("changed")} reading(s) changed.`);
L.push(``);
L.push(`What cannot have moved: \`judge-hard.mjs\` decides used events from \`op.text\` (the whole result) and never reads \`exit_code\` or \`stderr\` (see its token checks); so the used events, outcomes and verdicts of these runs are unaffected by this fix, and no re-judge of them is claimed here. What did move is the operations list each run's record would now carry: an exit status per shell result instead of null.`);
L.push(``);
const md = L.join("\n");
if (opt("md")) writeFileSync(opt("md"), md);
console.log(md);
