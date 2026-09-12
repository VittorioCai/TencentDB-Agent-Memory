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
 * 这次运行的隔离**事实**,不是一句"独立 / 不独立"的判决(2026-09-12 第二人复核)。
 *
 * 原来把 `written_during_run === true` 直接判成"本次受污染"。那是推不出来的:本次写了
 * 记忆,只证明**之后**的运行不再从同一起点出发,不证明本次读过别的运行的内容;回滚失败
 * (`isolated === false`,即 hash_restored ≠ hash_before)同样是"现场没还原",不是"本次被污染"。
 * 所以这里分开四件事各自报告,谁也不顶替谁:
 *
 *   起点(hash_before)· 回滚是否成功 · 本次是否写入 · 是否有证据读到别的运行的内容
 *
 * 只有两种情况判 `contaminated: true`:运行记录直接标注了污染来源,或派生审计从原始捕获
 * 复算确认内容由他源送达(见 mergeIsolationFindings)。回滚成功且没写入才算 `independent: true`;
 * 其余一律 `independent: null` —— **未确认**,既不是干净也不是脏。
 */
export function contaminationOf(run) {
  const m = run?.agent_memory;
  const facts = {
    start_hash: m?.hash_before ?? null,
    rollback_ok: m && typeof m.isolated === "boolean" ? m.isolated : null,
    wrote_during_run: m && typeof m.written_during_run === "boolean" ? m.written_during_run : null,
    scope_files_before: m?.consumer_scope?.files_before ?? null,
  };
  if (run?.contaminated_by) {
    return { contaminated: true, contaminated_by: run.contaminated_by, by: run.contaminated_by, independent: false, memory_facts: facts, why: "运行记录直接标注了污染来源" };
  }
  if (facts.rollback_ok === null) {
    return { contaminated: null, contaminated_by: null, by: null, independent: null, memory_facts: facts, why: "这次运行没有记录 agent_memory:起点、回滚与写入都未知" };
  }
  if (facts.rollback_ok === true && facts.wrote_during_run === false) {
    return { contaminated: false, contaminated_by: null, by: null, independent: true, memory_facts: facts, why: "runner 记录回滚成功(hash_restored == hash_before)且运行期间没有写入" };
  }
  const parts = [];
  if (facts.rollback_ok === false) parts.push("回滚未成功(hash_restored ≠ hash_before):运行结束时现场没还原");
  if (facts.wrote_during_run === true) parts.push("运行期间写过记忆:之后的运行不再从同一起点出发");
  parts.push("这些事实不证明本次读过别的运行的内容,独立性未确认");
  return { contaminated: null, contaminated_by: null, by: null, independent: null, memory_facts: facts, why: parts.join(";") };
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
      independent: false,
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

/**
 * 取要讲的那一组。**优先正式样本组**(名单给出的那个实验),其次冻结规则的累计,最后总累计。
 * 2026-09-12 第二人复核:原来优先 `by_rules_version[frozen]`,它把同一规则下的准备运行与试跑
 * 一起算进去——表格分开列了 batch4 / batch4-prep / batch4-trial,正文却报了三者之和(28),
 * 读起来像是正式样本有 28 项。正式组是名单里的那 10 次运行、20 个判定项。
 */
function pickSet(result, frozen, formalKey) {
  if (formalKey && result?.by_experiment?.[formalKey]) {
    return { name: `规则 ${frozen} · ${String(formalKey).split(" · ").pop()}(正式样本组)`, t: result.by_experiment[formalKey], kind: "formal" };
  }
  if (frozen && result?.by_rules_version?.[frozen]) return { name: `规则 ${frozen}(累计,含准备与试跑)`, t: result.by_rules_version[frozen], kind: "rules" };
  return { name: "累计(含准备与试跑)", t: result?.cumulative ?? {}, kind: "cumulative" };
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

export function report(result, { frozen, runs, usage, codeHashes, manifest = null, command = null } = {}) {
  const contaminatedRuns = (runs ?? []).filter((r) => r.contaminated === true);
  const isolationUnknown = (runs ?? []).filter((r) => r.memory_facts && r.memory_facts.rollback_ok === null).map((r) => r.run_id);
  // 四件事实,各算各的(2026-09-12):起点、回滚、写入、是否读到别人的内容。
  const startHashes = [...new Set((runs ?? []).map((r) => r.memory_facts?.start_hash).filter(Boolean))];
  const scopeEmpty = (runs ?? []).filter((r) => r.memory_facts?.scope_files_before === 0).length || null;
  const rollbackOk = (runs ?? []).filter((r) => r.memory_facts?.rollback_ok === true);
  const rollbackBad = (runs ?? []).filter((r) => r.memory_facts?.rollback_ok === false);
  const wrote = (runs ?? []).filter((r) => r.memory_facts?.wrote_during_run === true);
  const leaked = (runs ?? []).filter((r) => r.contaminated === true);
  // 正式样本组的键:experimentOf 对名单里的运行返回 `batch<N>`,表格行名是 `<规则> · batch<N>`。
  const formalKey = frozen && manifest?.batch != null ? `${frozen} · batch${manifest.batch}` : null;
  const d = pickSet(result, frozen, formalKey);
  const u = usage ? pickSet(usage, frozen, formalKey) : null;
  const formalRuns = manifest?.runs?.length ?? (runs ?? []).length;
  const cum = result?.cumulative ?? {}, ucum = usage?.cumulative ?? null;
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
${command ?? `node evaluation/attribution/calibrate-runs.mjs --frozen=${frozen ?? "<rules version>"} <运行目录…>`}
\`\`\`

上面是**这次实际执行的命令**(2026-09-12 改:原来这里是一条固定模板,既没传正式样本名单
\`--manifest\`,通配符又匹配不到 \`…-b4-prep\` 这类准备运行,照抄复现不出这份报告)。运行目录
的位置随重判副本放在哪儿而变,所以数据范围按**运行 id** 列在下面,那才是这份报告的口径。

生成于 ${new Date().toISOString()}。

## 这次分析的口径

- **分析代码**:${codeHashes ? Object.entries(codeHashes).map(([f, h]) => `\`${f}\` @ ${h}`).join("、") : "(未记录)"}
- **规则版本**:${frozen ?? "(未指定冻结规则)"}
- **数据范围**:${(runs ?? []).length} 次运行${starts.length ? `,${starts[0]} → ${starts[starts.length - 1]}` : ""}${manifest ? `;其中正式样本 ${formalRuns} 次(名单 \`batch${manifest.batch}-runs.json\`)` : ""}
- **运行 id**:${(runs ?? []).length ? (runs ?? []).map((r) => `\`${r.run_id}\``).join("、") : "(无)"}
- **未知项(全数据范围,非仅冻结组)**:送达说不清 ${n(result?.cumulative?.unsettled)} 项;采纳无证据 ${n(usage?.cumulative?.unknown_adoption)} 项;隐藏状态未记录 ${hiddenUnknown} 项;捕获不完整 ${captureBad} 次

## 判据

**判定错误与隔离失效是两件事**,合并统计会同时美化两者。

| 情形 | 归类 | 为什么 |
|---|---|---|
| 被隐藏 + 确认未送达 + 判 used | **假阳性** | 判定器错了 |
| 被隐藏 + 实际送达(**来路不限**) | **隔离失败** | 实验隔离失效;使用判定是否正确,仍须由实际采纳证据判断 |
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

这张表的 FN 是"**已送达但未判使用**",不是使用检测的漏报:内容进了上下文,模型完全可以不采用。
使用判定是否漏报,看下一节(参考判定 = 采纳)。同理,隔离失败那一列只说明实验隔离失效,
不能反过来证明使用判定正确——两件事可以同时发生。

这一组 ${n(d.t.decisions_total)} 个判定项来自 ${formalRuns} 次运行(每次运行按资产分别判定),${n(d.t.decisions_total)} 个判定项不是 ${n(d.t.decisions_total)} 次独立实验。

累计(含准备运行、试跑等非正式样本)另计:送达 可评 ${n(cum.decisions_rated)}/${n(cum.decisions_total)}、准确率 ${n(cum.accuracy)}${ucum ? `;使用 可评 ${n(ucum.decisions_rated)}/${n(ucum.decisions_total)}、准确率 ${n(ucum.accuracy)}、采纳未知 ${n(ucum.unknown_adoption)}` : ""}。
累计跨实验跨样本性质,只描述历史,不作为验收结论。

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

${u?.kind === "formal" ? "正式样本组" : u?.name ?? "这一组"}:采纳且奏效 ${n(ut.adopted_and_worked)} 项,采纳但未奏效 ${n(ut.adopted_but_failed)} 项,采纳而收益未知 ${n(ut.adopted_benefit_unknown)} 项。${ucum && u?.kind === "formal" ? `
累计(含准备与试跑)则是 ${n(ucum.adopted_and_worked)} / ${n(ucum.adopted_but_failed)} / ${n(ucum.adopted_benefit_unknown)} 项——两组数字不能混着引。` : ""}
资产被用上了不代表它帮到了任务;这一列就是把两者分开看的地方。
` : ""}
${(runs ?? []).length ? `## 独立性:四件事分开说(2026-09-12 第二人复核后改写)

隔离**配置**、本次**写入**、**回滚**是否成功、有没有证据**读到**别的运行的内容,是四件不同的事实。
原来这一节把"运行期间写过记忆"直接算成"本次不是独立样本",那是推不出来的——写入影响的是**之后**的
运行,回滚失败说的是现场没还原;两者都不证明本次读过别人的东西。所以下面分开报,不给总判决。

| 事实 | 这批运行 | 说明 |
|---|---|---|
| 起点是否一致 | ${startHashes.length === 1 ? `一致(${(runs ?? []).length} 次运行记录的 hash_before 相同:\`${String(startHashes[0]).slice(0, 8)}\`)` : startHashes.length ? `${startHashes.length} 个不同的起点哈希` : "未记录"}${scopeEmpty != null ? `;消费者自己的记忆范围在 ${scopeEmpty}/${(runs ?? []).filter((r) => r.memory_facts?.scope_files_before != null).length} 次运行开始时为空` : ""} | 运行前先清消费者残留再取快照 |
| 回滚是否成功 | 回滚成功 ${rollbackOk.length} 次;**回滚未成功 ${rollbackBad.length} 次**${rollbackBad.length ? `(${rollbackBad.slice(0, 12).map((r) => `\`${r.run_id}\``).join("、")})` : ""} | hash_restored ≠ hash_before:结束时现场没还原,风险落在**之后**的运行 |
| 本次是否写入记忆 | 运行期间写入记忆 ${wrote.length} 次${wrote.length ? `(${wrote.slice(0, 12).map((r) => `\`${r.run_id}\``).join("、")})` : ""} | 写入只说明之后的运行不再从同一起点出发 |
| 是否读到别的运行的内容 | ${leaked.length ? `**确认 ${leaked.length} 次**(${leaked.map((r) => `\`${r.run_id}\``).join("、")})` : "已覆盖的扫描面上没有查出证据"} | 判别值泄漏由 \`derive-isolation-findings.mjs\` 从原始捕获复算 |
${isolationUnknown.length ? `| 隔离字段未记录 | ${isolationUnknown.length} 次(${isolationUnknown.slice(0, 12).map((id) => `\`${id}\``).join("、")}) | 早于隔离改造,没有 \`agent_memory\`;未记录不等于干净 |
` : ""}
**结论:${leaked.length ? `${leaked.length} 次确认非独立;其余` : ""}独立性未确认。** 起点一致是记录支持的事实,
回滚失败与运行期间写入都不能推出本次被污染;反过来,也不能据此把这些运行判为干净。
**没有判别值泄漏的证据,不等于没有记忆污染**:复算只扫判别值这一类内容,\`profiles/\` 之外的 atomic 记忆
(\`records/*.jsonl\`、\`skill_buffer/\`)不在快照与清理范围内,那部分既没有被还原也没有被扫描。

泄漏证据写在 \`artifacts/isolation-findings.json\`,每条绑运行 id、捕获文件 sha256、消息位置与分析代码哈希。
\`runs/\` 下的原始记录未改动。
` : ""}## 这份数字测的是什么,不是什么

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

本评测能主张的,到此为止(2026-09-12 第二人复核后收紧):**已验证的产品读取路径受闸门
控制;已覆盖的捕获中可以识别部分替代来源;未覆盖或无法归属的情况保留为未知。**

有一次绕过确实被检出并定位:2026-09-10 的冒烟运行里,两条资产都被闸门挡在池外,模型仍然
拿到了判别值——它 \`lsof\` 到探针进程的 cwd 是仓库,\`cd\` 进去读了评测自己的记录文件;送达
审计把它判成隔离失败(他源送达),来源精确到第 24 轮那条
\`cd …/evaluation/tasks/bridge-addr && cat pair.json && cat tokens.json\`。这证明的是**那一次**
被检出,不能推广成"任何绕过都会被记下来":覆盖面之外的通道没有证据,没有证据不等于没有绕过。

已覆盖的通道:捕获里的工具结果、注入的系统提示与记忆、服务侧日志、运行记录、CodeBuddy
项目缓存。要把主张提到"模型无法接触到答案",需要把会话放进只通代理的沙箱(见 REMAINING
的方案 3 spike:真实 CLI 是 npm 包 \`@tencent-ai/codebuddy-code\`,可进 Linux 容器;宿主上
另有 \`sandbox-exec\` 可用)。
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
    // 命令按**可复现**的形式记录:去掉 --md(它只决定写到哪儿,不影响内容;交付复跑里它
    // 指向临时目录,留着会让复算 diff 永远不为 0),运行目录按 id 列在正文的"运行 id"里。
    const shownFlags = args.filter((a) => a.startsWith("--") && !a.startsWith("--md="));
    const command = `node evaluation/attribution/calibrate-runs.mjs ${shownFlags.join(" ")} <${dirs.length} 个运行目录,id 见下>`;
    writeFileSync(mdOut, report({ ...result, table }, { frozen, runs, usage: { ...usage, table: usageTable }, codeHashes, manifest, command }));
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
