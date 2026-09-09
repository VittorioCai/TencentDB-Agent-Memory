#!/usr/bin/env node
/**
 * 隔离验收:哈希相同只说明**起点一致**,不说明起点**干净**。
 *
 * 批次三的 gate-on 臂重跑过一次,五次都报 `isolated: true`,`hash_before` 与
 * `hash_after` 相同。那证明了五次从同一个记忆状态出发。但把那个状态解开来看,
 * 里面有 `47318`(4 个文件)、`10.244.7.19`(4 个文件),还有这次任务的 SOP 结论。
 * 五次运行彼此独立,而且**一致地被污染**——一致的污染不会在哈希比对里露头。
 *
 * 所以隔离分三条验,缺一条都不算通过:
 *
 *   baseline_clean   基线里没有 token,也没有被观察的结论行   ← 内容检查,原来缺的就是这条
 *   same_baseline    每次运行的 hash_before 相同
 *   rolled_back      每次运行的 hash_after == hash_before
 *
 * 没记 `agent_memory` 的运行是**未知**:既不算通过,也不谎称失败,单列出来。
 *
 * 用法:
 *   node evaluation/runner/isolation-check.mjs <run 目录…> [--watch=<confounders.watch>]
 *
 * 退出:0 三条全过且无未知 · 1 有未过或有未知 · 2 参数错
 */
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readdirSync, statSync } from "node:fs";

/**
 * 基线内容检查。token 是答案的一种形态,**结论行是另一种**:
 * "probe every documented candidate" 里没有任何 token,却把上一轮的发现讲全了。
 */
export function baselineFindings(files, tokens, watchPatterns) {
  const hits = [];
  for (const f of files ?? []) {
    const text = String(f?.text ?? "");
    for (const t of tokens ?? []) {
      if (!t) continue;
      if (text.toLowerCase().includes(String(t).toLowerCase())) hits.push({ path: f.path, needle: t, kind: "token" });
    }
    for (const p of watchPatterns ?? []) {
      if (!p) continue;
      let re; try { re = new RegExp(p, "i"); } catch { continue; }
      if (re.test(text)) hits.push({ path: f.path, needle: p, kind: "watch" });
    }
  }
  return { clean: hits.length === 0, hits };
}

/**
 * 哈希侧的两条。这个函数看不到基线内容,所以 `baseline_clean` 恒为 null ——
 * 它不替内容检查作答,免得"哈希都对"又一次被读成"隔离成立"。
 */
export function batchIsolation(runs) {
  const known = [], unknown = [];
  for (const r of runs ?? []) {
    const m = r?.agent_memory;
    if (!m || !m.hash_before) unknown.push(r?.run_id ?? "(无 run_id)");
    else known.push({ run_id: r.run_id, before: m.hash_before, after: m.hash_after ?? null });
  }
  const baselines = [...new Set(known.map((k) => k.before))];
  const notRolledBack = known.filter((k) => k.after !== k.before).map((k) => k.run_id);
  return {
    baseline_clean: null,
    // 有未知项时不得断言起点一致:没看到的那几次可能来自别的基线。
    same_baseline: unknown.length ? null : baselines.length === 1,
    baselines, rolled_back: notRolledBack.length === 0, not_rolled_back: notRolledBack,
    unknown, runs_checked: known.length,
  };
}

export function isolationVerdict({ baseline, batch }) {
  const failed = [];
  if (baseline && baseline.clean === false) failed.push("baseline_clean");
  if (batch?.same_baseline === false) failed.push("same_baseline");
  if (batch?.rolled_back === false) failed.push("rolled_back");
  const unknown = batch?.unknown ?? [];
  return { ok: failed.length === 0 && unknown.length === 0, failed, unknown };
}

// --- CLI ------------------------------------------------------------------

function filesInTar(tarPath) {
  const dir = mkdtempSync(join(tmpdir(), "isocheck-"));
  try {
    execFileSync("tar", ["xzf", tarPath, "-C", dir], { stdio: "ignore" });
    const out = [];
    const walk = (d, rel) => {
      for (const e of readdirSync(d)) {
        const p = join(d, e);
        let st; try { st = statSync(p); } catch { continue; }
        if (st.isDirectory()) { walk(p, `${rel}${e}/`); continue; }
        if (st.size > 2_000_000) continue;
        try { out.push({ path: `${rel}${e}`, text: readFileSync(p, "utf8") }); } catch { /* 二进制跳过 */ }
      }
    };
    walk(dir, "");
    return out;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const watchPath = (args.find((a) => a.startsWith("--watch=")) ?? "").slice(8);
  const dirs = args.filter((a) => !a.startsWith("--"));
  if (!dirs.length) { console.error("usage: isolation-check.mjs <run dirs…> [--watch=<confounders.watch>]"); process.exit(2); }

  const runs = dirs.map((d) => {
    const rj = existsSync(`${d}/run.json`) ? JSON.parse(readFileSync(`${d}/run.json`, "utf8")) : {};
    return { dir: d, run_id: rj.run_id ?? d.split("/").filter(Boolean).pop(), agent_memory: rj.agent_memory };
  });

  const watchPatterns = watchPath && existsSync(watchPath)
    ? readFileSync(watchPath, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
    : [];

  // 基线内容:取第一份存在的 agent-memory-before.tar.gz。批次内起点一致由
  // same_baseline 保证,所以查一份就够;起点不一致时那一条会先报出来。
  const withTar = runs.find((r) => existsSync(`${r.dir}/agent-memory-before.tar.gz`));
  let baseline = null, tokens = [];
  if (withTar) {
    const tj = existsSync(`${withTar.dir}/tokens.json`) ? JSON.parse(readFileSync(`${withTar.dir}/tokens.json`, "utf8")) : {};
    tokens = Object.values(tj).flatMap((s) => s?.tokens ?? []);
    baseline = baselineFindings(filesInTar(`${withTar.dir}/agent-memory-before.tar.gz`), tokens, watchPatterns);
  }

  const batch = batchIsolation(runs);
  const v = isolationVerdict({ baseline, batch });

  console.log(`隔离验收 — ${runs.length} 次运行\n`);
  if (!baseline) {
    console.log("baseline_clean  未知    没有任何一次运行保存了 agent-memory-before.tar.gz");
  } else {
    console.log(`baseline_clean  ${baseline.clean ? "通过" : "未过"}    基线来自 ${withTar.run_id};token ${tokens.length} 个,观察模式 ${watchPatterns.length} 条`);
    for (const h of baseline.hits.slice(0, 12)) console.log(`                       [${h.kind}] ${JSON.stringify(h.needle)} ← ${h.path}`);
    if (baseline.hits.length > 12) console.log(`                       …另有 ${baseline.hits.length - 12} 处`);
  }
  console.log(`same_baseline   ${batch.same_baseline === null ? "未知" : batch.same_baseline ? "通过" : "未过"}    起点哈希 ${batch.baselines.length} 种:${batch.baselines.map((b) => b.slice(0, 8)).join("、") || "(无)"}`);
  console.log(`rolled_back     ${batch.rolled_back ? "通过" : "未过"}    ${batch.not_rolled_back.length ? `未回滚:${batch.not_rolled_back.join("、")}` : "全部回滚"}`);
  if (batch.unknown.length) console.log(`未知            ${batch.unknown.length} 次运行没有记录 agent_memory:${batch.unknown.join("、")}`);
  console.log(`\n结论:${v.ok ? "隔离成立" : `不成立 — 未过 [${v.failed.join(", ") || "无"}]${v.unknown.length ? `,未知 ${v.unknown.length} 次` : ""}`}`);
  if (!v.ok && v.failed.includes("baseline_clean")) {
    console.log("\n哈希一致只说明每次从同一状态出发;这条不过,说明那个状态本身就带着答案。");
  }
  process.exit(v.ok ? 0 : 1);
}
