/**
 * Re-judge recorded runs under the current acceptance and outcome code,
 * without touching the records.
 *
 *   node evaluation/attribution/rejudge-runs.mjs --out=<dir> [--task=<task dir>] [--key=<author key>] <run dir>…
 *
 * For each run the whole directory is copied to <out>/<run_id>/, then the
 * acceptance (verify.mjs, with the run's service log and reachability probe as
 * evidence) and the outcome judge (judge-outcome.mjs) are run again in the
 * copy. The copy keeps the originals beside the new files
 * (verdict.before-rejudge.json, outcome-events.before-rejudge.jsonl) and a
 * REJUDGED.json naming the code that produced it. `runs/` is never written.
 *
 * Why a copy and not an in-place re-run: the raw record of a batch is what it
 * was when the batch ran (CLAUDE.md, 数据与历史); a re-analysis is a new file
 * that names its code, its rules and its data range. The reports
 * (calibrate-runs, summarize-runs) then read the copies.
 *
 * Receipts are not rebuilt here: a receipt was issued to the run's consumer at
 * run time and stays as issued.
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

const REPO = resolve(new URL("../..", import.meta.url).pathname);
const sha12 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 12);

function run(cmd, args, { stdoutTo = null, stderrTo = null } = {}) {
  const r = spawnSync(cmd, args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (stdoutTo) writeFileSync(stdoutTo, r.stdout ?? "");
  if (stderrTo) writeFileSync(stderrTo, r.stderr ?? "");
  return r;
}

export function rejudgeRun(runDir, { outRoot, taskDir, tokensPlain }) {
  const src = resolve(REPO, runDir);
  const id = basename(src);
  const dest = join(outRoot, id);
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  const notes = { run_id: id, source: src, rejudged_at: new Date().toISOString(), steps: {} };

  // acceptance, with the run's own evidence files when they exist
  if (existsSync(join(dest, "verdict.json"))) copyFileSync(join(dest, "verdict.json"), join(dest, "verdict.before-rejudge.json"));
  const vArgs = [join(taskDir, "verify.mjs"), join(dest, "capture.jsonl"), "--json"];
  if (existsSync(join(dest, "tool-call-logs.jsonl"))) vArgs.push(`--service-log=${join(dest, "tool-call-logs.jsonl")}`);
  if (existsSync(join(dest, "reachability.json"))) vArgs.push(`--reachability=${join(dest, "reachability.json")}`);
  const v = run("node", vArgs, { stdoutTo: join(dest, "verdict.json"), stderrTo: join(dest, "verify.rejudge.log") });
  notes.steps.verify = { exit: v.status, args: vArgs.slice(1).map((a) => a.replace(dest, ".")) };
  let verdict = null;
  try { verdict = JSON.parse(readFileSync(join(dest, "verdict.json"), "utf8")); } catch { /* left for the caller */ }
  notes.acceptance_version = verdict?.acceptance_version ?? null;
  notes.verdict = verdict?.verdict ?? null;
  // the copy's run.json carries the verdict the reports read (summarize-runs
  // reads run.verdict); keep the original beside it
  const runJsonPath = join(dest, "run.json");
  if (verdict && existsSync(runJsonPath)) {
    const rj = JSON.parse(readFileSync(runJsonPath, "utf8"));
    rj.verdict_before_rejudge = rj.verdict ?? null;
    rj.verdict = verdict.verdict;
    rj.acceptance_version = verdict.acceptance_version ?? null;
    rj.rejudged_at = notes.rejudged_at;
    writeFileSync(runJsonPath, JSON.stringify(rj, null, 2) + "\n");
  }

  // outcomes, from the run's own used events and the re-read attempts
  if (existsSync(join(dest, "outcome-events.jsonl"))) copyFileSync(join(dest, "outcome-events.jsonl"), join(dest, "outcome-events.before-rejudge.jsonl"));
  const oArgs = [join(REPO, "evaluation/attribution/judge-outcome.mjs"), join(dest, "used-events.jsonl"), join(dest, "verdict.json"), tokensPlain, `--out=${join(dest, "outcome-events.jsonl")}`];
  if (existsSync(join(dest, "reachability.json"))) oArgs.push(`--reachability=${join(dest, "reachability.json")}`);
  const o = run("node", oArgs, { stdoutTo: join(dest, "outcome.md") });
  notes.steps.judge_outcome = { exit: o.status };
  if (o.status !== 0) writeFileSync(join(dest, "outcome.md"), (o.stdout ?? "") + "\n" + (o.stderr ?? ""));

  notes.code = {
    "verify.mjs": sha12(join(taskDir, "verify.mjs")),
    "shell-requests.mjs": sha12(join(REPO, "evaluation/provenance/shell-requests.mjs")),
    "judge-outcome.mjs": sha12(join(REPO, "evaluation/attribution/judge-outcome.mjs")),
  };
  writeFileSync(join(dest, "REJUDGED.json"), JSON.stringify(notes, null, 2) + "\n");
  return notes;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (n) => (args.find((a) => a.startsWith(`--${n}=`)) ?? "").slice(n.length + 3) || null;
  const outRoot = opt("out");
  const taskDir = resolve(REPO, opt("task") ?? "evaluation/tasks/bridge-addr");
  const dirs = [...new Set(args.filter((a) => !a.startsWith("--")).map((d) => d.replace(/\/+$/, "")))];
  if (!outRoot || !dirs.length) { console.error("usage: rejudge-runs.mjs --out=<dir> [--task=<dir>] [--key=<file>] <run dir>…"); process.exit(2); }
  mkdirSync(outRoot, { recursive: true });

  // the plaintext discriminative values, resolved from Core by the frozen quadruple, kept outside the repo and deleted after
  const tmp = mkdtempSync(join(tmpdir(), "rejudge-tokens-"));
  const tokensPlain = join(tmp, "tokens-plain.json");
  const rArgs = [join(REPO, "evaluation/attribution/resolve-tokens.mjs"), `--task=${taskDir}`, `--out=${tokensPlain}`];
  if (opt("key")) rArgs.push(`--key=${opt("key")}`);
  const r = run("node", rArgs);
  if (r.status !== 0 || !existsSync(tokensPlain)) { console.error(`resolve-tokens failed:\n${r.stdout}\n${r.stderr}`); rmSync(tmp, { recursive: true, force: true }); process.exit(2); }
  try {
    for (const d of dirs) {
      const n = rejudgeRun(d, { outRoot, taskDir, tokensPlain });
      console.log(`${n.run_id.padEnd(34)} verdict=${String(n.verdict).padEnd(5)} verify.exit=${n.steps.verify.exit} outcomes.exit=${n.steps.judge_outcome.exit} → ${join(outRoot, n.run_id)}`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
