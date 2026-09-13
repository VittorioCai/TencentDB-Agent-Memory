/**
 * 对照报告里的主表是**手抄**自 `summarize-runs.mjs` 生成的那两张表(生成的那份由
 * deliver-check 逐行重算并 diff,抄过去的这份此前没人查)。CLAUDE.md §1 记着这个动作
 * 两次让报告和工作树分叉,而且两次错的都是同一格。这里把抄写钉死:
 * 逐格比对,只要有一格对不上就失败,并指出是哪一格、两边各是什么。
 *
 *   node evaluation/runner/check-comparison-figures.mjs \
 *     [--summary=evaluation/runner/summary-2026-09-11-reparsed.md] \
 *     [--comparison=evaluation/runner/COMPARISON-2026-09-11-reparsed.md] [--json]
 *
 * 不改写任何一份文件 —— 叙述性的对照报告仍由人写,只是它引用的数字必须与生成的那份一致。
 */
import { readFileSync } from "node:fs";

/** Markdown 表 → [{列名: 值}],按表头取列名;非表格行忽略。 */
export function parseTables(md) {
  const tables = [];
  let header = null, rows = null;
  for (const raw of String(md ?? "").split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("|")) { if (rows?.length) { tables.push({ header, rows }); } header = null; rows = null; continue; }
    const cells = line.slice(1, line.endsWith("|") ? -1 : undefined).split("|").map((c) => c.trim());
    if (/^[-: ]+$/.test(cells.join(""))) continue;              // 分隔行
    if (!header) { header = cells; rows = []; continue; }
    rows.push(Object.fromEntries(cells.map((c, i) => [header[i] ?? `col${i}`, c])));
  }
  if (rows?.length) tables.push({ header, rows });
  return tables;
}

/** 第一列等于 label 的那一行,在所有表里找;找不到返回 null。 */
export function rowFor(tables, label) {
  const out = {};
  let found = false;
  for (const t of tables) {
    const key = t.header[0];
    for (const r of t.rows) {
      if (r[key] !== label) continue;
      found = true;
      for (const [k, v] of Object.entries(r)) if (k !== key) out[k] = v;
    }
  }
  return found ? out : null;
}

/**
 * 对照表的列名 → 生成表的列名。生成表里有、对照表没有的列(mean total tok)不比,
 * 因为对照报告本来就没抄它;**反过来不行** —— 对照表有的每一列都必须在这里有出处。
 */
export const COLUMN_MAP = {
  "起跑": "started",
  "PASS": "pass",
  "FAIL": "fail",
  "不可判": "unjudgeable",
  "端点成功率": "endpoint success rate",
  "见到被拒资产": "rejected asset seen (skl-sZFb3KatWY6m)",
  "首批全对": "first batch all ok",
  "首批有失败": "first batch had a failure",
  "失败尝试": "failed attempts",
  "corrected": "corrected",
  "validated": "validated",
  "均墙钟 s": "mean wall s",
  "均 prompt tok": "mean prompt tok",
};

const clean = (v) => String(v ?? "").replace(/\*\*/g, "").trim();

/** @returns {{ok, checked, mismatches, missing_columns, missing_arms}} */
export function checkFigures(summaryMd, comparisonMd, { arms = ["gate-off", "gate-on"], map = COLUMN_MAP } = {}) {
  const sum = parseTables(summaryMd), cmp = parseTables(comparisonMd);
  const mismatches = [], missingColumns = [], missingArms = [];
  let checked = 0;
  for (const arm of arms) {
    const s = rowFor(sum, arm), c = rowFor(cmp, arm);
    if (!s || !c) { missingArms.push({ arm, in_summary: Boolean(s), in_comparison: Boolean(c) }); continue; }
    for (const [cmpCol, sumCol] of Object.entries(map)) {
      if (!(cmpCol in c)) { missingColumns.push({ arm, column: cmpCol, where: "comparison" }); continue; }
      if (!(sumCol in s)) { missingColumns.push({ arm, column: sumCol, where: "summary" }); continue; }
      checked += 1;
      if (clean(c[cmpCol]) !== clean(s[sumCol])) {
        mismatches.push({ arm, comparison_column: cmpCol, comparison: clean(c[cmpCol]), summary_column: sumCol, summary: clean(s[sumCol]) });
      }
    }
  }
  return { ok: mismatches.length === 0 && missingColumns.length === 0 && missingArms.length === 0,
    checked, mismatches, missing_columns: missingColumns, missing_arms: missingArms };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
  const summary = arg("summary", "evaluation/runner/summary-2026-09-11-reparsed.md");
  const comparison = arg("comparison", "evaluation/runner/COMPARISON-2026-09-11-reparsed.md");
  const r = checkFigures(readFileSync(summary, "utf8"), readFileSync(comparison, "utf8"));
  if (process.argv.includes("--json")) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`对照报告的主表与生成的 summary 逐格比对:${r.checked} 格${r.ok ? ",全部一致" : ""}`);
    for (const m of r.mismatches) console.log(`  对不上 ${m.arm} 「${m.comparison_column}」:对照报告 ${m.comparison},生成的 summary(${m.summary_column}) ${m.summary}`);
    for (const m of r.missing_columns) console.log(`  ${m.where} 里没有这一列:${m.column}(${m.arm})`);
    for (const m of r.missing_arms) console.log(`  找不到这一臂:${m.arm}(summary=${m.in_summary} comparison=${m.in_comparison})`);
  }
  process.exit(r.ok ? 0 : 1);
}
