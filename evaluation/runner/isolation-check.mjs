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
/**
 * 只留下属于这个 agent 的文件。
 *
 * 快照取的是整棵 `profiles/`,里面还有别的 agent。别人的记忆到不了本次运行的模型,
 * 把它算进基线会得到一个永远不干净的结论,而真正该看的那一份被淹没。目录名是
 * `team%3A<team>%7Cagent%3A<agent>`,按 `agent%3A<id>` 前缀过滤。
 */
export function onlyAgent(files, agentId) {
  if (!agentId) return files ?? [];
  const needle = `agent%3A${agentId}`;
  return (files ?? []).filter((f) => String(f?.path ?? "").includes(needle));
}

export function baselineFindings(files, tokens, watchPatterns) {
  const hits = [], invalid = [], unscanned = [];

  // 模式先编译一次。编译失败的原来被 `catch { continue; }` 丢掉,于是"唯一的模式
  // 没编译成功"和"扫过了什么也没有"给出同一个答案 clean=true。没扫成是**未知**。
  const compiled = [];
  for (const p of watchPatterns ?? []) {
    if (!p) continue;
    try { compiled.push([p, new RegExp(p, "i")]); } catch { invalid.push(p); }
  }

  for (const f of files ?? []) {
    // text 为 null 表示这个文件根本没读(太大、二进制、读失败)。它不是"没有命中"。
    if (f?.text === null || f?.text === undefined) {
      unscanned.push({ path: f?.path ?? "(未命名)", bytes: f?.skipped_bytes ?? null, why: f?.why ?? "未读取" });
      continue;
    }
    const text = String(f.text);
    for (const t of tokens ?? []) {
      if (!t) continue;
      if (text.toLowerCase().includes(String(t).toLowerCase())) hits.push({ path: f.path, needle: t, kind: "token" });
    }
    for (const [p, re] of compiled) if (re.test(text)) hits.push({ path: f.path, needle: p, kind: "watch" });
  }

  // 已发现的污染是确定的,先于未知;都没有才是干净。
  const clean = hits.length ? false : (invalid.length || unscanned.length ? null : true);
  return { clean, hits, invalid_patterns: invalid, unscanned };
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
  const unknown = [...(batch?.unknown ?? [])];

  if (baseline && baseline.clean === false) failed.push("baseline_clean");
  if (baseline && baseline.clean === null) {
    // 没扫成不是"没过",也不是"过了"。把原因带上,否则未知会被读成噪音。
    const why = [
      ...(baseline.invalid_patterns ?? []).map((p) => `观察模式 ${JSON.stringify(p)} 编译失败`),
      ...(baseline.unscanned ?? []).map((u) => `${u.path} 未扫描`),
    ];
    unknown.push(`baseline_clean:${why.join(";") || "原因未记录"}`);
  }
  // 一次基线内容都没查过,同样是未知——不查等于没发现,不等于干净。
  if (!baseline) unknown.push("baseline_clean:没有任何一次运行保存了基线内容");

  if (batch?.same_baseline === false) failed.push("same_baseline");
  if (batch?.rolled_back === false) failed.push("rolled_back");
  return { ok: failed.length === 0 && unknown.length === 0, failed, unknown };
}

// --- CLI ------------------------------------------------------------------

const MAX_SCAN_BYTES = 2_000_000;

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
        // 跳过的文件带 text: null 交出去,由 baselineFindings 记成未扫描。
        // 直接 continue 会让"太大没看"和"看过没有"变成同一个结果。
        if (st.size > MAX_SCAN_BYTES) { out.push({ path: `${rel}${e}`, text: null, skipped_bytes: st.size, why: "超过扫描上限" }); continue; }
        try { out.push({ path: `${rel}${e}`, text: readFileSync(p, "utf8") }); }
        catch (err) { out.push({ path: `${rel}${e}`, text: null, skipped_bytes: st.size, why: `读取失败:${err.code ?? err.message}` }); }
      }
    };
    walk(dir, "");
    return out;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const watchPath = (args.find((a) => a.startsWith("--watch=")) ?? "").slice(8);
  const agentId = (args.find((a) => a.startsWith("--agent=")) ?? "").slice(8);
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
    const all = filesInTar(`${withTar.dir}/agent-memory-before.tar.gz`);
    const scoped = onlyAgent(all, agentId);
    baseline = baselineFindings(scoped, tokens, watchPatterns);
    baseline.files_scanned = scoped.length;
    baseline.files_in_snapshot = all.length;
  }

  const batch = batchIsolation(runs);
  const v = isolationVerdict({ baseline, batch });

  console.log(`隔离验收 — ${runs.length} 次运行\n`);
  if (!baseline) {
    console.log("baseline_clean  未知    没有任何一次运行保存了 agent-memory-before.tar.gz");
  } else {
    const mark = baseline.clean === null ? "未知" : baseline.clean ? "通过" : "未过";
    console.log(`baseline_clean  ${mark}    基线来自 ${withTar.run_id};token ${tokens.length} 个,观察模式 ${watchPatterns.length} 条`);
    console.log(`                       扫了 ${baseline.files_scanned} 个文件${agentId ? `(限 agent ${agentId})` : ""},快照共 ${baseline.files_in_snapshot} 个`);
    for (const h of baseline.hits.slice(0, 12)) console.log(`                       [${h.kind}] ${JSON.stringify(h.needle)} ← ${h.path}`);
    if (baseline.hits.length > 12) console.log(`                       …另有 ${baseline.hits.length - 12} 处`);
    for (const p of baseline.invalid_patterns) console.log(`                       [未扫] 观察模式 ${JSON.stringify(p)} 编译失败,这条根本没查`);
    for (const u of baseline.unscanned.slice(0, 8)) console.log(`                       [未扫] ${u.path}(${u.why}${u.bytes ? `,${u.bytes} 字节` : ""})`);
    if (baseline.unscanned.length > 8) console.log(`                       …另有 ${baseline.unscanned.length - 8} 个文件未扫描`);
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
