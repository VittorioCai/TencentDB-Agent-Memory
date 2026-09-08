#!/usr/bin/env node
/**
 * Calibration over saved runs, recomputed from the raw record every time.
 *
 *   node evaluation/attribution/calibrate-runs.mjs evaluation/runner/runs/2026*-gate-*
 *   node evaluation/attribution/calibrate-runs.mjs --frozen=gate-rules-2026-09-08f <runs…>
 *
 * Nothing here is read from a previous report: the verdicts come from the
 * capture, the judgements from the run's own events, and what each run was
 * measured under — rules version, baseline, model, asset version — from the
 * run directory. A report that cannot be regenerated from the raw data is a
 * claim, not a measurement.
 */
import { readFileSync, existsSync } from "node:fs";
import { auditDelivery, attributionFromCapture, operationFromTargetRef, verifyCoverage } from "./delivery-audit.mjs";
import { calibrate, renderCalibration } from "./calibration.mjs";

const readJson = (p, fallback = null) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback);
const readLines = (p) => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

export function runInput(dir) {
  const rows = readFileSync(`${dir}/capture.jsonl`, "utf8").split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const coverage = verifyCoverage(rows);
  const requests = rows.filter((o) => o.event === "http.request");
  const tokens = readJson(`${dir}/tokens.json`, {}) ?? {};
  const run = readJson(`${dir}/run.json`, {}) ?? {};
  const baseline = readJson(`${dir}/gate_baseline.json`, {}) ?? {};

  let operation = null;
  for (const e of readLines(`${dir}/used-events.jsonl`)) {
    const op = operationFromTargetRef(e.target_ref, requests);
    if (op && (!operation || op.request < operation.request || (op.request === operation.request && op.index < operation.index))) operation = op;
  }
  const audit = auditDelivery(requests, tokens, {
    operation, attributionOf: attributionFromCapture(requests), coverageAsserted: coverage.complete,
  });

  const used = new Set(readLines(`${dir}/used-events.jsonl`).map((e) => e.asset_id));
  // Two mechanisms, two records. The Core gate writes the asset's `status`,
  // so hidden reads as `failed`; the earlier batches flipped `visibility`
  // from outside, so hidden reads as `private`. Reading only the first made
  // three gate-on runs in batch 1 look not-hidden — and a leak in one of
  // them would have been filed as a clean true negative.
  const hiddenOf = (assetId) => {
    const st = run.gate?.status_at_start;
    if (st && assetId in st) return st[assetId] === "failed";
    const vis = run.gate?.visibility_at_start;
    if (vis && assetId in vis) return vis[assetId] === "private";
    return null;
  };
  const model = (rows.map((r) => /"model"\s*:\s*"([^"]+)"/.exec(JSON.stringify(r.body ?? "")))
    .find(Boolean) ?? [])[1] ?? null;

  const assets = {};
  for (const [assetId, spec] of Object.entries(tokens)) {
    assets[assetId] = {
      judgedUsed: used.has(assetId),
      // Hidden means the gate had put it out of reach for this run — and
      // null means the run did not record the gate at all, which is not the
      // same as "not hidden" (2026-09-08m).
      hidden: hiddenOf(assetId),
      verdict: audit.assets[assetId]?.verdict ?? "not_seen_in_capture",
      coverageAsserted: coverage.complete,
      asset_version: spec?.version ?? null,
    };
  }
  return {
    run_id: run.run_id ?? dir.split("/").pop(), label: run.label ?? null,
    rules_version: baseline.rules_version ?? null,
    started_at: run.started_at ?? null,
    baseline_frozen_at: run.gate?.baseline_frozen_at ?? baseline.frozen_at ?? null,
    model, run_verdict: (readJson(`${dir}/verdict.json`, {}) ?? {}).verdict ?? null, capture_complete: coverage.complete, coverage_reasons: coverage.reasons,
    // Marked by the runner when a source outside the frozen pool was written
    // during the batch this run belongs to; such a run is not an independent
    // sample and must not be counted as one.
    contaminated: !!run.contaminated_by, contaminated_by: run.contaminated_by ?? null,
    assets,
  };
}

/**
 * The whole report, table and prose together. Two rounds running, a summary
 * written by hand fell behind the tree — and the cell it got wrong was
 * "isolation failures", the one cell the table exists for. So the document
 * is generated: the numbers in it cannot disagree with the code that
 * produced them, because nothing types them twice.
 */
export function report(result, { frozen, runs } = {}) {
  const contaminated = (runs ?? []).filter((r) => r.contaminated).map((r) => r.run_id);
  return `# 归因判定的校准

判定器说某个资产"被使用了"。这份报告问:**内容真的到达模型了吗,而且早于被判定的那次操作?**

两侧都从原始记录重算,不读任何既有报告:送达来自捕获(\`delivery-audit.mjs\`),判定来自每次运行自己的事件文件,规则版本、基线、模型、资产版本来自 run 目录。**这份文档本身由脚本生成**,所以表里的数字不可能和代码不一致:

\`\`\`bash
node evaluation/attribution/calibrate-runs.mjs --frozen=${frozen ?? "<rules version>"} \\
  --md=evaluation/attribution/CALIBRATION.md evaluation/runner/runs/2026*-gate-*/
\`\`\`

生成于 ${new Date().toISOString()}。

## 判据

**判定错误与隔离失效是两件事**,合并统计会同时美化两者。

| 情形 | 归类 | 为什么 |
|---|---|---|
| 被隐藏 + 确认未送达 + 判 used | **假阳性** | 判定器错了 |
| 被隐藏 + 实际送达(**来路不限**) | **隔离失败** | 判 used 是对的,失效的是实验设置 |
| 说不清(覆盖不足 / 来源无法识别 / 全部到达都晚于操作) | **未定** | 不计入任一侧 |

"来路不限"是要点:来源**已识别但不是本资产**(知识文件、缓存的工具结果、另一个技能)仍然是到达,隐藏时就是泄漏;只有来源**无法识别**才算未定。曾经把这两者合成一类,批次三唯一一次真实泄漏因此从表里消失。

判定一个资产是否到达时,**操作之前的每一次到达都要看**,不是只看第一次:一次更早的他源到达会遮住随后一次真实的资产读取,结论可能碰巧对,依据却不成立。每次到达各自判回显与归因,再合成。

## 结果

${result.table}

${contaminated.length ? `## 受污染的运行

${contaminated.map((r) => `- \`${r}\``).join("\n")}

这些运行的输入被同批次更早的运行改写过,不是独立样本。
` : ""}
## 这份数字测的是什么,不是什么

**测的**:归因判定与内容送达是否一致——判定器有没有凭空说"用了"。

**不测的**:这个资产是否真的帮助了任务。送达且被判使用,不等于它起了作用。

**冻结规则那一行至今没有任何反例。** 累计里的数字来自多个规则集,读者容易以为反例问题已经解决——没有。能验证 \`${frozen ?? "冻结规则"}\` 的只有批次三,而它 FP 0、FN 0,一个反例都没有。累计准确率不能替它作证。

**假阴性一列至今是 0,而这件事本身需要解释。** \`未判 used + 内容已到达\` 这条分支从未触发,意味着到目前为止**只要内容到达,判定器就判 used**。如果确实如此,那它测的是**送达**,而不是**使用**——恰恰是本课题要区分的东西。要让这一列从"是 0"变成"可达而恰好是 0",需要构造"模型确实读了资产,但操作不使用它"的场景。

**判据是保守的**:说不清一律未定。真实错误率**不会被低估**,但可测样本会变小。

**规则版本未记录的批次**只能描述旧规则下的历史,不能验证冻结的规则。
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const frozen = (args.find((a) => a.startsWith("--frozen=")) ?? "").slice(9) || null;
  const mdOut = (args.find((a) => a.startsWith("--md=")) ?? "").slice(5) || null;
  const dirs = args.filter((a) => !a.startsWith("--"));
  if (!dirs.length) { console.error("usage: calibrate-runs.mjs [--frozen=<rules version>] [--md=<file>] <run dir> …"); process.exit(2); }
  const runs = dirs.map(runInput);
  const result = calibrate(runs);
  const table = renderCalibration(result, { frozenRules: frozen });
  if (mdOut) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(mdOut, report({ ...result, table }, { frozen, runs }));
    console.error(`written → ${mdOut}`);
  }
  console.log(table);
  console.log("\n## Per run\n");
  console.log("| run | rules | model | run verdict | capture | asset | hidden | judged used | delivery | bucket |");
  console.log("|---|---|---|---|---|---|---|---|---|---|");
  for (const r of result.rows) {
    const src = runs.find((x) => x.run_id === r.run_id);
    console.log(`| ${r.run_id} | ${r.rules_version ?? "—"} | ${r.model ?? "—"} | ${r.run_verdict ?? "—"} | ${src?.capture_complete ? "complete" : "INCOMPLETE"} | ${r.asset_id} | ${r.hidden === null ? "unknown" : r.hidden} | ${r.judged_used} | ${r.delivery} | ${r.bucket} |`);
  }
}
