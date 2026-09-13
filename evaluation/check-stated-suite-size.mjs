/**
 * 文档里写死的「套件有多少个测试」必须与实际跑出来的一致。
 *
 *   node evaluation/check-stated-suite-size.mjs --suite-output=<node --test 的输出> [--doc=evaluation/README.md] [--json]
 *
 * 这个数字漂过两次:彩排 E(2026-09-12)修过一回,2026-09-13 又漂成 643 对 729。
 * 它是典型的「叙述里抄了一个会变的数」——和对照报告主表同一类毛病,所以同一种治法:
 * 不靠人记得改,靠每次验收比一次。
 *
 * 认所有 `Full suite: N tests` / `套件 N/N` 的写法,**默认都比**;只有行里显式标了
 * 「当时的数」「历史记录」或 `<!-- suite-size:historical -->` 的才当历史放过。
 */
import { readFileSync } from "node:fs";

/** `node --test` 的摘要行 → 实际测试数;读不到返回 null(未知,不折成 0)。 */
export function actualFromSuiteOutput(text) {
  const m = /^ℹ tests (\d+)$/m.exec(String(text ?? ""));
  return m ? Number(m[1]) : null;
}

/**
 * 历史记录的标记。**默认全查**,只有显式标了的才不比 —— 原来靠「带日期或提交号就算历史」
 * 去猜,而当前声明恰恰也带日期和提交号(STATE 的「验证时间」行),于是把那一行改成
 * 999/999 照样通过(2026-09-13 第八轮复核的反例,已复现)。猜的方向错了:
 * 漏判的代价是放过一个陈旧数字,所以默认必须是「查」。
 */
export const HISTORICAL_MARK = /当时的数|历史记录|<!--\s*suite-size:historical\s*-->/;

/** 文档里每一处套件规模声明,连行号与「是不是历史」一起给出;没有声明返回 []。 */
export function statedSizes(md) {
  const out = [];
  String(md ?? "").split("\n").forEach((line, i) => {
    const m = /Full suite:\s*(\d+)\s*tests|套件\s*(\d+)\s*\/\s*(\d+)/.exec(line);
    if (!m) return;
    out.push({ line: i + 1, stated: Number(m[1] ?? m[2]), historical: HISTORICAL_MARK.test(line), text: line.trim().slice(0, 100) });
  });
  return out;
}

/** @returns {{ok, actual, stated, mismatches}} —— 实际数未知时不通过(§2:未知不能当通过) */
export function checkStated(suiteOutput, docs) {
  const actual = actualFromSuiteOutput(suiteOutput);
  const stated = [];
  for (const [path, md] of Object.entries(docs)) for (const s of statedSizes(md)) if (!s.historical) stated.push({ path, ...s });
  if (actual === null) {
    return { ok: false, actual: null, stated, mismatches: [], why: "从套件输出里读不到 `ℹ tests N`,无法判断文档里的数字对不对" };
  }
  const mismatches = stated.filter((s) => s.stated !== actual);
  return { ok: mismatches.length === 0, actual, stated, mismatches, why: null };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
  const docs = {};
  for (const p of arg("doc", "evaluation/README.md,evaluation/STATE.md").split(",")) docs[p] = readFileSync(p, "utf8");
  const r = checkStated(readFileSync(arg("suite-output", ""), "utf8"), docs);
  if (process.argv.includes("--json")) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(r.why ?? `套件实际 ${r.actual} 个测试;文档里声明当前规模的地方 ${r.stated.length} 处${r.ok ? ",全部一致" : ""}`);
    for (const m of r.mismatches) console.log(`  对不上 ${m.path}:${m.line} 写的是 ${m.stated},实际 ${r.actual} —— ${m.text}`);
  }
  process.exit(r.ok ? 0 : 1);
}
