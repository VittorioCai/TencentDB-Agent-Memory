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
import { resolveTokens, plainTokensOrThrow } from "./resolve-tokens.mjs";

const readJson = (p, fallback = null) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback);
const readLines = (p) => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

/**
 * 这次运行是不是独立样本。
 *
 * 三种取值,不是两种:runner 在隔离改造之后才开始写 `agent_memory`,更早的运行
 * 根本没有这个字段——那是**未知**,不是 `isolated: false`,也不是 true。把未知
 * 折叠成"干净"正是本项目反复犯的那个错。
 *
 * `written_during_run` 为真同样算受污染:这次运行往记忆里写了东西,它之后的运行
 * 就不是从同一状态出发的。
 */
export function contaminationOf(run) {
  if (run?.contaminated_by) {
    return { contaminated: true, contaminated_by: run.contaminated_by, by: run.contaminated_by, why: "运行记录直接标注了污染来源" };
  }
  const m = run?.agent_memory;
  if (!m || typeof m.isolated !== "boolean") {
    return { contaminated: null, contaminated_by: null, by: null, why: "这次运行没有记录 agent_memory,隔离与否未知" };
  }
  if (m.written_during_run === true) {
    return { contaminated: true, contaminated_by: null, by: null, why: "运行期间写过记忆,之后的运行不再是同一起点" };
  }
  if (m.isolated === false) {
    return { contaminated: true, contaminated_by: null, by: null, why: "runner 记录 isolated=false" };
  }
  return { contaminated: false, contaminated_by: null, by: null, why: "runner 记录 isolated=true 且运行期间没有写入" };
}

/**
 * 把派生审计的结论合并进运行清单。
 *
 * 隔离配置未记录,和内容泄漏已确认,是两件**独立**的事实。缺前者不该抹掉后者:
 * `20260908T075637Z-gate-on-core` 早于隔离改造,没有 `agent_memory`,但它的捕获里
 * 泄漏是复算得到的确定结论。合并之后这次运行按**受污染**计(它不是独立样本),
 * 同时保留"隔离配置未记录"这个事实,两句一起讲。
 */
export function mergeIsolationFindings(runs, findingsDoc) {
  const byId = new Map((findingsDoc?.runs ?? []).map((r) => [r.run_id, r]));
  return (runs ?? []).map((r) => {
    const f = byId.get(r.run_id);
    if (!f?.leak_confirmed) return r;
    return {
      ...r,
      contaminated: true,
      contamination_why: "原始捕获复算确认内容由他源送达",
      isolation_recorded: f.isolation_recorded ?? null,
      leaks: f.leaks ?? [],
    };
  });
}

/** 哈希形态的清单(方案 2):有 token_sha256 而没有明文 tokens。 */
export function isHashManifest(tokens) {
  return Object.entries(tokens ?? {}).some(([k, v]) => !k.startsWith("_") && v && Array.isArray(v.token_sha256) && v.token_sha256.length && !(Array.isArray(v.tokens) && v.tokens.length));
}

/**
 * 一次运行的判别值明文。run 目录里只有哈希形态的清单(方案 2),分析前必须经解析契约
 * 按该运行冻结的(id、版本、内容哈希、token 哈希)从 Core 取回;失败即抛,不静默按空
 * tokens 分析(2026-09-11 审阅点 1:哈希清单直接喂给送达审计,正例静默变 not_delivered)。
 * 作者身份从 --task 目录的 pair.json 取;明文形态的老运行原样返回。
 */
/**
 * Which row a run belongs to.
 *
 * The formal sample is the batch manifest (`batch4-runs.json`: the ten run ids
 * the interleaved batch actually produced), not "every run whose baseline says
 * batch 4" — the trial pair and the preparation runs carry the same baseline
 * and were being counted into the sample (28 decisions instead of 20,
 * 2026-09-11). A run named in the manifest is the sample whatever its label;
 * preparation runs (label *-prep) are the evidence base; the trial pair
 * (label trial-*) is the checkpoint pair; anything else under that batch is
 * listed apart, never folded in. Older batches without a manifest keep their row.
 */
/** The same run listed twice (overlapping globs) is one run. Trailing slashes do not make a new one. */
export function uniqueDirs(list) {
  return [...new Set((list ?? []).map((d) => String(d).replace(/\/+$/, "")))];
}

export function experimentOf({ label, run_id, base, manifest = null }) {
  const l = String(label ?? "");
  const ownBatch = manifest && base === `batch${manifest.batch}`;
  if (ownBatch) {
    const ids = new Set((manifest.runs ?? []).map((r) => r?.run_id ?? r));
    if (ids.has(run_id)) return base;
  }
  if (/(^|-)prep$/.test(l)) return `${base}-prep (evidence base, not a sample)`;
  if (/(^|-)trial(-|$)/.test(l)) return `${base}-trial (checkpoint pair, not a sample)`;
  if (ownBatch) return `${base}-other (not in the formal manifest)`;
  return base;
}

export async function loadRunTokens(dir, { taskDir = null, keyFile } = {}) {
  const manifest = readJson(`${dir}/tokens.json`, {}) ?? {};
  if (!isHashManifest(manifest)) return manifest;
  const pair = taskDir ? (readJson(`${taskDir}/pair.json`, {}) ?? {}) : {};
  const resolved = await resolveTokens({ tokens: manifest, pair }, { keyFile });
  return plainTokensOrThrow(resolved);
}

export function runInput(dir, opts = {}) {
  const rows = readFileSync(`${dir}/capture.jsonl`, "utf8").split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const coverage = verifyCoverage(rows);
  const requests = rows.filter((o) => o.event === "http.request");
  const manifest = readJson(`${dir}/tokens.json`, {}) ?? {};
  const tokens = opts.tokens ?? manifest;
  if (isHashManifest(tokens)) {
    throw new Error(`${dir}: tokens.json 是哈希形态,分析前必须经解析契约取回明文(loadRunTokens / resolve-tokens.mjs);直接分析会静默丢掉归因`);
  }
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
  // tokens.json 里以 "_" 开头的键是说明,不是资产(2026-09-10 冒烟运行的表里冒出过
  // `_why` 一行)。资产 id 从不以 "_" 开头。
  for (const [assetId, spec] of Object.entries(tokens)) {
    if (assetId.startsWith("_")) continue;
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
      // 送达判定所依据的那条 finding 原样带出来,派生审计要引用它的证据位置与来源,
      // 不重新叙述。见 derive-isolation-findings.mjs。
      delivery_finding: (audit.assets[assetId]?.findings ?? [])
        .find((f) => f.verdict === audit.assets[assetId]?.verdict) ?? null,
      coverageAsserted: coverage.complete,
      asset_version: spec?.version ?? null,
    };
  }
  // 实验标识:同一规则下把不同实验(换 token / 消费者 / 资产版本)分开。有批次号
  // 用批次号;没有的老运行用冻结时刻或起跑日期,标成 pre-batch,各自成行。
  const experimentBase = baseline.batch != null
    ? `batch${baseline.batch}`
    : baseline.frozen_at
      ? `pre-batch (frozen ${String(baseline.frozen_at).slice(0, 10)})`
      : run.started_at
        ? `pre-batch (${String(run.started_at).slice(0, 10)})`
        : "unknown";
  const runId = run.run_id ?? dir.split("/").pop();
  const experiment = experimentOf({ label: run.label, run_id: runId, base: experimentBase, manifest: opts.manifest ?? null });
  return {
    run_id: runId, label: run.label ?? null,
    rules_version: baseline.rules_version ?? null,
    experiment,
    started_at: run.started_at ?? null,
    baseline_frozen_at: run.gate?.baseline_frozen_at ?? baseline.frozen_at ?? null,
    model, run_verdict: (readJson(`${dir}/verdict.json`, {}) ?? {}).verdict ?? null, capture_complete: coverage.complete, coverage_reasons: coverage.reasons,
    // 隔离状态。原来读的是 `run.contaminated_by`,而 runner 从没写过这个字段
    // (runs/ 下 0/42),写的是 `agent_memory`。于是 `!!undefined` 对每一次运行
    // 都是 false,"受污染的运行"一节永远不会出现。见 contaminationOf。
    ...contaminationOf(run),
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
  // 原来这里写着"所以错误率不会被低估"。那句话由 rated>0 控制,但它本身没有被
  // 计算过,也不成立:被排除的项是否恰好富含错误,这批数据答不了;而"已可评的项里
  // 不会低估"还依赖参考判定本身没出错——采纳判定的子串误命中(2026-09-09 D1)正是
  // 它出错的例子。改成给出被排除的实际数量,不作保证。
  const excluded = Math.max(0, total - rated);
  L.push(excluded
    ? `说不清的 ${excluded} 项不计入分母(共 ${total} 项,可评 ${rated} 项)。上面的比率只描述这 ${rated} 项;被排除的 ${excluded} 项既没有算判对也没有算判错,它们是否恰好富含错误,这批数据答不了。`
    : `这一组 ${total} 项全部可评,没有项被排除在分母之外。`);
  return L;
}

export function report(result, { frozen, runs, usage, codeHashes } = {}) {
  const contaminatedRuns = (runs ?? []).filter((r) => r.contaminated === true);
  const isolationUnknown = (runs ?? []).filter((r) => r.contaminated === null).map((r) => r.run_id);
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

${(() => {
  // 泄漏来的 TP:采纳判 TP、而同一 (run, asset) 的送达桶是 isolation_failure。这类
  // TP 证明的是"泄漏进来的东西被用了",不是"闸门放行的东西被用了",必须分开点名。
  const leak = new Set((result?.rows ?? []).filter((r) => r.bucket === "isolation_failure").map((r) => `${r.run_id}|${r.asset_id}`));
  const leakedTPs = (usage?.rows ?? []).filter((r) => r.bucket === "true_positive" && leak.has(`${r.run_id}|${r.asset_id}`));
  if (!leak.size) return "没有送达桶为隔离失败的运行,所以没有 TP 来自泄漏。";
  return `**其中 ${leakedTPs.length} 个 TP 来自隔离失败的运行**(资产被藏起、内容经别的通道到达后被采用):${leakedTPs.map((r) => `\`${r.run_id}\``).join("、") || "(无)"}。这类 TP 说明"泄漏进来的东西被用了",不说明"闸门放行的东西被用了",不能与干净的 TP 混算。`;
})()}

### 收益不等于采纳

采纳且奏效 ${n(ut.adopted_and_worked)} 项,采纳但未奏效 ${n(ut.adopted_but_failed)} 项,采纳而收益未知 ${n(ut.adopted_benefit_unknown)} 项。
资产被用上了不代表它帮到了任务;这一列就是把两者分开看的地方。
` : ""}
${contaminatedRuns.length || isolationUnknown.length ? `## 独立性

隔离**配置**(运行时有没有快照还原记忆)与内容**泄漏**(资产内容有没有从别处到达)是
两件独立的事实。配置没记录,不能抹掉已经复算出来的泄漏证据;反过来也不行。

${contaminatedRuns.length ? `**不是独立样本 ${contaminatedRuns.length} 次:**

${contaminatedRuns.map((r) => `- \`${r.run_id}\` —— ${r.contamination_why ?? "运行记录标注了污染"}${r.isolation_recorded ? `;隔离配置${r.isolation_recorded}` : ""}${(r.leaks ?? []).length ? `;来源 ${r.leaks.map((l) => l.where ?? l.from ?? "见派生审计").join("、")}` : ""}`).join("\n")}
` : "**没有一次运行被确认为非独立样本。**"}
${isolationUnknown.length ? `
**隔离配置未记录 ${isolationUnknown.length} 次** —— 这些运行早于隔离改造,没有 \`agent_memory\` 字段。未记录不等于干净:它们既不能算独立样本,也没有证据说不是。这 ${isolationUnknown.length} 次的捕获都经过了同一套他源送达复算,没有再查出泄漏;查不出不等于没有。
` : ""}
泄漏证据由 \`derive-isolation-findings.mjs\` 从原始捕获复算,写在
\`artifacts/isolation-findings.json\`,每条绑运行 id、捕获文件 sha256、消息位置与分析代码哈希。
\`runs/\` 下的原始记录未改动。
` : ""}
## 这份数字测的是什么,不是什么

**测的**:上面两件事——判定与送达是否一致,判定与采纳是否一致。

**不测的**:这个资产对任务的贡献有多大。采纳且奏效,也不等于换一个资产就做不成。

**规则版本未记录的批次**只能描述旧规则下的历史,不能验证冻结的规则。

**未知项不是零**:上面"这次分析的口径"里列出的每一类未知,都是这批数据没能测到的部分,不能读作"没有问题"。

## 威胁模型

评测的模型与 harness 同主机、同用户运行,模型手里有 shell。判别值的隔离靠"找不到"
而不是"打不开":判别值明文只放在 Core 的资产正文里,仓库里只有 sha256,运行记录写在
仓库外,harness 进程的 cwd 不落在仓库——但这些都是同一用户下的文件,一句 \`chmod\` 或
一次 \`lsof\` 枚举进程就能回退。一个刻意枚举进程、读 harness 文件的模型**可以**突破这层
隔离;能挡住的是不对抗、只是"资产被藏起后去别处找答案"的模型。

关键在于:**突破会被记下来**。闸门本身没有旁路——2026-09-10 的冒烟运行里,两条资产都被
闸门挡在池外,模型仍然拿到了判别值,不是因为闸门漏了,而是因为它 \`lsof\` 到探针进程的
cwd 是仓库,\`cd\` 进去读了评测自己的记录文件。送达审计把这次判成隔离失败(他源送达),
来源精确到第 24 轮那条 \`cd …/evaluation/tasks/bridge-addr && cat pair.json && cat tokens.json\`。
所以本评测的隔离主张是有边界的:它保证的是"闸门没有旁路;**已覆盖的通道**(捕获里的
工具结果、注入的系统提示与记忆、服务侧日志、运行记录、CodeBuddy 项目缓存)上的绕过可以
检测并定位;来源无法识别的到达**单列为未知**,不计入任一侧",不是"模型在同主机同用户下
无法物理接触到答案",也不是"所有通道都已覆盖"。要后者,需要把会话放进只通代理的
沙箱(见 REMAINING 的方案 3 spike:真实 CLI 是 npm 包 \`@tencent-ai/codebuddy-code\`,可进
Linux 容器;宿主上另有 \`sandbox-exec\` 可用)。
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const frozen = (args.find((a) => a.startsWith("--frozen=")) ?? "").slice(9) || null;
  const mdOut = (args.find((a) => a.startsWith("--md=")) ?? "").slice(5) || null;
  const dirs = uniqueDirs(args.filter((a) => !a.startsWith("--")));
  if (!dirs.length) { console.error("usage: calibrate-runs.mjs [--frozen=<rules version>] [--manifest=<batchN-runs.json>] [--md=<file>] <run dir> …"); process.exit(2); }
  const taskDir = (process.argv.slice(2).find((a) => a.startsWith("--task=")) ?? "").slice(7) || "evaluation/tasks/bridge-addr";
  // --manifest=<batchN-runs.json>:正式样本名单。主表只由名单里的 run id 生成;
  // 同批次不在名单里的运行(准备、试跑、其他)各自另列。
  const manifestPath = (args.find((a) => a.startsWith("--manifest=")) ?? "").slice(11) || null;
  const manifest = manifestPath ? readJson(manifestPath, null) : null;
  if (manifestPath && !manifest) { console.error(`--manifest 读不到:${manifestPath}`); process.exit(2); }
  const runs0 = [];
  for (const d of dirs) {
    // 哈希形态的运行先按冻结四元组取明文;解析失败就中止整份报告——报告不能在
    // 读错版本或读不到明文的情况下"照常"生成。
    const tokens = await loadRunTokens(d, { taskDir });
    runs0.push(runInput(d, { tokens, manifest }));
  }
  let runs = runs0;
  // 派生审计如果在,就把它的结论合并进来。它由原始捕获复算,不改原始记录。
  const findingsDoc = readJson(new URL("artifacts/isolation-findings.json", import.meta.url).pathname, null);
  runs = mergeIsolationFindings(runs, findingsDoc);
  const result = calibrate(runs);
  const usage = calibrateUsage(runs);
  // 主表按 (rules_version, 实验标识) 分组:同一规则下不同实验不并成一行,旧批次
  // 各自成行(2026-09-10)。cumulative 仍在最后一行,但它跨规则跨实验,只描述历史。
  const table = renderCalibration(result, { frozenRules: frozen, byExperiment: true });
  const usageTable = renderUsage(usage, { frozenRules: frozen, byExperiment: true });
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
  console.log("| run | rules | experiment | model | run verdict | capture | asset | hidden | judged used | delivery | 送达桶 | adopted | benefited | 使用桶 |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  const uBy = new Map(usage.rows.map((r) => [`${r.run_id}|${r.asset_id}`, r]));
  for (const r of result.rows) {
    const src = runs.find((x) => x.run_id === r.run_id);
    const ur = uBy.get(`${r.run_id}|${r.asset_id}`) ?? {};
    const tri = (v) => (v === null || v === undefined ? "unknown" : String(v));
    console.log(`| ${r.run_id} | ${r.rules_version ?? "—"} | ${r.experiment ?? "—"} | ${r.model ?? "—"} | ${r.run_verdict ?? "—"} | ${src?.capture_complete ? "complete" : "INCOMPLETE"} | ${r.asset_id} | ${tri(r.hidden)} | ${r.judged_used} | ${r.delivery} | ${r.bucket} | ${tri(ur.adopted)} | ${tri(ur.benefited)} | ${ur.bucket ?? "—"} |`);
  }
}
