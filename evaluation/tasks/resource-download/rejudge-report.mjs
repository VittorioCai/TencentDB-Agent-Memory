/**
 * 第三任务采用归因重判的 before/after 报告 —— 由 rows 生成,数字不手抄(CLAUDE.md §1、§6)。
 *
 *   node evaluation/tasks/resource-download/rejudge-report.mjs [--out=REJUDGE-POOL.md] [--md]
 *
 * 改的是什么:给这个任务补上一份**含它自己笔记**的冻结资产池快照。原先笔记不在快照里,
 * `provenance/build-events.mjs` 对它直接 continue,连 `fetched` 都不写,判决器无从 credit。
 * **判决器的规则一条没动**;动的是喂给它的那份池。判据先冻结在 `rejudge-criteria.json`。
 *
 * 先报保真对照再报差值:重放装置如果会凭空造出或抹掉 `used`,这份差值就一文不值。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HERE = new URL(".", import.meta.url).pathname;

export function parseRows(text) {
  return String(text ?? "").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

/** 重放是否忠实:用当初那份快照重跑,判定必须一字不差。 */
export function fidelityOf(rows) {
  const judged = rows.filter((r) => r.rejudged);
  const changed = judged.filter((r) => r.changed).map((r) => r.run_id);
  return { ok: changed.length === 0, total: judged.length, changed,
    with_used: judged.filter((r) => (r.before ?? []).includes("used")).length };
}

/** 按批、按组统计;**污染的不计入**,与 REPORT.md 同一口径。 */
export function summarise(rows, manifest) {
  const meta = Object.fromEntries((manifest?.runs ?? []).map((r) => [r.run_id, r]));
  const byBatch = {};
  const skipped = [];
  const excluded = [];
  for (const row of rows) {
    const m = meta[row.run_id] ?? {};
    if (!row.rejudged) { skipped.push({ run_id: row.run_id, arm: row.arm, why: row.why ?? "未记原因" }); continue; }
    if (m.contaminated === true) { excluded.push({ run_id: row.run_id, arm: row.arm, rules: m.contamination_rules ?? [] }); continue; }
    const b = (byBatch[m.batch ?? "?"] ??= {});
    const g = (b[row.arm] ??= { counted: 0, with_used_before: 0, with_used_after: 0, with_any_event_before: 0, with_any_event_after: 0 });
    g.counted++;
    if ((row.before ?? []).includes("used")) g.with_used_before++;
    if ((row.after ?? []).includes("used")) g.with_used_after++;
    if ((row.before ?? []).length) g.with_any_event_before++;
    if ((row.after ?? []).length) g.with_any_event_after++;
  }
  return { byBatch, skipped, excluded_contaminated: excluded, rows };
}

export function render(s, controls, manifest) {
  const L = [];
  // **基线**是「用当初那份快照重放」的 rows,不是改动后的那份 —— 拿改动后的算保真
  // 等于问「改了之后跟没改一样吗」,那当然全是不同(2026-09-13 首次生成即如此,已修)。
  const c = Array.isArray(controls) ? { task2: controls, baseline: [] } : (controls ?? { task2: [], baseline: [] });
  const fid = fidelityOf(c.baseline);
  const ctrl = fidelityOf(c.task2);
  L.push("# 第三任务:采用归因重判(补上缺失的资产池快照)", "");
  L.push("本页由 `rejudge-report.mjs` 从 `rejudge-*-rows.jsonl` 生成,数字不手抄。判据先冻结在 `rejudge-criteria.json`。", "");
  L.push("## 改了什么", "");
  L.push("给本任务补一份**含它自己笔记**的冻结资产池快照。此前笔记不在快照里,`provenance/build-events.mjs:461`");
  L.push("对不在快照里的资产直接 `continue` —— 连 `fetched` 事件都不写,判决器手上没有可 credit 的取回,");
  L.push("使用判定只能停在 `needs_review`。**判决器的规则一条没动**,包括「最早送达」。", "");
  L.push("另两个闭环任务本来就各自带着快照;第三个漏了这一步。`run-once.sh` 现在在登记资产不在冻结快照里时**硬失败**。", "");
  L.push("## 先看对照:重放装置可不可信", "", "| 对照 | 判了 | 一字不差复现 | 其中原本带 `used` |", "|---|---:|---:|---:|");
  L.push(`| 第二任务(笔记 v2 未烧毁,本来就有 \`used\`) | ${ctrl.total} | ${ctrl.ok ? ctrl.total : `${ctrl.total - ctrl.changed.length}(**${ctrl.changed.length} 次对不上**)`} | ${ctrl.with_used} |`);
  L.push(`| 第三任务自身基线(用每次运行当初那份快照) | ${fid.total} | ${fid.ok ? fid.total : `${fid.total - fid.changed.length}(**${fid.changed.length} 次对不上**)`} | ${fid.with_used} |`);
  L.push("");
  if (!ctrl.ok || !fid.ok) {
    L.push(`**重放装置不可信**:${[...ctrl.changed, ...fid.changed].join("、")} 对不上当初的判定。下面的差值不成立。`, "");
  } else {
    L.push("两组都全对 —— 装置不会凭空造出或抹掉 `used`,所以下面的差值可以读。", "");
  }
  L.push("## 差值", "", "| 批 | 组 | 计入 | 重判前带 `used` | 重判后带 `used` | 重判后有任何笔记事件 |", "|---|---|---:|---:|---:|---:|");
  for (const [batch, arms] of Object.entries(s.byBatch).sort()) {
    for (const arm of ["no-note", "note"]) {
      const g = arms[arm]; if (!g) continue;
      L.push(`| 第 ${batch} 批 | ${arm} | ${g.counted} | ${g.with_used_before} | **${g.with_used_after}** | ${g.with_any_event_after} |`);
    }
  }
  L.push("");
  const noteTot = Object.values(s.byBatch).reduce((a, x) => a + (x.note?.counted ?? 0), 0);
  const noteUsed = Object.values(s.byBatch).reduce((a, x) => a + (x.note?.with_used_after ?? 0), 0);
  const zeroTot = Object.values(s.byBatch).reduce((a, x) => a + (x["no-note"]?.counted ?? 0), 0);
  const zeroEv = Object.values(s.byBatch).reduce((a, x) => a + (x["no-note"]?.with_any_event_after ?? 0), 0);
  L.push(`合计:计入样本的有笔记运行 ${noteTot} 次,重判后 **${noteUsed} 次**带 \`used\`(重判前 0 次);`
    + `无笔记运行 ${zeroTot} 次,重判后仍有 ${zeroEv} 次出现笔记事件。`, "");
  if (zeroEv > 0) L.push(`**无笔记组出现了笔记事件(${zeroEv} 次)** —— 这不该发生,改动漏了东西,结论作废。`, "");
  if (noteUsed < noteTot) {
    L.push(`并非每次都归因得上:${noteTot - noteUsed} 次仍然没有 \`used\`。检索到不等于用得上,用得上也不总留得下证据。`, "");
  }
  if (s.skipped.length) {
    L.push("## 不能重判的运行(连原因一起列,不折成「没有 used」)", "", "| 运行 | 组 | 为什么 |", "|---|---|---|");
    for (const k of s.skipped) L.push(`| \`${k.run_id}\` | ${k.arm} | ${k.why} |`);
    L.push("");
  }
  if (s.excluded_contaminated.length) {
    L.push(`**污染的 ${s.excluded_contaminated.length} 次不计入**(与 REPORT.md 同口径):`
      + s.excluded_contaminated.map((e) => `\`${e.run_id}\`(${e.rules.join("、") || "未记规则"})`).join("、"), "");
  }
  L.push("## 这说明什么,不说明什么", "");
  L.push("- **说明**:此前「归因未闭合」是我们自己少收了证据,不是模型没用笔记。补上快照之后,");
  L.push("  「这次改动确实用了这条被取回的笔记」在这些运行上有了闭合的证据链。");
  L.push("- **不说明产品更强了**。改的是评测自己的采集口径,产品一行没动。");
  L.push("- **补不上第一批**:那批的笔记是 v1,判别值已随记录烧毁(§16),解析不到,硬判会得到假阴。");
  L.push("- 样本仍小、仍是单模型;产品源码仍在工作副本里,所以仍不能证明「这条知识只能来自笔记」。");
  return L.join("\n") + "\n";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d = null) => {
    const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
    return hit === undefined ? d : hit.slice(n.length + 3);
  };
  const rd = (f) => parseRows(readFileSync(join(HERE, f), "utf8"));
  const manifest = JSON.parse(readFileSync(join(HERE, "devloop-runs.json"), "utf8"));
  const md = render(summarise(rd("rejudge-rows.jsonl"), manifest),
    { task2: rd("rejudge-control-task2-rows.jsonl"), baseline: rd("rejudge-baseline-rows.jsonl") }, manifest);
  if (process.argv.includes("--md")) process.stdout.write(md);
  else { const out = arg("out", join(HERE, "REJUDGE-POOL.md")); writeFileSync(out, md); console.log(`${out} ← 生成`); }
}
