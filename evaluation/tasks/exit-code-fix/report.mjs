/**
 * The dev loop's report, generated from the run manifest and the run records
 * — never written by hand (CLAUDE.md §1, §6). Every number and every
 * conclusion-shaped sentence below is computed from devloop-runs.json and
 * the files each run left behind (run.json, verdict.json, events, receipt,
 * write-back.json). Unknowns stay unknown.
 *
 *   node evaluation/tasks/exit-code-fix/report.mjs [--manifest=F] [--out=REPORT.md]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const args = process.argv.slice(2);
const opt = (n) => (args.find((a) => a.startsWith(`--${n}=`)) ?? "").slice(n.length + 3) || null;
const manifestPath = opt("manifest") ?? join(HERE, "devloop-runs.json");
const outPath = opt("out") ?? join(HERE, "REPORT.md");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const tokens = JSON.parse(readFileSync(join(HERE, "tokens.json"), "utf8"));
const NOTE = Object.keys(tokens).find((k) => !k.startsWith("_"));
const noteSpec = tokens[NOTE] ?? {};

const readJson = (p) => { try { return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null; } catch { return null; } };
const readJsonl = (p) => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : null);
const dirOf = (r) => (r.dir && existsSync(r.dir) ? r.dir : existsSync(join(REPO, "evaluation/runner/runs", r.run_id)) ? join(REPO, "evaluation/runner/runs", r.run_id) : null);
const q = (v) => (v === null || v === undefined ? "?" : String(v));
const yn = (v) => (v === true ? "是" : v === false ? "否" : "未知");

const rows = manifest.runs.map((r) => {
  const d = dirOf(r);
  const run = d ? readJson(join(d, "run.json")) : null;
  const verdict = d ? readJson(join(d, "verdict.json")) : null;
  const events = d ? readJsonl(join(d, "events.jsonl")) : null;
  const early = d ? readJsonl(join(d, "early-events.jsonl")) : null;
  const used = d ? readJsonl(join(d, "used-events.jsonl")) : null;
  const outcomes = d ? readJsonl(join(d, "outcome-events.jsonl")) : null;
  const wb = d ? readJson(join(d, "write-back.json")) : null;
  const cost = d ? readJson(join(d, "cost.json")) : null;
  const noteEvents = [...(events ?? []), ...(early ?? [])].filter((e) => e.asset_id === NOTE);
  const delivered = events === null && early === null ? null : Object.fromEntries([...noteEvents.reduce((m, e) => m.set(e.state, (m.get(e.state) ?? 0) + 1), new Map())]);
  const noteUsed = used === null ? null : used.filter((e) => e.asset_id === NOTE && e.state === "used").length;
  const noteReview = used === null ? null : used.filter((e) => e.asset_id === NOTE && e.state === "needs_review").length;
  const noteOutcomes = outcomes === null ? null : Object.fromEntries([...outcomes.filter((e) => e.asset_id === NOTE).reduce((m, e) => m.set(e.state, (m.get(e.state) ?? 0) + 1), new Map())]);
  const c = verdict?.checks ?? {};
  return {
    ...r, dir: d, run, verdict, cost,
    consumer: run?.consumer?.agent_id ?? r.consumer_agent_id ?? null,
    resolved_agent: run?.resolved_identity?.agent_id ?? null,
    delivered, noteUsed, noteReview, noteOutcomes,
    attempts: verdict?.attempts ?? [],
    files: c.diff?.files?.map((f) => `${f.status} ${f.file}`) ?? null,
    reference: c.reference_test ? `${q(c.reference_test.pass)}/${q(c.reference_test.tests)}` : null,
    reference_failing: c.reference_test?.failures ?? null,
    suite: c.suite ?? null, tests_kept: c.tests_kept ?? null, model_tests: c.model_tests ?? null, history: c.history ?? null,
    memory: run?.memory_channel ?? null, wb,
    acceptance_version: verdict?.acceptance_version ?? null,
  };
});

const samples = rows.filter((r) => r.sample);
const byArm = (arm) => samples.filter((r) => r.arm === arm);
const count = (list, f) => list.filter(f).length;
const L = [];
L.push(`# 开发闭环 \`exit-code-fix\`:运行报告(脚本生成)`);
L.push("");
L.push(`生成命令:\`node evaluation/tasks/exit-code-fix/report.mjs\`;数据范围:\`${relative(REPO, manifestPath)}\` 列出的 ${manifest.runs.length} 次运行(正式样本 ${samples.length} 次,冒烟 ${rows.length - samples.length} 次);`);
L.push(`判据版本:${[...new Set(rows.map((r) => r.acceptance_version).filter(Boolean))].join(", ") || "无"};笔记 ${NOTE ?? "?"}(${noteSpec.name ?? "?"} v${q(noteSpec.version)},仓库只存 sha256 ${String(noteSpec.token_sha256?.[0] ?? "").slice(0, 12)}…)。`);
L.push("");
L.push(`## 这份数字测的是什么,不是什么`);
L.push("");
L.push(`- 测的是:同一缺陷任务在"笔记对消费者不可见(candidate)"与"笔记已准入(approved)"两种池状态下,各跑若干次,模型改出的仓库副本能否通过与两组完全相同的功能验收;笔记是否送达、是否被采用(新增测试的文件名/标题带笔记的判别值,并关联到写入它的调用)、采用后的结果判定;每次运行的消费者是否新建、记忆通道是否读到借入的记忆。`);
L.push(`- 不是:两组的性能对照。样本极小,先无笔记后有笔记只用于闭环演示,不作为闸门或笔记收益的估计。`);
L.push(`- 仓库内已有正确实现可参照(起点副本的 \`evaluation/gate0/verify-capture.mjs\` 正确读退出行并通用解析 curl 错误行,见 conditions.json 的 known_hints_in_tracked_files),**笔记的作用是缩短定位而非提供唯一答案**;无笔记组通过并不说明笔记无用,有笔记组通过也不说明是笔记的功劳——采用与否只看 attempts 与 used 事件。`);
L.push(`- 判据保守在哪:验收只认验证器自带的参考测试与起点测试的原内容;模型自报的测试结果不采信;模型新增的测试另记不进判决。未知项:送达/采用事件缺失时记"?",不折成 0。`);
L.push("");
L.push(`## 每次运行`);
L.push("");
L.push(`| 序 | 组 | run_id | 消费者(新建) | proxy 解析到的 agent | 开跑时笔记状态 | 笔记送达事件 | 采用 used / 待复核 | 结果判定 | 验收 | 尝试值 | 改动文件 | 模型自测 | 记忆通道 ok | 起点后提交 |`);
L.push(`|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
for (const r of rows) {
  const deliv = r.delivered === null ? "?" : Object.keys(r.delivered).length ? Object.entries(r.delivered).map(([k, v]) => `${k} ${v}`).join(", ") : "无";
  const outc = r.noteOutcomes === null ? "?" : Object.keys(r.noteOutcomes).length ? Object.entries(r.noteOutcomes).map(([k, v]) => `${k} ${v}`).join(", ") : "无";
  const mt = r.model_tests ? (r.model_tests.files?.length ? `${q(r.model_tests.pass)}/${q(r.model_tests.tests)}` : "未加") : "?";
  L.push(`| ${r.seq} | ${r.arm}${r.sample ? "" : "(冒烟)"} | ${r.run_id} | ${q(r.consumer)} | ${q(r.resolved_agent)} | ${q(r.note_status_at_start)} | ${deliv} | ${q(r.noteUsed)} / ${q(r.noteReview)} | ${outc} | ${q(r.verdict?.verdict)} | ${r.attempts.map((a) => a.value + (a.needs_review ? "(待复核)" : "")).join("; ") || "?"} | ${r.files ? r.files.join("; ") || "无" : "?"} | ${mt} | ${yn(r.memory?.ok)} | ${q(r.history?.commits_after_start)} |`);
}
L.push("");
L.push(`## 验收明细`);
L.push("");
L.push(`| run_id | 参考测试 | 参考测试失败项 | 受控套件 | 新增失败 | 基线失败仍在 | 原测试缺失 / 被改写 / 模型新增 | 验收理由 |`);
L.push(`|---|---|---|---|---|---|---|---|`);
for (const r of rows) {
  const s = r.suite, k = r.tests_kept;
  L.push(`| ${r.run_id} | ${q(r.reference)} | ${r.reference_failing === null ? "?" : r.reference_failing.length ? r.reference_failing.join("; ") : "无"} | ${q(s?.state)} | ${s ? q(s.new_failures?.length) : "?"} | ${s ? `${q(s.baseline_still_failing?.length)}/${q(s.baseline_size)}` : "?"} | ${k ? `${k.missing.length} / ${k.modified.length} / ${k.added.length}` : "?"} | ${(r.verdict?.reason ?? "?").replace(/\|/g, "\\|")} |`);
}
// what the reference demands beyond the task text, computed from the runs that failed it
const refFails = rows.filter((r) => (r.reference_failing ?? []).length);
L.push("");
L.push(`参考测试(验证器自带,两组相同)共 7 例:大写退出行的超时(28)、大写退出行的非零退出码(52/56)、小写拼写仍可读、` +
  `退出 0 + code 0 信封、退出 0 + 非零信封、退出 0 无输出保持不可读、stderr 里的连接失败。任务文本只写"部分超时未被正确识别";` +
  `笔记正文明确提到 52。${refFails.length ? `本清单里 ${refFails.length} 次运行未过参考测试,失败项:${[...new Set(refFails.flatMap((r) => r.reference_failing))].join("; ")}` +
  `——只改超时分支、没有按大写读一般退出码的修复,会在"非零退出码"一例上失败;这是参考测试的范围决定,两组同样适用,` +
  `有笔记组若在这一例上通过,须考虑笔记对覆盖范围的提示。` : "本清单里没有运行未过参考测试。"}`);
L.push("");
L.push(`## 消费者与记忆隔离`);
L.push("");
L.push(`| run_id | 消费者 | 创建时足迹(profile/records/buffer) | proxy 配置 sha 前→后 | 备份 | 记忆读取次数 | 读回项 | 早于开跑 | 他 agent 的 | 无日期 | ok |`);
L.push(`|---|---|---|---|---|---|---|---|---|---|---|`);
for (const r of rows) {
  const c = r.run?.consumer, f = c?.footprint_at_creation, p = c?.proxy_switch, m = r.memory;
  L.push(`| ${r.run_id} | ${q(c?.agent_id)} | ${f ? `${q(f.profile_files)}/${q(f.records_lines)}/${q(f.buffer_sessions)}` : "?"} | ${p ? `${p.sha256_before.slice(0, 8)}→${p.sha256_after.slice(0, 8)}` : "?"} | ${p ? relative(REPO, p.backup) : "?"} | ${q(m?.reads)} | ${q(m?.items)} | ${q(m?.residue)} | ${q(m?.borrowed_from_other_agents)} | ${q(m?.undated)} | ${yn(m?.ok)} |`);
}
L.push("");
L.push(`## 新经验回流候选池`);
L.push("");
const withWb = rows.filter((r) => r.wb);
if (!withWb.length) L.push(`尚未执行(write-back.mjs 未对任何运行调用)。`);
else {
  L.push(`| run_id | 作者(agent / user) | 来源会话 | 提取任务 | 新资产 | 实际决定 |`);
  L.push(`|---|---|---|---|---|---|`);
  for (const r of withWb) {
    const w = r.wb;
    L.push(`| ${r.run_id} | ${q(w.author?.agent_id)} / ${q(w.author?.user_id)} | ${q(w.source_session)} | ${q(w.extract_response?.task_id)} (code ${q(w.extract_response?.code)}) | ${w.new_assets?.length ? w.new_assets.map((a) => `${a.asset_id} ${a.name ?? ""} v${q(a.version)} ${q(a.status)}`).join("; ") : "无"} | ${q(w.decision)} |`);
  }
}
L.push("");
L.push(`## 计数(只描述这些运行)`);
L.push("");
for (const arm of ["no-note", "note"]) {
  const list = byArm(arm);
  if (!list.length) { L.push(`- ${arm}:0 次正式样本。`); continue; }
  const pass = count(list, (r) => r.verdict?.verdict === "PASS"), fail = count(list, (r) => r.verdict?.verdict === "FAIL"), err = count(list, (r) => !["PASS", "FAIL"].includes(r.verdict?.verdict));
  const usedN = count(list, (r) => (r.noteUsed ?? 0) > 0), delivN = count(list, (r) => r.delivered && Object.keys(r.delivered).length > 0), unkD = count(list, (r) => r.delivered === null);
  const fresh = count(list, (r) => r.consumer && r.resolved_agent && r.consumer === r.resolved_agent), memOk = count(list, (r) => r.memory?.ok === true), memBad = count(list, (r) => r.memory?.ok === false);
  L.push(`- ${arm}:${list.length} 次;验收 PASS ${pass} / FAIL ${fail} / ERROR ${err};笔记有送达事件 ${delivN} 次(送达未知 ${unkD});笔记被采用 ${usedN} 次;消费者为本次新建且与 proxy 解析一致 ${fresh} 次;记忆通道 ok ${memOk} 次、不 ok ${memBad} 次、未知 ${list.length - memOk - memBad} 次。`);
}
L.push("");
L.push(`差异仅描述这些运行,不作为闸门或笔记收益的无偏或保守估计。`);
L.push("");
L.push(`## 剩余缺点`);
L.push("");
for (const s of [
  "跨运行隔离尚未成立(批次四层面);本闭环改为每次运行新建消费者,只对这几次运行有效",
  "解析修正后的统计未确认;正式样本分母已修正但需复核",
  "开发闭环与交付验证待完成:本报告只覆盖清单里的运行",
  "小样本、单场景、单主体、单模型;采纳证据覆盖率 0.95(批次四)",
  "仓库内已有正确实现可参照:笔记的作用是缩短定位而非提供唯一答案;两组差异不能归于笔记",
  "模型自报测试结果不采信,验收只认验证器自带参考测试与起点测试原内容;模型新增的测试另记",
  "参考测试要求大写退出行下的一般非零退出码(52/56)也判失败,任务文本只提超时;笔记正文提到 52——两组的功能验收相同,但笔记对覆盖范围有提示,有笔记组的 PASS 不能只归于'定位更快'",
  "团队资产只在模型主动 skill_search 时送达;task.md 不提知识池,送达与否按事件如实报",
  "回流走产品的 /v3/skill/extract,提取内容由 Core 决定;是否产生资产、状态为何,以 write-back.json 为准",
]) L.push(`- ${s}`);
L.push("");
const md = L.join("\n") + "\n";
if (args.includes("--stdout")) console.log(md);
else { writeFileSync(outPath, md); console.log(`report → ${outPath} (${rows.length} run(s))`); }
