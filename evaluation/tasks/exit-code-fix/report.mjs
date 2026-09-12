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
// A recorded backup path is absolute and belongs to the machine that ran the loop; shown from the
// repository-relative segment so the report reads the same from any checkout (clean-clone rehearsal 2026-09-12).
const showPath = (p) => { const s = String(p ?? ""); const i = s.indexOf("/deploy/global-images/"); return i >= 0 ? s.slice(i + 1) : relative(REPO, s); };
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
// re-judged copies (rejudge-runs.mjs, outside the repo) are read when present: the record on disk stays as judged at run time
const REJUDGE = process.env.DEVLOOP_REJUDGE_DIR ?? "/private/tmp/topic4-rejudge/devloop-2026-09-11";
const origDirOf = (r) => (r.dir && existsSync(r.dir) ? r.dir : existsSync(join(REPO, "evaluation/runner/runs", r.run_id)) ? join(REPO, "evaluation/runner/runs", r.run_id) : null);
const dirOf = (r) => (existsSync(join(REJUDGE, r.run_id, "REJUDGED.json")) ? join(REJUDGE, r.run_id) : origDirOf(r));
const rejudgedOf = (r) => { try { return existsSync(join(REJUDGE, r.run_id, "REJUDGED.json")) ? JSON.parse(readFileSync(join(REJUDGE, r.run_id, "REJUDGED.json"), "utf8")) : null; } catch { return null; } };
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
  // the write-back is recorded in the ORIGINAL run dir even when the verdict is read from a re-judged copy
  const wb = (d ? readJson(join(d, "write-back.json")) : null) ?? (origDirOf(r) ? readJson(join(origDirOf(r), "write-back.json")) : null);
  const cost = d ? readJson(join(d, "cost.json")) : null;
  // what the model itself did with the team pool: skill_search calls and whether the note came back in any result
  const capture = d ? readJsonl(join(d, "capture.jsonl")) : null;
  let searches = null, noteReturned = null, searchQueries = [];
  if (capture) {
    const reqs = capture.filter((e) => e?.event === "http.request" && Array.isArray(e?.body?.json?.messages));
    const last = reqs[reqs.length - 1];
    const msgs = last?.body?.json?.messages ?? [];
    const results = new Map(msgs.filter((m) => m?.role === "tool").map((m) => [m.tool_call_id, String(m.content ?? "")]));
    const seen = new Set(); searches = 0; noteReturned = false;
    for (const m of msgs) for (const tc of Array.isArray(m?.tool_calls) ? m.tool_calls : []) {
      if (seen.has(tc.id)) continue; seen.add(tc.id);
      const args = String(tc?.function?.arguments ?? "");
      if (!/skill-bridge\/v3\/skill\/(search|get|get-by-name|view)/.test(args)) continue;
      searches += 1;
      let q = null; try { q = /"query"\s*:\s*"([^"]*)"/.exec(JSON.parse(args).command ?? "")?.[1] ?? null; } catch { q = null; }
      if (q) searchQueries.push(q);
      if ((results.get(tc.id) ?? "").includes(noteSpec.name ?? "\u0000")) noteReturned = true;
    }
  }
  // outcome events explained: which call, what tool did there, why that state
  const callIndex = new Map();
  if (capture) {
    const reqs = capture.filter((e) => e?.event === "http.request" && Array.isArray(e?.body?.json?.messages));
    const msgs = reqs[reqs.length - 1]?.body?.json?.messages ?? [];
    for (const m of msgs) for (const tc of Array.isArray(m?.tool_calls) ? m.tool_calls : []) {
      if (callIndex.has(tc.id)) continue;
      let head = ""; try { const a = JSON.parse(tc.function?.arguments ?? "{}"); head = String(a.command ?? a.file_path ?? a.pattern ?? "").replace(/\s+/g, " ").slice(0, 90); } catch { head = ""; }
      callIndex.set(tc.id, { tool: tc.function?.name ?? "?", head });
    }
  }
  const outcomeRows = (outcomes ?? []).filter((e) => e.asset_id === NOTE).map((e) => {
    const cid = e.metadata?.call_id ?? null; const c = cid ? callIndex.get(cid) : null;
    return { state: e.state, call_id: cid, tool: c?.tool ?? null, head: c?.head ?? null, why: (e.proof_refs ?? [])[0]?.detail ?? "" };
  });
  const noteEvents = [...(events ?? []), ...(early ?? [])].filter((e) => e.asset_id === NOTE);
  const delivered = events === null && early === null ? null : Object.fromEntries([...noteEvents.reduce((m, e) => m.set(e.state, (m.get(e.state) ?? 0) + 1), new Map())]);
  const noteUsed = used === null ? null : used.filter((e) => e.asset_id === NOTE && e.state === "used").length;
  const noteReview = used === null ? null : used.filter((e) => e.asset_id === NOTE && e.state === "needs_review").length;
  const noteOutcomes = outcomes === null ? null : Object.fromEntries([...outcomes.filter((e) => e.asset_id === NOTE).reduce((m, e) => m.set(e.state, (m.get(e.state) ?? 0) + 1), new Map())]);
  const c = verdict?.checks ?? {};
  return {
    ...r, dir: d, run, verdict, cost, rejudged: rejudgedOf(r),
    consumer: run?.consumer?.agent_id ?? r.consumer_agent_id ?? null,
    resolved_agent: run?.resolved_identity?.agent_id ?? null,
    delivered, noteUsed, noteReview, noteOutcomes, searches, noteReturned, searchQueries, outcomeRows,
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
const voided = rows.filter((r) => r.void);
L.push(`生成命令:\`node evaluation/tasks/exit-code-fix/report.mjs\`;数据范围:\`${relative(REPO, manifestPath)}\` 列出的 ${manifest.runs.length} 次运行(正式样本 ${samples.length} 次,冒烟 ${rows.length - samples.length - voided.length} 次,作废留档 ${voided.length} 次);`);
const rejudgedRows = rows.filter((r) => r.rejudged);
L.push(`判据版本:${[...new Set(rows.map((r) => r.acceptance_version).filter(Boolean))].join(", ") || "无"}${rejudgedRows.length ? `;${rejudgedRows.length} 次运行读的是仓库外复判副本(${REJUDGE};原记录不改,REJUDGED.json 记代码哈希):${rejudgedRows.map((r) => `${r.run_id} ${r.rejudged.code?.["verify.mjs"] ?? "?"}`).join("; ")}` : ""};笔记 ${NOTE ?? "?"}(${noteSpec.name ?? "?"},当前 v${q(noteSpec.version)},仓库只存 sha256 ${String(noteSpec.token_sha256?.[0] ?? "").slice(0, 12)}…${(tokens._history ?? []).length ? `;此前 ${(tokens._history ?? []).map((h) => `v${h.version} sha256 ${String(h.token_sha256?.[0] ?? "").slice(0, 12)}… 于 ${h.retired_at} 退役`).join(",")}` : ""})。每次运行开跑时的笔记版本见"每次运行"表;未记录版本的运行都早于第一次轮换,在 v1 上。`);
L.push("");
L.push(`## 这份数字测的是什么,不是什么`);
L.push("");
L.push(`- 测的是:同一缺陷任务在"笔记对消费者不可见(candidate)"与"笔记已准入(approved)"两种池状态下,各跑若干次,模型改出的仓库副本能否通过与两组完全相同的功能验收;笔记是否送达、是否被采用(新增测试的文件名/标题带笔记的判别值,并关联到写入它的调用)、采用后的结果判定;每次运行的消费者是否新建、记忆通道是否读到借入的记忆。`);
L.push(`- 不是:两组的性能对照。样本极小,先无笔记后有笔记只用于闭环演示,不作为闸门或笔记收益的估计。`);
L.push(`- 仓库内已有正确实现可参照(起点副本的 \`evaluation/gate0/verify-capture.mjs\` 正确读退出行并通用解析 curl 错误行,见 conditions.json 的 known_hints_in_tracked_files),**笔记的设计目的是帮助定位、不是唯一答案;本实验没有单独测量定位时间,不能说已证明缩短定位**;无笔记组通过并不说明笔记无用,有笔记组通过也不说明是笔记的功劳——采用与否只看 attempts 与 used 事件。`);
L.push(`- 判据保守在哪:验收只认验证器自带的参考测试与起点测试的原内容;模型自报的测试结果不采信;模型新增的测试另记不进判决。未知项:送达/采用事件缺失时记"?",不折成 0。`);
L.push("");
L.push(`## 每次运行`);
L.push("");
L.push(`| 序 | 组 | run_id | 消费者(新建) | proxy 解析到的 agent | 开跑时笔记状态/可见性 | 模型检索团队池次数 | 笔记出现在检索结果 | 笔记送达事件 | 采用 used / 待复核 | 结果判定 | 验收 | 尝试值 | 改动文件 | 模型自测 | 记忆通道 ok | 起点后提交 |`);
L.push(`|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
for (const r of rows) {
  const deliv = r.delivered === null ? "?" : Object.keys(r.delivered).length ? Object.entries(r.delivered).map(([k, v]) => `${k} ${v}`).join(", ") : "无";
  const outc = r.noteOutcomes === null ? "?" : Object.keys(r.noteOutcomes).length ? Object.entries(r.noteOutcomes).map(([k, v]) => `${k} ${v}`).join(", ") : "无";
  const mt = r.model_tests ? (r.model_tests.files?.length ? `${q(r.model_tests.pass)}/${q(r.model_tests.tests)}` : "未加") : "?";
  L.push(`| ${r.seq} | ${r.arm}${r.void ? "(作废)" : r.sample ? "" : "(冒烟)"} | ${r.run_id}${r.rejudged ? "(复判 " + (r.rejudged.acceptance_version ?? "?") + ")" : ""} | ${q(r.consumer)} | ${q(r.resolved_agent)} | ${q(r.note_status_at_start)}${r.note_visibility_at_start ? "/" + r.note_visibility_at_start : ""} v${r.note_version_at_start ?? 1} | ${q(r.searches)} | ${yn(r.noteReturned)} | ${deliv} | ${q(r.noteUsed)} / ${q(r.noteReview)} | ${outc} | ${q(r.verdict?.verdict)} | ${r.attempts.map((a) => a.value + (a.needs_review ? "(待复核)" : "")).join("; ") || "?"} | ${r.files ? r.files.join("; ") || "无" : "?"} | ${mt} | ${yn(r.memory?.ok)} | ${q(r.history?.commits_after_start)} |`);
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
const NONZERO = "a non-zero exit status, as CodeBuddy spells it, is a failure";
const TIMEOUT = "a timed-out call whose only signal is the exit status line, as CodeBuddy spells it, is a timeout";
const symptomOnly = rows.filter((r) => (r.reference_failing ?? []).includes(NONZERO) && !(r.reference_failing ?? []).includes(TIMEOUT));
const rootCause = rows.filter((r) => r.reference && r.reference_failing && r.reference_failing.length === 0);
L.push(`参考测试(验证器自带,两组相同)共 7 例:大写退出行的超时(28)、大写退出行的非零退出码(52/56)、小写拼写仍可读、` +
  `退出 0 + code 0 信封、退出 0 + 非零信封、退出 0 无输出保持不可读、stderr 里的连接失败。` +
  `**笔记正文列出了 52/56,而任务文本只描述超时;因此有笔记组在"非零退出码"一例上的通过,包含"笔记披露了验收覆盖范围"的成分,不能只记为定位更快。** ` +
  `根因修复(退出行的标签按两种拼写读,一行正则)同时覆盖超时与非零退出码两类情形;只把超时分支改成认大写、不改退出码读取的修复是治标,会在"非零退出码"一例上失败。` +
  `本清单里:参考测试 7/7(根因修复)${rootCause.length} 次(${rootCause.map((r) => `${r.arm}${r.void ? "作废" : ""} ${r.run_id}`).join("; ") || "无"});` +
  `只过超时、不过非零退出码(治标)${symptomOnly.length} 次(${symptomOnly.map((r) => `${r.arm}${r.void ? "作废" : ""} ${r.run_id}`).join("; ") || "无"});` +
  `其他参考失败 ${refFails.length - symptomOnly.length} 次。`);
L.push("");
// ── the self-report question, from the records (review 2026-09-11 evening) ──
const judged = rows.filter((r) => r.verdict && r.tests_kept);
const rewrote = judged.filter((r) => (r.tests_kept.modified ?? []).length);
const selfGreen = judged.filter((r) => r.model_tests && r.model_tests.files?.length && r.model_tests.fail === 0);
const wouldHaveSlipped = judged.filter((r) => r.model_tests && r.model_tests.files?.length && r.model_tests.fail === 0 && r.verdict.verdict !== "PASS");
// ── result judgement, explained per event (review 2026-09-11 evening, point 1) ──
L.push(`## 结果判定逐条解释`);
L.push("");
L.push(`判据(judge-outcome.mjs):每条 used 事件按它的 call id 找验收记录里同一调用的 attempt;attempt 成功且本次验收 PASS → validated;` +
  `该调用不是验收 attempt(提到了判别值但不是写入新增测试的调用)→ needs_review "the token appeared in an operation that was not an acceptance attempt";` +
  `attempt 失败 → corrected 或 needs_review(视失败是否由资产内容解释)。attempt 只认最终新增测试的文件名/标题里的标记,并关联最后一次写入该文件且含标记的调用。`);
L.push("");
L.push(`| run_id | 状态 | 调用 | 工具 | 调用做了什么(参数头) | 判定理由 |`);
L.push(`|---|---|---|---|---|---|`);
for (const r of rows) for (const o of r.outcomeRows ?? []) {
  L.push(`| ${r.run_id} | ${o.state} | ${q(o.call_id)} | ${q(o.tool)} | ${(o.head ?? "?").replace(/\|/g, "\\|")} | ${o.why.replace(/\|/g, "\\|").slice(0, 160)} |`);
}
if (!rows.some((r) => (r.outcomeRows ?? []).length)) L.push(`| (无结果判定事件) | | | | | |`);
L.push("");
// ── the visibility incident (point 2) ──
const voidVis = rows.filter((r) => r.void && /visibility=private/.test(r.void_reason ?? ""));
const cf2 = manifest.config_fixes ?? [];
L.push(`## 可见性事故:approved 但 private,检索不到,表现为"未采用"`);
L.push("");
L.push(`笔记由 \`/v3/skill/create\` 建入,默认 \`visibility: private\`;批次四的资产由 enter-pool.sh 显式置 team。bridge 的 skill_search 不含别人的私有 skill。` +
  `管理员置 approved 后跑的有笔记组第一对(${voidVis.map((r) => r.run_id).join("、") || "无"}):` +
  voidVis.map((r) => `${r.run_id} 检索 ${q(r.searches)} 次、笔记出现在结果 ${yn(r.noteReturned)}、送达事件 ${r.delivered && Object.keys(r.delivered).length ? "有" : "无"}、采用 ${q(r.noteUsed)}`).join(";") +
  `。若不查准入返回里的 visibility 字段就写报告,这两次会被记成"笔记送达后模型未采用"——把配置缺陷说成模型行为。` +
  `与"探针装错位置"同类:仪器出错不报错,只给看起来正常的结论。处置:两次作废留档;` + (cf2.map((v) => `${v.at} ${v.what}`).join(";") || "未记录修正") +
  `;fill-note 建/更新后置 team 并在 --check 校验;驱动对有笔记组同时要求 approved 与 team。`);
L.push("");
// ── the conclusion in the agreed wording (point 4), from the counts ──
const nn = byArm("no-note"), nt = byArm("note");
const nnPass = count(nn, (r) => r.verdict?.verdict === "PASS"), ntPass = count(nt, (r) => r.verdict?.verdict === "PASS");
const ntNewFile = count(nt, (r) => (r.attempts ?? []).some((a) => /^bt-/.test(a.value) && (a.where ?? []).includes("file name")));
const ntUsed = count(nt, (r) => (r.noteUsed ?? 0) > 0);
const allNoNote = rows.filter((r) => r.arm === "no-note");
const nnMarker = count(allNoNote, (r) => (r.attempts ?? []).some((a) => /^bt-/.test(a.value)));
const viaWrite = nt.flatMap((r) => (r.attempts ?? []).filter((a) => /^bt-/.test(a.value)).map((a) => a.written_via)).filter(Boolean);
L.push(`## 结论(按 2026-09-11 晚定的口径)`);
L.push("");
L.push(`两组功能验收相同(验证器自带参考测试 + 起点测试原内容),正式样本里无笔记 ${nnPass}/${nn.length} 通过、有笔记 ${ntPass}/${nt.length} 通过。` +
  `笔记的可观测作用是改变实现路径:有笔记组 ${ntNewFile}/${nt.length} 次按团队约定新建了带判别值的独立测试文件(无笔记组把测试加进已有文件),` +
  `不是"没笔记就做不成"。判别值随机生成、只在 Core 正文里;无笔记组 ${allNoNote.length} 次(含作废)零出现(${nnMarker} 次带标记)。` +
  `采用证据来自送达事件(injected / recalled / fetched)与写入调用的关联(${viaWrite.length} 条,写入方式 ${[...new Set(viaWrite)].join("、") || "无"}),有笔记组 ${ntUsed}/${nt.length} 次判 used;不依赖模型自述。` +
  `样本 ${nn.length}+${nt.length},差异仅描述这些运行。`);
L.push("");
// ── did the gate move (point 3) ──
const gobs = readJsonl(join(HERE, "gate-observations.jsonl")) ?? [];
L.push(`## 闸门有没有动:回流前后的 Core 记录`);
L.push("");
if (!gobs.length) L.push(`没有观测记录(gate-observe.mjs 未运行)。`);
else {
  L.push(`| 时间 | 时点 | status | visibility | evidence_revision | 闸门 decision | decided_at | online validated/used/corrected |`);
  L.push(`|---|---|---|---|---|---|---|---|`);
  for (const o of gobs) L.push(`| ${o.at} | ${o.label} | ${q(o.status)} | ${q(o.visibility)} | ${q(o.evidence_revision)} | ${q(o.gate?.decision)} | ${q(o.gate?.decided_at)} | ${q(o.gate?.online?.validated)}/${q(o.gate?.online?.used)}/${q(o.gate?.online?.corrected)} |`);
  const first = gobs[0], last = gobs[gobs.length - 1];
  const moved = first.gate?.decided_at !== last.gate?.decided_at;
  L.push("");
  L.push(moved
    ? `闸门在 ${last.at} 重判:decided_at ${first.gate?.decided_at} → ${last.gate?.decided_at},decision ${first.gate?.decision} → ${last.gate?.decision},status ${first.status} → ${last.status};evidence_revision ${first.evidence_revision} → ${last.evidence_revision}。回流闭合:一条经验被提取 → 被使用 → 被验证 → 闸门据证据准入;笔记保留 approved(判定与状态一致,是这一环的实物;上次人工 approved 时 gate 仍 pending,状态与判定不一致,故置回)。admit 所依据的 ${q(last.gate?.online?.validated)} 次 validated 来自同一消费者用户、同一任务,见"apply 之前的两项确认"。`
    : `闸门 decided_at 停在 ${last.gate?.decided_at}(decision ${last.gate?.decision}),evidence_revision ${first.evidence_revision} → ${last.evidence_revision}:证据写入了,闸门尚未据此重判——回流只是写入,没闭合。`);
}
L.push("");
// ── the extraction window and the pool snapshots around it (write-back provenance) ──
const readJsonOpt = (n) => readJson(join(HERE, n));
const sw = readJsonl(join(HERE, "extraction-switch.jsonl")) ?? [];
const poolBefore = readJsonOpt("pool-before-extraction-on.json"), poolAfterWb = readJsonOpt("pool-after-writeback.json"), poolAfterOff = readJsonOpt("pool-after-extraction-off.json");
const ids = (snap) => new Set((snap?.assets ?? []).map((a) => a.asset_id));
const wbRows = rows.filter((r) => r.sample).map((r) => ({ run_id: r.run_id, consumer: r.consumer, wb: r.wb, attempts: [] }));
L.push(`## 回流窗口、池快照与新资产的来源`);
L.push("");
if (!sw.length) L.push(`提取开关记录(extraction-switch.jsonl)尚无:提取未打开,四次写回只归档(见上表)。`);
else {
  L.push(`| 时间 | 开关 | 前 → 后 | 容器读回 | 配置 sha 前→后 | 备份 | ok |`);
  L.push(`|---|---|---|---|---|---|---|`);
  for (const o of sw) L.push(`| ${o.at} | ${o.switch} | ${o.before} → ${o.after} | ${o.container_reads} | ${String(o.sha256_before).slice(0, 8)}→${String(o.sha256_after).slice(0, 8)} | ${showPath(o.backup)} | ${o.ok} |`);
  const on = sw.filter((o) => o.switch === "on").map((o) => o.at), off = sw.filter((o) => o.switch === "off").map((o) => o.at);
  L.push("");
  L.push(`开关时间窗:开 ${on.join(", ") || "无"} → 关 ${off.join(", ") || "未关"}。四次写回的调用时间:` + rows.filter((r) => r.sample && r.wb).map((r) => `${r.run_id} ${r.wb.called_at}`).join("; ") + "。");
}
L.push("");
const b = ids(poolBefore), a1 = ids(poolAfterWb), a2 = ids(poolAfterOff);
const newAfterWb = poolAfterWb ? [...a1].filter((x) => !b.has(x)) : null;
const newAfterOff = poolAfterOff ? [...a2].filter((x) => !b.has(x)) : null;
const consumers = new Set(rows.filter((r) => r.sample).map((r) => r.consumer));
const byId = (snap) => Object.fromEntries((snap?.assets ?? []).map((x) => [x.asset_id, x]));
// the registry row names the owner USER; the agent whose session buffer was archived is in the archive key's path
const agentOfKey = (k) => (/\/(agt-[a-z0-9]+)\//.exec(String(k ?? "")) ?? [])[1] ?? null;
const wbNew = rows.filter((r) => r.sample && r.wb).flatMap((r) => (r.wb.new_assets ?? []).map((a) => ({ ...a, run_id: r.run_id, consumer: r.consumer, consumer_user: r.run?.consumer?.owner_user_id ?? null, archive_agent: agentOfKey(r.wb.extract_response?.archive_key), task: r.wb.extract_response?.task_id ?? null })));
const userOf = (a) => a.producer_user_id ?? a.owner_user_id ?? null;
L.push(`写回记录里出现的新资产 ${wbNew.length} 项(每条写回调用前后比对注册表,以该次消费者用户的 key 读;注册表行只带 owner user,归档 key 的路径段给出被归档会话的 agent):` +
  (wbNew.map((a) => `${a.asset_id} ${a.name ?? ""} v${q(a.version)} ${q(a.status)} owner user ${q(userOf(a))}${userOf(a) === a.consumer_user ? "(=该次消费者用户)" : "(≠该次消费者用户!)"},归档 agent ${q(a.archive_agent)}${a.archive_agent === a.consumer ? "(=该次消费者)" : "(≠!)"},提取任务 ${q(a.task)}`).join("; ") || "无") +
  `。owner user 等于该次消费者用户的 ${wbNew.filter((a) => userOf(a) === a.consumer_user).length}/${wbNew.length};归档 agent 等于该次消费者的 ${wbNew.filter((a) => a.archive_agent === a.consumer).length}/${wbNew.length}。`);
L.push("");
L.push(`池快照:开关前 ${poolBefore ? `${poolBefore.asset_count} 项(${poolBefore.pool_snapshot_at})` : "未拍"};写回后 ${poolAfterWb ? `${poolAfterWb.asset_count} 项(${poolAfterWb.pool_snapshot_at}),新增 ${newAfterWb.length}` : "未拍"};关闭后 ${poolAfterOff ? `${poolAfterOff.asset_count} 项(${poolAfterOff.pool_snapshot_at}),相对开关前新增 ${newAfterOff.length}` : "未拍"}。` +
  (newAfterWb && newAfterWb.length ? ` 新增资产:` + newAfterWb.map((x) => { const r = byId(poolAfterWb)[x]; const mine = consumers.has(r?.producer_agent_id); return `${x} ${r?.name ?? ""} v${q(r?.version)} ${q(r?.status)} 作者 agent ${q(r?.producer_agent_id)}${mine ? "(本闭环消费者)" : "(不是本闭环的消费者!)"}`; }).join("; ") + `;来自本闭环四个消费者的 ${newAfterWb.filter((x) => consumers.has(byId(poolAfterWb)[x]?.producer_agent_id)).length}/${newAfterWb.length}。` : (poolAfterWb && wbNew.length ? ` 作者 key 拍的快照没有看到这 ${wbNew.length} 项:提取出的 skill 默认 visibility private、属消费者用户,作者的注册表列表不含它们(与笔记私有那次是同一机制);来源以每次写回前后的注册表比对为准。` : "")));
L.push("");
// ── the two confirmations before apply (review 2026-09-11 evening) ──
const evals = readJsonl(join(HERE, "gate-evaluations.jsonl")) ?? [];
const lastDry = [...evals].reverse().find((e) => !e.apply) ?? null;
const applied = [...evals].reverse().find((e) => e.apply) ?? null;
L.push(`## apply 之前的两项确认`);
L.push("");
if (!lastDry) L.push(`没有闸门试算记录(gate-evaluate.mjs --dry-run 未运行)。`);
else {
  const authorLine = (lastDry.reasons ?? []).find((x) => /^author /.test(x)) ?? null;
  const ruleLine = (lastDry.reasons ?? []).find((x) => /^rule /.test(x)) ?? null;
  const reportedNotUsed = authorLine ? /reported, not used/.test(authorLine) : null;
  L.push(`**1. 作者先验有没有计入试算的 admit?** 试算(${lastDry.at})的判定理由:${(lastDry.reasons ?? []).map((x) => `"${x}"`).join(";")}。` +
    (reportedNotUsed === true ? `作者那一行标注 "(reported, not used)":规则(${ruleLine ?? "?"})不读作者先验;作者信号只决定 review_priority(asset-gate.ts 371–387:近 30 天有被判 wrong 的资产 → high),不进 admit/reject 判定。因此 apply 的结果与试算一致,理由是 ${ruleLine ?? "?"}。`
      : reportedNotUsed === false ? `作者那一行没有 "(reported, not used)" 标注:作者先验可能进入了判定,apply 结果可能与试算不符,须以 apply 记录为准。`
      : `试算理由里没有作者行,无法判断作者先验是否计入。`));
  const noteOwner = rows.map((r) => r.run?.consumer?.owner_user_id).filter(Boolean);
  const ownerUser = (readJsonOpt("asset-pool-snapshot.json")?.assets ?? []).find((x) => x.asset_id === NOTE)?.producer_user_id ?? null;
  // 每次 apply 的信号各自成行:v1 与 v2 的计数不同,一句解释套两版就会自相矛盾(2026-09-12 复核)。
  const applied = (evals ?? []).filter((e) => e.apply).map((e) => ({ at: e.at, asset_version: e.asset_version ?? e.signals?.asset_version ?? null, signals: e.signals }));
  const rel = rows.filter((r) => r.sample && r.arm === "note").map((r) => ({ run_id: r.run_id, consumer: r.consumer, user: r.run?.consumer?.owner_user_id ?? null, relation: r.run?.consumer?.owner_user_id && ownerUser ? (r.run.consumer.owner_user_id === ownerUser ? "same_user" : "cross_user") : "unknown" }));
  L.push("");
  L.push(`**2. 两次验证是 cross_user 还是 cross_agent?** 笔记作者 user ${q(ownerUser)};` + rel.map((x) => `${x.run_id} 消费者 ${x.consumer} 属 user ${q(x.user)} → ${x.relation}`).join(";") +
    `。Core 试算信号 cross_user_validated ${q(lastDry.signals?.online?.cross_user_validated)}、distinct_consumers ${q(lastDry.signals?.online?.distinct_consumers)}(按 user 计:两个 agent 同属一个消费者用户)。` +
    (rel.every((x) => x.relation === "cross_user")
      ? `**闸门的两次判定要分开讲(2026-09-12 第二人复核:生成器读最新数字,却留着 v1 时写死的解释)**:` +
        (applied.length ? applied.map((e, i) => `${e.at}${e.asset_version ? ` 对 v${e.asset_version}` : i === 0 ? " 对 v1(记录未写版本,按时序:第二任务闭合前)" : ""}:cross_user validated ${q(e.signals?.online?.cross_user_validated)}、distinct_consumers ${q(e.signals?.online?.distinct_consumers)}、distinct_tasks ${q(e.signals?.online?.distinct_tasks)}`).join(";") + "。" : "") +
        `本任务(第一任务)这 ${rel.length} 次验证来自 ${new Set(rel.map((x) => x.user)).size} 个消费者用户、1 个任务实体;v2 的计数还含第二任务 \`exit-line-collect\` 的运行。跨人关系在产品记录里成立,独立性不成立:所有身份由同一人操作,两个用户不是两位独立真人。`
      : `不全是跨人:"基于跨人验证 admit"这句要改。`));
}
L.push("");
if (evals.length) {
  L.push(`闸门评估记录:`);
  for (const e of evals) L.push(`- ${e.at} ${e.apply ? "APPLY" : "dry-run"}(${e.label}):decision ${q(e.decision)} → status_target ${q(e.status_target)};status ${q(e.status_before)} → ${q(e.status_after)};online validated ${q(e.signals?.online?.validated)} / corrected ${q(e.signals?.online?.corrected)} / cross_user_validated ${q(e.signals?.online?.cross_user_validated)} / untrusted_ignored ${q(e.signals?.online?.untrusted_ignored)}`);
  if (applied) L.push(`apply 结果:status ${q(applied.status_before)} → ${q(applied.status_after)},与最后一次试算(${q(lastDry?.decision)})${applied.decision === lastDry?.decision ? "一致" : "不一致"}。`);
  L.push("");
}
L.push(`## 不信模型自报:这些运行的实证`);
L.push("");
L.push(`本清单里已判决的 ${judged.length} 次运行中,${rewrote.length} 次改写了被测代码自己的测试文件(${[...new Set(rewrote.flatMap((r) => r.tests_kept.modified))].join(", ") || "无"});` +
  `${selfGreen.length} 次模型自己的测试全绿(${selfGreen.map((r) => `${r.run_id} ${r.model_tests.pass}/${r.model_tests.tests}`).join("; ") || "无"});` +
  `${judged.filter((r) => !(r.model_tests && r.model_tests.files?.length)).length} 次未记录模型自测(判据版本早于 repo-2026-09-11c)。` +
  `验收器不看这些:受控套件跑起点测试的原内容,模型的测试只记不判。` +
  (wouldHaveSlipped.length
    ? `其中 ${wouldHaveSlipped.length} 次模型自测全绿而验收不是 PASS(${wouldHaveSlipped.map((r) => `${r.run_id}:${r.verdict.verdict},参考测试失败项 ${(r.reference_failing ?? []).join("; ") || "?"}`).join("; ")})——若当初采信模型自报"测试通过",这些运行会被判成通过。`
    : `本清单里没有"自测全绿而验收不过"的运行;这条约束的实证要看其他清单。`));
L.push("");
L.push(`## 消费者与记忆隔离`);
L.push("");
L.push(`| run_id | 消费者 | 创建时足迹(profile/records/buffer) | proxy 配置 sha 前→后 | 备份 | 记忆读取次数 | 读回项 | 早于开跑 | 他 agent 的 | 无日期 | ok |`);
L.push(`|---|---|---|---|---|---|---|---|---|---|---|`);
for (const r of rows) {
  const c = r.run?.consumer, f = c?.footprint_at_creation, p = c?.proxy_switch, m = r.memory;
  L.push(`| ${r.run_id} | ${q(c?.agent_id)} | ${f ? `${q(f.profile_files)}/${q(f.records_lines)}/${q(f.buffer_sessions)}` : "?"} | ${p ? `${p.sha256_before.slice(0, 8)}→${p.sha256_after.slice(0, 8)}` : "?"} | ${p ? showPath(p.backup) : "?"} | ${q(m?.reads)} | ${q(m?.items)} | ${q(m?.residue)} | ${q(m?.borrowed_from_other_agents)} | ${q(m?.undated)} | ${yn(m?.ok)} |`);
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
L.push(`## 笔记的准入是实验干预,不是闸门批准`);
L.push("");
const obs = manifest.status_observations ?? [];
L.push(`笔记 ${NOTE ?? "?"} 的闸门判定始终 pending;有笔记组之前由管理员置 approved 是实验准备动作,跑完即置回 candidate,` +
  `报告不把它读作闸门批准;闸门判定待新经验回流(5e)后由证据驱动。驱动脚本每次调用记录的状态观测(${obs.length} 条):` +
  (obs.length ? obs.map((o) => `${o.at} ${o.note_status}(${o.arm}, n=${o.n})`).join("; ") : "无") + "。" +
  (obs.length ? (obs[obs.length - 1].note_status === "candidate" ? " 最后一次观测为 candidate:已撤销。" : ` 最后一次观测为 ${obs[obs.length - 1].note_status}:尚未置回。`) : ""));
L.push("");
const tv = manifest.task_text_versions ?? [];
if (tv.length) L.push(`任务文本改动 ${tv.length} 次:` + tv.map((v) => `${v.at} ${v.change}(原因:${v.reason};作废运行 ${v.voided_runs?.join(", ") || "无"})`).join(";") + "。");
const cf = manifest.config_fixes ?? [];
if (cf.length) L.push(`配置修正 ${cf.length} 次:` + cf.map((v) => `${v.at} ${v.what}(作废运行 ${v.voided_runs?.join(", ") || "无"})`).join(";") + "。");
const voids = rows.filter((r) => r.void);
if (voids.length) { L.push(""); L.push(`作废留档的运行(${voids.length}):`); for (const r of voids) L.push(`- ${r.run_id}(${r.arm}):${r.void_reason}`); }
L.push("");
L.push(`## 计数(只描述这些运行)`);
L.push("");
for (const arm of ["no-note", "note"]) {
  const list = byArm(arm);
  if (!list.length) { L.push(`- ${arm}:0 次正式样本。`); continue; }
  const pass = count(list, (r) => r.verdict?.verdict === "PASS"), fail = count(list, (r) => r.verdict?.verdict === "FAIL"), err = count(list, (r) => !["PASS", "FAIL"].includes(r.verdict?.verdict));
  const usedN = count(list, (r) => (r.noteUsed ?? 0) > 0), delivN = count(list, (r) => r.delivered && Object.keys(r.delivered).length > 0), unkD = count(list, (r) => r.delivered === null);
  const searched = count(list, (r) => (r.searches ?? 0) > 0), returned = count(list, (r) => r.noteReturned === true);
  const fresh = count(list, (r) => r.consumer && r.resolved_agent && r.consumer === r.resolved_agent), memOk = count(list, (r) => r.memory?.ok === true), memBad = count(list, (r) => r.memory?.ok === false);
  L.push(`- ${arm}:${list.length} 次;验收 PASS ${pass} / FAIL ${fail} / ERROR ${err};模型检索团队池 ${searched} 次运行、笔记出现在检索结果 ${returned} 次运行;笔记有送达事件 ${delivN} 次(送达未知 ${unkD});笔记被采用 ${usedN} 次;消费者为本次新建且与 proxy 解析一致 ${fresh} 次;记忆通道 ok ${memOk} 次、不 ok ${memBad} 次、未知 ${list.length - memOk - memBad} 次。`);
}
L.push("");
L.push(`差异仅描述这些运行,不作为闸门或笔记收益的无偏或保守估计。`);
L.push("");
L.push(`## 成本(按组,cost.json 实测)`);
L.push("");
{
  const meanOf = (xs) => { const v = xs.filter((x) => typeof x === "number"); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const k = (x) => (x === null ? "—" : `${(x / 1000).toFixed(1)}k`), r1 = (x) => (x === null ? "—" : x.toFixed(1));
  L.push(`| 组 | 有 usage 的运行 | 均模型调用次数 | 均墙钟 s | 均 prompt tok | 均 total tok | 均 cached tok | 验收 PASS |`);
  L.push(`|---|---|---|---|---|---|---|---|`);
  for (const arm of ["no-note", "note"]) {
    const list = byArm(arm), c = list.map((r) => r.cost).filter(Boolean);
    L.push(`| ${arm} | ${c.length}/${list.length} | ${r1(meanOf(c.map((x) => x.turns)))} | ${r1(meanOf(c.map((x) => x.wall_seconds)))} | ${k(meanOf(c.map((x) => x.prompt_tokens)))} | ${k(meanOf(c.map((x) => x.total_tokens)))} | ${k(meanOf(c.map((x) => x.cached_tokens)))} | ${list.filter((r) => r.verdict?.verdict === "PASS").length} |`);
  }
  L.push("");
  L.push(`只用 cost.json 已有的字段(每次流式响应的 usage 块之和、会话墙钟;模型调用次数 = 带 usage 的响应数;工具调用数不在 cost.json 里,不另测)。` +
    `这是两组运行的实际开销对比,不是闸门机制的成本模型——没有哪次运行单独隔离了闸门自身的开销。`);
}
L.push("");
L.push(`## 剩余缺点`);
L.push("");
for (const s of [
  "跨运行隔离尚未成立(批次四层面);本闭环改为每次运行新建消费者,只对这几次运行有效",
  "解析修正后的统计已经第二人复核(2026-09-12):口径问题已改在生成器里并重新生成,正式组 20 项判定逐项未变;复核核到表内加减与生成代码,未逐一重算原始捕获",
  "本报告只覆盖清单里的运行(第 5 件开发闭环已闭合,交付复跑见 evaluation/delivery/ 最新一次;这一行原写「待完成」,2026-09-12 复核指出与现状不符)",
  "小样本、单场景、单主体、单模型;批次四正式组的采纳证据覆盖率在新解析下是 1.0(旧解析 0.95),见 runner/COMPARISON-2026-09-11-reparsed.md 的校准一节",
  "仓库内已有正确实现可参照。笔记的设计目的是帮助定位,但本实验没有单独测量定位时间,两组也不是严格性能对照:记录支持的只是「笔记里的测试约定出现在模型新增的测试里,并在这些运行里观察到了相应操作」,不能说已证明缩短定位;两组差异不能归于笔记",
  "模型自报测试结果不采信,验收只认验证器自带参考测试与起点测试原内容;模型新增的测试另记",
  "笔记正文列出 52/56、任务文本只描述超时:有笔记组在非零退出码一例上的通过含'笔记披露了验收覆盖范围'成分",
  "团队资产只在模型主动 skill_search 时送达;task.md 已加一句团队经验可检索(两组同文,改动前的运行作废留档),送达与否仍按事件如实报",
  "笔记最终 approved 是闸门规则的判定(admit 基于 2 次 cross_user validated,但 distinct_consumers=1、distinct_tasks=1:跨人成立、独立性不成立);人工 approved 那段已置回,实验干预不算闸门批准",
  "后续不做:跨运行记忆隔离方案(要点已记:每次新 agent + 反证验证 + 查借入的 chat_memory)、并发最后一组维持 ERROR、bridge-name 不换解析;批次五不跑(4 次不可判源于 gate-off 下两条冲突约定并存,换 trace 重跑会复现)",
  "回流走产品的 /v3/skill/extract,提取内容由 Core 决定;是否产生资产、状态为何,以 write-back.json 为准",
  "运行时镜像摘要在这些运行时没有冻结,而且已不可考:重建后拉到的上游 :latest(sha256:55fec3a6…)被证明不是当时的镜像(同一套挂载文件在它上面起不来,见 gate/artifacts/core-mount-accept-failure-20260912.log)。能确定的是运行时 = 当时镜像的其余文件 + 本分支挂载的 metadata 目录与 6 个 gateway/core 文件。回填与被覆盖清单见 devloop-runs.json 的 config_fixes;自 2026-09-11 起 selfcheck 把容器镜像摘要冻进 conditions.json",
]) L.push(`- ${s}`);
L.push("");
const md = L.join("\n") + "\n";
if (args.includes("--stdout")) console.log(md);
else { writeFileSync(outPath, md); console.log(`report → ${outPath} (${rows.length} run(s))`); }
