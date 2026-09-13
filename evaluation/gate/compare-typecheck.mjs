/**
 * 比较两份 `tsc` 输出,判断搬运新增了多少条类型错误。
 *
 *   node evaluation/gate/compare-typecheck.mjs --base=<纯净上游输出> --head=<搬运后输出> [--scope=src/metadata] [--json]
 *
 * **行号不能参与比较**:插入代码后,既有错误的行号会整体下移,逐行 diff 会把同一条错误
 * 报成「一条消失、一条新增」。这里按「文件 + 错误码 + 消息」归一化成多重集合再比;
 * 同一条错误重复出现按出现次数计(多重集合,不是集合 —— 否则重复会被吞掉)。
 */
import { readFileSync } from "node:fs";

const LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

/** 一行 tsc 输出 → {file, line, col, code, message};不是错误行返回 null。 */
export function parseLine(line) {
  const m = LINE.exec(String(line).trim());
  return m ? { file: m[1], line: Number(m[2]), col: Number(m[3]), code: m[4], message: m[5] } : null;
}

export function parseErrors(text) {
  return String(text ?? "").split("\n").map(parseLine).filter(Boolean);
}

/**
 * 消息里可能嵌着**绝对路径**(TS2430 的 `Interface 'import("/Users/…/src/x")' …`),
 * 两棵树在不同目录下就会被当成两条不同的错误。路径是环境,不是内容:把
 * `<任意绝对路径>/<包名>/src/…` 折成 `…/src/…` 再比。
 */
export const normalizeMessage = (m) => String(m).replace(/"[^"]*?\/((?:src|dist|scripts)\/[^"]*)"/g, '"…/$1"');

/** 归一化键:文件 + 错误码 + 归一化后的消息,**不含行列**。 */
export const keyOf = (e) => `${e.file} ${e.code} ${normalizeMessage(e.message)}`;

const countBy = (errs) => errs.reduce((m, e) => m.set(keyOf(e), (m.get(keyOf(e)) ?? 0) + 1), new Map());

/** @returns added / removed 为多重集合差(按出现次数),各带一个样本;counts 为两侧条数。 */
export function compare(baseText, headText, { scope = null } = {}) {
  const inScope = (e) => (scope ? e.file.includes(scope) : true);
  const base = parseErrors(baseText).filter(inScope);
  const head = parseErrors(headText).filter(inScope);
  const b = countBy(base), h = countBy(head);
  const sample = new Map([...base, ...head].map((e) => [keyOf(e), e]));
  const added = [], removed = [];
  for (const [k, n] of h) { const d = n - (b.get(k) ?? 0); if (d > 0) added.push({ ...sample.get(k), times: d }); }
  for (const [k, n] of b) { const d = n - (h.get(k) ?? 0); if (d > 0) removed.push({ ...sample.get(k), times: d }); }
  return {
    base_count: base.length, head_count: head.length,
    added_count: added.reduce((s, e) => s + e.times, 0),
    removed_count: removed.reduce((s, e) => s + e.times, 0),
    added, removed,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? "").slice(n.length + 3) || null;
  const scope = arg("scope");
  const r = compare(readFileSync(arg("base"), "utf8"), readFileSync(arg("head"), "utf8"), { scope });
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    console.log(`基线 ${r.base_count} 条,搬运后 ${r.head_count} 条${scope ? `(只看 ${scope})` : ""}`);
    console.log(`按「文件 + 错误码 + 消息」归一化后:新增 ${r.added_count} 条,消掉 ${r.removed_count} 条`);
    for (const e of r.added.slice(0, 10)) console.log(`  + ${e.file} ${e.code} ${e.message}${e.times > 1 ? ` ×${e.times}` : ""}`);
    for (const e of r.removed.slice(0, 10)) console.log(`  - ${e.file} ${e.code} ${e.message}${e.times > 1 ? ` ×${e.times}` : ""}`);
  }
  process.exit(r.added_count === 0 ? 0 : 1);
}
