/**
 * Leave-one-out calibration (P4-6): is the hard judge's `used` trustworthy?
 *
 * The judge and a human reading the same artifacts share a source, so
 * agreement between them proves little. The truth used here is behavioural:
 * hide the asset from the model and see whether the run changes.
 *
 *   acted(run, X)   X's discriminative token appears in something the model
 *                   did in that run — a tool call's arguments, an address it
 *                   dialled. Read from the artifacts, not from the judge.
 *   present / absent  runs where X was visible / hidden at the start, read
 *                   back from the product (run.json → gate.visibility_at_start)
 *   needed(X)       acted in some present run, and in NO absent run. The token
 *                   never appears without the asset; with it, it does.
 *   leak(X)         acted in an absent run. The model produced the token with
 *                   the asset hidden, so it knew it from elsewhere, and every
 *                   `used` the judge issued for X on that token is unsupported.
 *
 * Per (present run, asset) pair, against the judge's `used`:
 *
 *   TP  judged used, acted, needed
 *   FP  judged used, but not acted in that run, or X leaks
 *   FN  not judged used (needs_review or nothing), but acted and needed
 *
 * precision = TP / (TP + FP), recall = TP / (TP + FN), always with n. An
 * asset with no absent runs is reported as undetermined — no ablation, no
 * truth — never as 100%.
 *
 * Usage:
 *   node evaluation/calibration/loo.mjs evaluation/runner/runs [--tokens=F] [--assets=a,b] [--json]
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { dialledToken } from "../attribution/judge-outcome.mjs";

function readJson(p, fallback = null) { return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback; }
function readJsonl(p) { return existsSync(p) ? readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)) : []; }

/** Did the model act on this asset's tokens in this run? From artifacts and attempts, never from the judge. */
export function actedOn({ operations = [], attempts = [] }, tokens) {
  if (tokens.length === 0) return false;
  const inOps = operations.some((op) => op.kind === "tool_call" && tokens.some((t) => String(op.text ?? "").includes(t)));
  const inDial = attempts.some((a) => dialledToken(a, tokens) !== null);
  return inOps || inDial;
}

/** Load one run directory into the shape calibrate() needs. Null if not a run. */
export function loadRun(dir, tokensByAsset) {
  const run = readJson(join(dir, "run.json"));
  if (!run) return null;
  const vis = run.gate?.visibility_at_start ?? null;
  // Under the in-Core gate (2026-09-07) an asset can also be hidden by its
  // status: `failed` leaves list-accessible, `candidate` is readable only by
  // the owner, admins and reviewers — the consumer is a plain member. A run
  // that recorded statuses carries them here; older runs carry only visibility.
  const status = run.gate?.status_at_start ?? null;
  const artifacts = readJson(join(dir, "run-artifacts.json"), []);
  const operations = (Array.isArray(artifacts) ? artifacts : [artifacts]).flatMap((a) => a?.operations ?? []);
  const attempts = readJson(join(dir, "verdict.json"), {})?.attempts ?? [];
  const used = readJsonl(join(dir, "used-events.jsonl"));
  const tokens = readJson(join(dir, "tokens.json"), tokensByAsset) ?? {};
  const acted = new Set(Object.keys(tokens).filter((id) => !id.startsWith("_") && actedOn({ operations, attempts }, tokens[id]?.tokens ?? [])));
  return {
    run_id: run.run_id,
    label: run.label ?? null,
    verdict: run.verdict ?? null,
    // null = the run recorded no gate state; visibility is not known, not assumed
    visible: vis
      ? Object.fromEntries(Object.entries(vis).map(([k, v]) => [k, v === "team" && !(status && (status[k] === "failed" || status[k] === "candidate"))]))
      : null,
    judged_used: new Set(used.filter((e) => e.state === "used").map((e) => e.asset_id)),
    judged_review: new Set(used.filter((e) => e.state === "needs_review").map((e) => e.asset_id)),
    acted,
  };
}

function rate(n, of) { return of > 0 ? n / of : null; }

/** Calibrate the judge's `used` for each asset over the runs. */
export function calibrate(runs, assetIds) {
  const known = runs.filter((r) => r.visible !== null);
  const rows = [];
  for (const X of assetIds) {
    const present = known.filter((r) => r.visible[X] === true);
    const absent = known.filter((r) => r.visible[X] === false);
    const actedPresent = present.filter((r) => r.acted.has(X)).length;
    const actedAbsent = absent.filter((r) => r.acted.has(X)).length;
    const row = {
      asset_id: X,
      present: present.length, absent: absent.length,
      present_run_ids: present.map((r) => r.run_id),
      absent_run_ids: absent.map((r) => r.run_id),
      acted_present: actedPresent, acted_absent: actedAbsent,
      judged_used_present: present.filter((r) => r.judged_used.has(X)).length,
      judged_review_present: present.filter((r) => r.judged_review.has(X)).length,
      needed: null, leak: null, tp: 0, fp: 0, fn: 0, precision: null, recall: null, status: "undetermined",
      note: "",
    };
    if (absent.length === 0) {
      row.note = "no run with this asset hidden; truth unknown, not assumed";
      rows.push(row);
      continue;
    }
    row.leak = actedAbsent > 0;
    row.needed = !row.leak && actedPresent > 0;
    for (const r of present) {
      const judged = r.judged_used.has(X);
      const acted = r.acted.has(X);
      if (judged && acted && row.needed) row.tp += 1;
      else if (judged) row.fp += 1;
      else if (acted && row.needed) row.fn += 1;
    }
    row.precision = rate(row.tp, row.tp + row.fp);
    row.recall = rate(row.tp, row.tp + row.fn);
    row.status = row.leak ? "leak" : row.needed ? "needed" : "not acted on";
    if (row.leak) row.note = `token appeared in ${actedAbsent}/${absent.length} run(s) with the asset hidden — the model knew it from elsewhere; every used on this token is unsupported`;
    else if (!row.needed) row.note = "the model never acted on this asset even when present; nothing to calibrate against";
    else if (row.fn > 0) row.note = `${row.fn} present run(s) acted on it without a used claim (judge withheld: ${row.judged_review_present} needs_review)`;
    rows.push(row);
  }
  const det = rows.filter((r) => r.status !== "undetermined");
  const tp = det.reduce((a, r) => a + r.tp, 0), fp = det.reduce((a, r) => a + r.fp, 0), fn = det.reduce((a, r) => a + r.fn, 0);
  return {
    rows,
    overall: { assets_determined: det.length, assets_total: rows.length, tp, fp, fn, precision: rate(tp, tp + fp), recall: rate(tp, tp + fn) },
    runs_without_gate_state: runs.length - known.length,
  };
}

const pct = (x, n) => (x === null ? "—" : `${(x * 100).toFixed(0)}% (n=${n})`);

export function renderCalibration({ rows, overall, runs_without_gate_state }) {
  const lines = ["# Leave-one-out calibration of `used`", ""];
  lines.push("Truth is behavioural: did the model act on the asset's token when it was visible, and never when it was hidden?", "");
  lines.push("| asset | present runs | acted | judged used | withheld | hidden runs | acted while hidden | truth | TP | FP | FN | precision | recall |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    lines.push(`| ${r.asset_id} | ${r.present} | ${r.acted_present} | ${r.judged_used_present} | ${r.judged_review_present} | ${r.absent} | ${r.absent ? r.acted_absent : "—"} | ${r.status} | ${r.tp} | ${r.fp} | ${r.fn} | ${pct(r.precision, r.tp + r.fp)} | ${pct(r.recall, r.tp + r.fn)} |`);
  }
  lines.push("");
  for (const r of rows.filter((x) => x.note)) lines.push(`- ${r.asset_id}: ${r.note}`);
  lines.push("");
  lines.push(`overall over ${overall.assets_determined}/${overall.assets_total} determined asset(s): precision ${pct(overall.precision, overall.tp + overall.fp)}, recall ${pct(overall.recall, overall.tp + overall.fn)}`);
  if (runs_without_gate_state > 0) lines.push(`${runs_without_gate_state} run(s) recorded no gate state and were left out — visibility is not assumed.`);
  lines.push("", "An asset with no hidden run is undetermined, not 100%. \"withheld\" counts needs_review: the judge saw the token but would not tie it to the fetch.");
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith("--")) ?? "evaluation/runner/runs";
  const arg = (name) => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
  const tokensByAsset = arg("tokens") ? readJson(arg("tokens"), {}) : readJson("evaluation/attribution/artifacts/tokens.json", {});
  const runs = readdirSync(dir).map((n) => loadRun(join(dir, n), tokensByAsset)).filter(Boolean).sort((a, b) => String(a.run_id).localeCompare(String(b.run_id)));
  const assets = arg("assets") ? arg("assets").split(",") : Object.keys(tokensByAsset);
  const result = calibrate(runs, assets);
  console.log(args.includes("--json") ? JSON.stringify(result, null, 2) : renderCalibration(result));
}
