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
import { auditDelivery, attributionFromCapture, operationFromTargetRef, operationFromAcceptance, verifyCoverage } from "./delivery-audit.mjs";
import { calibrate, renderCalibration, calibrateUsage, renderUsage } from "./calibration.mjs";
import { adoptionFromAcceptance } from "./adoption.mjs";

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

  // Acceptance first: it records the attempt the task was judged on, and it
  // is there whether or not the attribution judge said anything. Falling back
  // to the used-event's target_ref made a false negative unreachable, since a
  // run with no "used" verdict has no such event (2026-09-09).
  let operation = operationFromAcceptance(readJson(`${dir}/verdict.json`, null), requests);
  if (!operation) {
    for (const e of readLines(`${dir}/used-events.jsonl`)) {
      const op = operationFromTargetRef(e.target_ref, requests);
      if (op && (!operation || op.request < operation.request || (op.request === operation.request && op.index < operation.index))) operation = op;
    }
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

  // 采纳的参考判定来自验收记录,不来自 delivery,也不来自待测的判定器。
  const verdictJson = readJson(`${dir}/verdict.json`, null);
  const adoption = adoptionFromAcceptance(verdictJson, tokens);

  const assets = {};
  for (const [assetId, spec] of Object.entries(tokens)) {
    assets[assetId] = {
      judgedUsed: used.has(assetId),
      // 采纳与收益:证据不足时保持 null,不折叠成 false。
      adopted: adoption[assetId]?.adopted ?? null,
      benefited: adoption[assetId]?.benefited ?? null,
      adoption_why: adoption[assetId]?.why ?? null,
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
 * 整份报告——表格和正文一起——都由计算结果生成。
 *
 * 表格早就是生成的,正文却还是写死的散文,里面有"FP 0、FN 0,一个反例都没有"
 * "假阴性一列是 0""真实错误率不会被低估"这种断言。换一批数据,表格会变,这些句子
 * 不会变,报告就会一边列出反例、一边宣称没有反例。写死的结论比写错的数字更难发现:
 * 数字有人核,散文没人核。所以正文里每一句结论性的话都从当次数字推出。
 */
const n = (x) => (x === null || x === undefined ? "—" : String(x));

/** 取要讲的那一组:优先冻结规则那一行,没有就用累计。 */
function pickSet(result, frozen) {
  if (frozen && result?.by_rules_version?.[frozen]) return { name: `规则 ${frozen}`, t: result.by_rules_version[frozen] };
  return { name: "累计", t: result?.cumulative ?? {} };
}

/** 由数字推出的结论句;没有可评样本时不给准确率,也不谈错误率上下界。 */
function verdictSentences(name, t) {
  const fp = t.false_positive ?? 0, fn = t.false_negative ?? 0;
  const rated = t.decisions_rated ?? 0, total = t.decisions_total ?? 0;
  if (!rated) {
    return [
      `**${name} 没有可评样本**(可评 0 / 共 ${total})。`,
      "分母为零,所以这里不给出准确率,也不对错误率作任何保证——没有测到东西的时候,任何比率都是凭空的。",
    ];
  }
  const L = [`**${name}**:可评 ${rated}/${total},假阳性 ${fp} 个,假阴性 ${fn} 个,准确率 ${n(t.accuracy)}。`];
  if (fp || fn) {
    L.push(`已经出现反例:假阳性 ${fp} 个、假阴性 ${fn} 个。反例的成因要逐条查清,不能只看比率。`);
  } else {
    L.push(`这一组里假阳性 0 个、假阴性 0 个。在几乎没有反例的集合上,准确率的信息量有限——它说明"没发现判定器凭空判定",不说明"判定器在困难情形下也对"。`);
  }
  L.push(`判据保守:说不清一律不计入分母,所以在**已可评的 ${rated} 项**里错误率不会被低估,代价是可评样本变小。`);
  return L;
}

export function report(result, { frozen, runs, usage, codeHashes } = {}) {
  const contaminated = (runs ?? []).filter((r) => r.contaminated).map((r) => r.run_id);
  const d = pickSet(result, frozen);
  const u = usage ? pickSet(usage, frozen) : null;
  const ut = u?.t ?? {};
  const starts = (runs ?? []).map((r) => r.started_at).filter(Boolean).sort();
  const hiddenUnknown = (result?.rows ?? []).filter((r) => r.hidden === null).length;
  const captureBad = (runs ?? []).filter((r) => r.capture_complete === false).length;

  return `# 归因判定的校准

判定器说某个资产"被使用了"。这份报告把**三件事分开问**,因为它们的证据不同:

| 问题 | 证据来源 |
|---|---|
| **送达** —— 内容是否到达模型 | 捕获(\`delivery-audit.mjs\`) |
| **采纳** —— 操作是否实际用了它 | 验收记录 \`verdict.json\` 的 attempts(\`adoption.mjs\`) |
| **收益** —— 用了以后是否奏效 | 该次尝试的结果 \`attempt.ok\` |

采纳的参考判定**不由 delivery 推出,也不由待测的判定器推出**,否则就是拿判定器给自己打分。

**这份文档本身由脚本生成**,表格和正文里的结论都出自同一次计算:

\`\`\`bash
node evaluation/attribution/calibrate-runs.mjs --frozen=${frozen ?? "<rules version>"} \\
  --md=evaluation/attribution/CALIBRATION.md evaluation/runner/runs/2026*-gate-*/
\`\`\`

生成于 ${new Date().toISOString()}。

## 这次分析的口径

- **分析代码**:${codeHashes ? Object.entries(codeHashes).map(([f, h]) => `\`${f}\` @ ${h}`).join("、") : "(未记录)"}
- **规则版本**:${frozen ?? "(未指定冻结规则)"}
- **数据范围**:${(runs ?? []).length} 次运行${starts.length ? `,${starts[0]} → ${starts[starts.length - 1]}` : ""}
- **未知项(全数据范围,非仅冻结组)**:送达说不清 ${n(result?.cumulative?.unsettled)} 项;采纳无证据 ${n(usage?.cumulative?.unknown_adoption)} 项;隐藏状态未记录 ${hiddenUnknown} 项;捕获不完整 ${captureBad} 次

## 判据

**判定错误与隔离失效是两件事**,合并统计会同时美化两者。

| 情形 | 归类 | 为什么 |
|---|---|---|
| 被隐藏 + 确认未送达 + 判 used | **假阳性** | 判定器错了 |
| 被隐藏 + 实际送达(**来路不限**) | **隔离失败** | 判 used 是对的,失效的是实验设置 |
| 说不清(覆盖不足 / 来源无法识别 / 全部到达都晚于操作) | **未定** | 不计入任一侧 |

"来路不限"是要点:来源**已识别但不是本资产**(知识文件、缓存的工具结果、另一个技能)仍然是到达,隐藏时就是泄漏;只有来源**无法识别**才算未定。

判定一个资产是否到达时,**操作之前的每一次到达都要看**,不是只看第一次:一次更早的他源到达会遮住随后一次真实的资产读取,结论可能碰巧对,依据却不成立。

使用检测这一侧的判据不同,参考判定是**采纳**:

| 情形 | 归类 |
|---|---|
| 确已采用 + 判已使用 | 真阳性 |
| 确已采用 + 判未使用 | 假阴性 |
| 未采用 + 判已使用 | 假阳性 |
| 未采用 + 判未使用 | **真阴性**(判对了,不是漏报) |
| 采纳情况未知 | **单独一类**,不进分母 |

## 送达一致性

这张表问的是:判定器有没有凭空说"用了"。
它衡量的是判定与**送达**是否一致。
不能把它当作实际使用的准确率——那要看下一节。

${result.table}

${verdictSentences(d.name + " · 送达一致性", d.t).join("\n\n")}

${usage ? `## 实际使用(参考判定 = 采纳)

${usage.table}

${verdictSentences(u.name + " · 使用检测", ut).join("\n\n")}

**采纳证据的覆盖率是 ${n(ut.adoption_coverage)}**,其中 ${n(ut.unknown_adoption)} 项没有独立证据可判,已单独计为"采纳未知",没有进分母。

### 收益不等于采纳

采纳且奏效 ${n(ut.adopted_and_worked)} 项,采纳但未奏效 ${n(ut.adopted_but_failed)} 项,采纳而收益未知 ${n(ut.adopted_benefit_unknown)} 项。
资产被用上了不代表它帮到了任务;这一列就是把两者分开看的地方。
` : ""}
${contaminated.length ? `## 受污染的运行

${contaminated.map((r) => `- \`${r}\``).join("\n")}

这些运行的输入被同批次更早的运行改写过,不是独立样本。
` : ""}
## 这份数字测的是什么,不是什么

**测的**:上面两件事——判定与送达是否一致,判定与采纳是否一致。

**不测的**:这个资产对任务的贡献有多大。采纳且奏效,也不等于换一个资产就做不成。

**规则版本未记录的批次**只能描述旧规则下的历史,不能验证冻结的规则。

**未知项不是零**:上面"这次分析的口径"里列出的每一类未知,都是这批数据没能测到的部分,不能读作"没有问题"。
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
  const usage = calibrateUsage(runs);
  const table = renderCalibration(result, { frozenRules: frozen });
  const usageTable = renderUsage(usage, { frozenRules: frozen });
  if (mdOut) {
    const { writeFileSync } = await import("node:fs");
    const { createHash } = await import("node:crypto");
    // 记下产出这份报告的分析代码本身,而不是仓库 HEAD:报告在提交之前生成,
    // 写 HEAD 会指向上一个提交。文件哈希指的就是当次真正跑的那段代码。
    const codeHashes = {};
    for (const f of ["delivery-audit.mjs", "adoption.mjs", "calibration.mjs", "calibrate-runs.mjs"]) {
      codeHashes[f] = createHash("sha256").update(readFileSync(new URL(f, import.meta.url))).digest("hex").slice(0, 12);
    }
    writeFileSync(mdOut, report({ ...result, table }, { frozen, runs, usage: { ...usage, table: usageTable }, codeHashes }));
    console.error(`written → ${mdOut}`);
  }
  console.log("## 送达一致性\n");
  console.log(table);
  console.log("\n## 实际使用(参考判定 = 采纳)\n");
  console.log(usageTable);
  console.log("\n## Per run\n");
  console.log("| run | rules | model | run verdict | capture | asset | hidden | judged used | delivery | 送达桶 | adopted | benefited | 使用桶 |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  const uBy = new Map(usage.rows.map((r) => [`${r.run_id}|${r.asset_id}`, r]));
  for (const r of result.rows) {
    const src = runs.find((x) => x.run_id === r.run_id);
    const ur = uBy.get(`${r.run_id}|${r.asset_id}`) ?? {};
    const tri = (v) => (v === null || v === undefined ? "unknown" : String(v));
    console.log(`| ${r.run_id} | ${r.rules_version ?? "—"} | ${r.model ?? "—"} | ${r.run_verdict ?? "—"} | ${src?.capture_complete ? "complete" : "INCOMPLETE"} | ${r.asset_id} | ${tri(r.hidden)} | ${r.judged_used} | ${r.delivery} | ${r.bucket} | ${tri(ur.adopted)} | ${tri(ur.benefited)} | ${ur.bucket ?? "—"} |`);
  }
}
