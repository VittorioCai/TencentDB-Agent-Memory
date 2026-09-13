/**
 * 相关性筛选的终端展示:一次真实运行里,池中的候选怎么一层层变成进入上下文的内容。
 *
 *   node evaluation/attribution/selection-cli.mjs [--run=<id>]
 *
 * 只读已提交的运行记录。两层过滤分开报:准入是产品闸门做的(与任务无关),
 * 相关性是模型自己检索时做的。没有测量的东西不报 —— 报字符数,不报 token。
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { selectionView, renderSelection } from "./selection.mjs";

const args = process.argv.slice(2);
const run = (args.find((a) => a.startsWith("--run=")) ?? "").slice(6) || "20260911T185119Z-devloop-note";
const dir = `evaluation/runner/runs/${run}`;
const rd = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8") : null);
const j = (f) => { const t = rd(f); return t ? JSON.parse(t) : null; };

const pool = (j("asset-pool-snapshot.json")?.assets ?? []);
const verdict = j("verdict.json") ?? {};

// 检索与取回:从捕获的最后一次 chat 请求里读模型的 tool_calls 与对应的 tool 结果,
// 与两份闭环报告用的是同一条提取路径(report.mjs)。
const calls = [];
const capTxt = rd("capture.jsonl");
if (capTxt) {
  const cap = capTxt.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const reqs = cap.filter((e) => e?.event === "http.request" && Array.isArray(e?.body?.json?.messages));
  const msgs = reqs[reqs.length - 1]?.body?.json?.messages ?? [];
  const results = new Map(msgs.filter((m) => m?.role === "tool").map((m) => [m.tool_call_id, String(m.content ?? "")]));
  const seen = new Set();
  for (const m of msgs) for (const tc of (Array.isArray(m?.tool_calls) ? m.tool_calls : [])) {
    if (seen.has(tc.id)) continue; seen.add(tc.id);
    const a = String(tc?.function?.arguments ?? "");
    const sub = /skill-bridge\/v3\/skill\/(search|get-by-name|get|view)/.exec(a)?.[1];
    if (!sub) continue;
    const out = results.get(tc.id) ?? "";
    const fetched = sub !== "search" ? pool.find((p) => out.includes(p.name))?.name ?? null : null;
    calls.push({ kind: sub === "search" ? "search" : "fetch", result: out, chars: out.length, fetched });
  }
}

console.log(`运行 ${run} —— 候选怎么变成上下文`);
console.log("");
console.log(renderSelection(selectionView({ pool, calls, verdict })));
console.log("");
console.log("复算:node evaluation/attribution/selection-cli.mjs --run=" + run);
