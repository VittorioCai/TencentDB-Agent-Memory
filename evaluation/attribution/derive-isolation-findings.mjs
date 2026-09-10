#!/usr/bin/env node
/**
 * 派生的隔离审计 —— 元数据缺失不该抹掉已经找到的泄漏证据。
 *
 * 一次运行的隔离状况有两件互相独立的事实:
 *
 *   隔离配置   运行时 runner 有没有快照/还原记忆,记在 run.json 的 `agent_memory`
 *   内容泄漏   资产内容有没有从**别的来源**到达模型,由原始捕获复算得到
 *
 * `20260908T075637Z-gate-on-core` 早于隔离改造,没有 `agent_memory` 字段,所以第一件
 * 是"未记录"。但第二件是**已确认的**:它的捕获里,两个池内资产的 token 都先由那份
 * agent 自己的知识文件送达,早于被判定的操作。把第二件也说成"未知",等于让缺失的
 * 元数据抹掉已经拿到的证据。
 *
 * 所以这两件分开存。本文件把第二件写成**派生产物**,不碰 `runs/` 下的原始记录:
 * 每条绑定运行 id、捕获文件的 sha256、消息位置证据,以及产出它的分析代码哈希。
 * 派生文件可以随时由这条命令重算,与原始数据对得上。
 *
 * 用法:
 *   node evaluation/attribution/derive-isolation-findings.mjs \
 *     --out=evaluation/attribution/artifacts/isolation-findings.json \
 *     evaluation/runner/runs/2026...-gate-.../   （按目录通配传入）
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { runInput, loadRunTokens } from "./calibrate-runs.mjs";

const sha256 = (p) => (existsSync(p) ? createHash("sha256").update(readFileSync(p)).digest("hex") : null);

/** 这些判定说明"内容确实到了,但不是从这个资产来的"——即他源送达。 */
const LEAK_VERDICTS = new Set(["delivered_from_other_source"]);

export async function findingsForRun(dir, { taskDir = "evaluation/tasks/bridge-addr" } = {}) {
  const tokens = await loadRunTokens(dir, { taskDir });
  const r = runInput(dir, { tokens });
  const leaks = [];
  for (const [assetId, a] of Object.entries(r.assets ?? {})) {
    if (!LEAK_VERDICTS.has(a.verdict)) continue;
    leaks.push({
      asset_id: assetId,
      asset_version: a.asset_version ?? null,
      verdict: a.verdict,
      // 证据位置与来源由 delivery-audit 给出,原样带上,不复述。
      at: a.delivery_finding?.at ?? null,
      from: a.delivery_finding?.from ?? null,
      where: a.delivery_finding?.where ?? null,
      why: a.delivery_finding?.why ?? null,
      arrivals: a.delivery_finding?.arrivals ?? null,
      hidden_at_start: a.hidden ?? null,
    });
  }
  return {
    run_id: r.run_id,
    started_at: r.started_at ?? null,
    capture_sha256: sha256(`${dir}/capture.jsonl`),
    verdict_sha256: sha256(`${dir}/verdict.json`),
    capture_complete: r.capture_complete,
    // run.json 记的隔离配置,原样转录:它与下面的泄漏证据是两件事。
    isolation_recorded: r.contaminated === null ? "未记录" : r.contaminated ? "记录为受污染" : "记录为已隔离",
    leak_confirmed: leaks.length > 0,
    leaks,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const out = (args.find((a) => a.startsWith("--out=")) ?? "").slice(6);
  const dirs = args.filter((a) => !a.startsWith("--"));
  if (!dirs.length) { console.error("usage: derive-isolation-findings.mjs [--out=<file>] <run dir> …"); process.exit(2); }

  const code = {};
  for (const f of ["delivery-audit.mjs", "adoption.mjs", "calibrate-runs.mjs", "derive-isolation-findings.mjs"]) {
    code[f] = createHash("sha256").update(readFileSync(new URL(f, import.meta.url))).digest("hex").slice(0, 12);
  }
  const runs = [];
  for (const d of dirs) runs.push(await findingsForRun(d));
  const doc = {
    what: "由原始捕获复算得到的他源送达证据。原始记录未改动;本文件是派生产物,可用同一条命令重算。",
    generated_at: new Date().toISOString(),
    analysis_code: code,
    runs,
  };
  const withLeak = runs.filter((r) => r.leak_confirmed);
  if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(doc, null, 2) + "\n"); console.error(`written → ${out}`); }
  console.log(`${runs.length} 次运行;确认他源送达 ${withLeak.length} 次`);
  for (const r of withLeak) {
    console.log(`  ${r.run_id}  隔离配置=${r.isolation_recorded}  泄漏=已确认(${r.leaks.length} 项资产)`);
    for (const l of r.leaks) console.log(`      ${l.asset_id} ← ${l.where ?? l.from ?? "(来源见 why)"}`);
  }
}
