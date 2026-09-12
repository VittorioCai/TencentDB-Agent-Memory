/**
 * What a re-judge changed, run by run.
 *
 *   node evaluation/attribution/rejudge-diff.mjs --before=<runs root> --after=<rejudged root> --manifest=<batchN-runs.json> [--extra=<run_id,…>]
 *
 * Reads verdict.json and outcome-events.jsonl from both roots for the runs the
 * manifest names (plus --extra ids, listed apart) and prints a Markdown table:
 * verdict, attempts (address=outcome, in order) and outcome states per asset,
 * before and after, with a changed mark. Generated, never hand-edited.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (n) => (args.find((a) => a.startsWith(`--${n}=`)) ?? "").slice(n.length + 3) || null;
// Only parsed when run as a script — importing this module (the title test does) must
// not hit the usage error and exit.
const RUN_AS_SCRIPT = import.meta.url === `file://${process.argv[1]}`;
let before = null, after = null, manifestPath = null, manifest = null, formal = [], extra = [];
if (RUN_AS_SCRIPT) {
  before = opt("before"); after = opt("after"); manifestPath = opt("manifest");
  if (!before || !after || !manifestPath) { console.error("usage: rejudge-diff.mjs --before=<dir> --after=<dir> --manifest=<file> [--extra=<ids>]"); process.exit(2); }
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  formal = (manifest.runs ?? []).map((r) => r.run_id ?? r);
  extra = (opt("extra") ?? "").split(",").filter(Boolean);
}

const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
const readJsonl = (p) => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const short = (id) => String(id).slice(-6);

function view(root, id) {
  const v = readJson(join(root, id, "verdict.json"));
  const ev = readJsonl(join(root, id, "outcome-events.jsonl"));
  const attempts = (v?.attempts ?? []).map((a) => `${a.host}:${a.port}=${a.ok === true ? "ok" : a.ok === false ? a.why : "?"}`);
  const outcomes = {};
  for (const e of ev) (outcomes[short(e.asset_id)] ??= []).push(e.state);
  return {
    verdict: v?.verdict ?? "—",
    version: v?.acceptance_version ?? "attempts-v1",
    attempts,
    outcomes: Object.entries(outcomes).sort().map(([k, s]) => `${k}:${s.join("+")}`).join(" "),
    problems: v?.problems?.length ?? 0,
  };
}

function table(ids, title) {
  const L = [`### ${title}`, "", "| run | verdict before → after | attempts before | attempts after | outcomes before | outcomes after | changed |", "|---|---|---|---|---|---|---|"];
  let changed = 0;
  const tally = { before: {}, after: {} };
  for (const id of ids) {
    const b = view(before, id), a = view(after, id);
    tally.before[b.verdict] = (tally.before[b.verdict] ?? 0) + 1;
    tally.after[a.verdict] = (tally.after[a.verdict] ?? 0) + 1;
    const diff = b.verdict !== a.verdict || b.attempts.join() !== a.attempts.join() || b.outcomes !== a.outcomes;
    if (diff) changed++;
    L.push(`| ${id} | ${b.verdict} → ${a.verdict} | ${b.attempts.join("; ") || "—"} | ${a.attempts.join("; ") || "—"}${a.problems ? ` (+${a.problems} unidentified)` : ""} | ${b.outcomes || "—"} | ${a.outcomes || "—"} | ${diff ? "**yes**" : "no"} |`);
  }
  const fmt = (t) => Object.entries(t).sort().map(([k, n]) => `${k} ${n}`).join(", ");
  L.push("", `${ids.length} runs, ${changed} changed. Verdicts before: ${fmt(tally.before)}; after: ${fmt(tally.after)}.`, "");
  return L.join("\n");
}

/**
 * The date in the title comes from the re-judge copy's directory name, not from the
 * clock. Stamping `new Date()` made the report differ from its committed copy on every
 * later day — a permanent 4-line `REPARSE-DIFF.diff` in each delivery archive, against a
 * delivery that claims generated reports match their committed copies. Same copy in,
 * same title out; a path with no date in it gets no date rather than an invented one.
 */
export const titleDate = (dir) => (String(dir ?? "").match(/(\d{4}-\d{2}-\d{2})/) ?? [])[1] ?? null;

if (RUN_AS_SCRIPT) {
const versions = new Set(formal.map((id) => view(after, id).version));
const stamp = titleDate(after);
console.log(`# Re-judge diff${stamp ? ` — ${stamp}` : ""}`, "");
console.log(`Before: \`${before}\` (records as written at run time). After: \`${after}\` (copies re-judged by rejudge-runs.mjs; acceptance ${[...versions].join(", ")}). Formal sample: the ${formal.length} run ids in \`${manifestPath}\`.`, "");
console.log(table(formal, "Formal sample (the manifest)"));
if (extra.length) console.log(table(extra, "Not samples: preparation and trial runs"));
}
