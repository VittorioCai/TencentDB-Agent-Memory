/**
 * 仓库里每一份「由脚本生成」的报告,验收都必须知道它的处置。
 *
 *   node evaluation/check-generated-reports.mjs [--registry=evaluation/generated-reports.json] [--json]
 *
 * 起因(2026-09-13 自查):验收只知道自己重算了哪几份,不知道仓库里一共有哪几份。
 * `REPARSE-DIFF-2026-09-11-exitline.md` 因此漏了 —— 它的两个同名兄弟都在查,唯独它不在,
 * 而少查一份不会有任何人发现。这里反过来做:先把磁盘上的生成报告找全,再逐份对登记簿。
 *
 * 四种登记都算「知道」,但意思完全不同(CLAUDE.md §2:未知不能折成确定值):
 * regenerated 是重算并 diff,figures_checked 是抄写被机检钉住,historical 是旧口径下的报告、
 * 按「旧批次原始记录不得覆盖」保留不改,not_regenerable 是**登记在案的缺点**。
 * 未登记的一律阻断;登记了却已不在磁盘上的也要报,免得登记簿变成一本旧账。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * 穷举:`evaluation/` 下每一份入库 .md 都要被分类 —— 不靠「文件头自述为生成」去猜。
 * 猜的那一版自己就会漏(2026-09-13 首次运行把 PR-DESCRIPTION 当成生成报告、又漏掉四份真的),
 * 而这里的目的正是不漏。delivery/ 是验收自己的归档、runner/runs/ 是运行记录,都不在范围内。
 */
export function findMarkdown(root = "evaluation", { skip = ["delivery", "node_modules", "runs"] } = {}) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (!skip.includes(e.name)) walk(p); continue; }
      if (e.name.endsWith(".md")) out.push(p);
    }
  };
  walk(root);
  return out.sort();
}

/** 登记簿认得的类别。加新类别必须同时加到这里,否则一律按「不认识」阻断。 */
export const CLASSES = ["regenerated", "figures_checked", "not_regenerable", "historical"];

/** 规则化的叙述文档:README / task / assets 下的素材 / 上游 PR 正文。 */
export function isNarrative(path, registry) {
  if ((registry?.narrative_paths ?? []).includes(path)) return true;
  return (registry?.narrative_rules ?? []).some((r) => new RegExp(r).test(path));
}

/** @returns {{ok, registered, unregistered, stale, by_class}} */
export function checkRegistry(found, registry) {
  const reports = registry?.reports ?? [];
  const byPath = new Map(reports.map((r) => [r.path, r]));
  const foundSet = new Set(found);
  const unregistered = found.filter((p) => !byPath.has(p) && !isNarrative(p, registry));
  const bothWays = found.filter((p) => byPath.has(p) && isNarrative(p, registry));
  const stale = reports.filter((r) => !foundSet.has(r.path)).map((r) => r.path);
  const byClass = {};
  for (const r of reports) if (foundSet.has(r.path)) (byClass[r.class] ??= []).push(r.path);
  const badClass = reports.filter((r) => !CLASSES.includes(r.class));
  // historical 与 not_regenerable 都必须写明原因:一个是「为什么不再算」,一个是「为什么算不了」。
  const missingWhy = reports.filter((r) => ["not_regenerable", "historical"].includes(r.class) && !r.why);
  const narrative = found.filter((p) => isNarrative(p, registry));
  return { ok: unregistered.length === 0 && stale.length === 0 && badClass.length === 0 && missingWhy.length === 0 && bothWays.length === 0,
    registered: reports.length, found: found.length, narrative: narrative.length, unregistered, stale, both_ways: bothWays,
    bad_class: badClass.map((r) => r.path), missing_why: missingWhy.map((r) => r.path), by_class: byClass };
}

export function render(r) {
  const L = [`入库 .md ${r.found} 份:叙述 ${r.narrative} 份,登记的报告 ${r.registered} 份 —— ` +
    Object.entries(r.by_class).map(([k, v]) => `${k} ${v.length}`).join(",") +
    (r.ok ? ";未登记 0 份" : "")];
  for (const p of r.unregistered) L.push(`  未登记(阻断):${p}`);
  for (const p of r.both_ways) L.push(`  既算叙述又登记成报告,挑一个:${p}`);
  for (const p of r.stale) L.push(`  登记了却不在磁盘上:${p}`);
  for (const p of r.bad_class) L.push(`  登记的类别不认识:${p}`);
  for (const p of r.missing_why) L.push(`  登记为 not_regenerable 却没写原因:${p}`);
  for (const p of r.by_class.not_regenerable ?? []) L.push(`  **不能重算(缺点,已登记)**:${p}`);
  return L.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
  const registry = JSON.parse(readFileSync(arg("registry", "evaluation/generated-reports.json"), "utf8"));
  const r = checkRegistry(findMarkdown(arg("root", "evaluation")), registry);
  console.log(process.argv.includes("--json") ? JSON.stringify(r, null, 2) : render(r));
  process.exit(r.ok ? 0 : 1);
}
