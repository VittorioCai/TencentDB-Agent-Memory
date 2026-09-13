/**
 * 第三个开发闭环任务的报告,由运行清单与运行记录生成,不手写(CLAUDE.md §1、§6)。
 *
 *   node evaluation/tasks/resource-download/report.mjs [--manifest=F] [--out=REPORT.md] [--md]
 *
 * 与前两个任务的报告有三点不同:
 *  1. 采用判定靠**行为**,所以样本表逐条列参考测试那 5 项断言各自过没过 —— 通过哪几项
 *     才是两组的区别所在,总判决只是它的汇总。
 *  2. **作废的运行不进样本**,但必须出现在报告里并写明原因(2026-09-13 无笔记组第一批
 *     16 次因运行环境被实施者的草稿污染整批作废)。
 *  3. **允许零增益**:无笔记组完全可能自己读 MemoryProxy 源码想到 files/download。
 *     结论句由算出来的差值决定,不预设方向;没有样本时输出「未知」,不输出比率。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** TAP 输出 → 每条断言过没过。解析失败返回 null(未知),不返回空表。 */
export function assertionsFromTap(tap) {
  if (typeof tap !== "string" || !tap.trim()) return null;
  const rows = [...tap.matchAll(/^(not ok|ok) (\d+) - (.+)$/gm)].map((m) => ({ n: Number(m[2]), name: m[3].trim(), ok: m[1] === "ok" }));
  return rows.length ? rows : null;
}

/** 本次运行算不算样本:作废的、污染的、没判决的都不算,各自给出理由。 */
export function sampleState(run) {
  if (run.voided) return { counted: false, why: `作废(${run.voided.batch})` };
  if (run.contaminated === true) return { counted: false, why: `污染:${(run.contamination_rules ?? []).join("、") || "未记规则"}` };
  if (run.sample === false) return { counted: false, why: "清单里标为非样本(冒烟)" };
  if (!run.verdict) return { counted: false, why: "没有判决" };
  if (run.contaminated === null || run.contaminated === undefined) return { counted: false, why: "污染与否未知(这次运行没有 contamination.json)" };
  return { counted: true, why: null };
}

/**
 * @param manifest devloop-runs.json
 * @param load     (run) => { verdict, memoryChannel } —— 由调用方决定从哪读,便于测试
 */
/**
 * @param exposure task.json 的 copy_exposure:副本里本不该有的那份说明,以及认它的原话。
 *   计数由数据算出来,不写死(§6):每次运行的上下文里命中几条。
 */
/** 一批样本的统计:两组各自的计数与通过率,以及能不能比。 */
export function statsOf(runs) {
  const arms = {};
  for (const arm of ["no-note", "note"]) {
    const all = runs.filter((r) => r.arm === arm);
    const counted = all.filter((r) => r.counted);
    const pass = counted.filter((r) => r.verdict === "PASS").length;
    arms[arm] = { total: all.length, counted: counted.length, pass,
      rate: counted.length ? pass / counted.length : null, excluded: all.length - counted.length };
  }
  // 作废可能让某一组更好看 —— 那就得把「按原判决计回去」的数一并给出,由读的人自己看。
  // 2026-09-13 第二批就出现了这种情况:被作废的是有笔记组的一次 FAIL。
  const ifVoided = {}, flatters = [];
  for (const arm of ["no-note", "note"]) {
    const all = runs.filter((r) => r.arm === arm && r.verdict);
    const counted = all.length, pass = all.filter((r) => r.verdict === "PASS").length;
    ifVoided[arm] = { counted, pass };
    const now = arms[arm];
    if (now.counted && counted > now.counted && pass / counted < now.rate) flatters.push(arm);
  }
  const a = arms["no-note"], b = arms["note"];
  const comparable = a.counted > 0 && b.counted > 0;
  return { runs, arms, comparable, gain: comparable ? b.rate - a.rate : null,
    if_voided_counted: ifVoided, void_flatters: flatters };
}

/** 结论句由数字决定,不预设方向(§6);一批一句。 */
export function conclusionOf(st) {
  const a = st.arms["no-note"], b = st.arms["note"], gain = st.gain;
  if (!st.comparable) {
    return `未知:${a.counted === 0 ? "无笔记组" : ""}${a.counted === 0 && b.counted === 0 ? "与" : ""}${b.counted === 0 ? "有笔记组" : ""}没有可计样本,两组无法比较。`;
  }
  if (gain > 0) return `有笔记组高出 ${(gain * 100).toFixed(0)} 个百分点(${b.pass}/${b.counted} 对 ${a.pass}/${a.counted})。`;
  if (gain === 0) return `两组持平(各 ${b.pass}/${b.counted} 与 ${a.pass}/${a.counted});这是结果,不是失败 —— 这条知识读 MemoryProxy 源码同样得得到。`;
  return `有笔记组反而低 ${(-gain * 100).toFixed(0)} 个百分点(${b.pass}/${b.counted} 对 ${a.pass}/${a.counted});按此样本量不足以说明笔记有害,只能说没测出正向作用。`;
}

export function buildReport(manifest, load, exposure = null) {
  const needles = exposure?.needles ?? [];
  const runs = (manifest.runs ?? []).map((r) => {
    const st = sampleState(r);
    const rec = load(r) ?? {};
    const tap = rec.verdict?.checks?.reference_test?.output ?? null;
    const text = rec.captureText ?? null;
    return { ...r, counted: st.counted, not_counted_why: st.why, assertions: assertionsFromTap(tap),
      memory_reads: rec.memoryChannel?.reads ?? null,
      note_mentions: text === null ? null : (rec.noteId ? text.split(rec.noteId).length - 1 : 0) + (rec.noteName ? text.split(rec.noteName).length - 1 : 0),
      use_states: rec.useStates ?? null,
      exposure_hits: text === null ? null : needles.filter((n) => text.includes(n)).length };
  });
  // 按批次分组:**两批永不合并**(CLAUDE.md:更换条件不与旧口径合并)。
  // 第二批换的是工作副本的排除清单,条件不同,合在一起算出来的比率没有意义。
  const batches = {};
  for (const r of runs) (batches[r.batch ?? "1"] ??= []).push(r);
  const byBatch = {};
  for (const [id, list] of Object.entries(batches)) byBatch[id] = statsOf(list);
  const first = byBatch[Object.keys(byBatch).sort()[0]] ?? statsOf([]);
  const { arms, comparable, gain } = first;
  const exposureSeen = {};
  for (const arm of ["no-note", "note"]) {
    const c = runs.filter((r) => r.arm === arm && r.counted);
    exposureSeen[arm] = { counted: c.length, read_it: c.filter((r) => (r.exposure_hits ?? 0) > 0).length,
      unknown: c.filter((r) => r.exposure_hits === null).length };
  }
  for (const st of Object.values(byBatch)) st.conclusion = conclusionOf(st);
  return { arms, comparable, gain, runs, batches: byBatch, exposure, exposure_seen: exposureSeen,
    rejudged: manifest.contamination_rejudged ?? null,
    voided_batches: manifest.voided_batches ?? [],
    // 结论句由数字决定,不预设方向(§6)
    conclusion: conclusionOf(first) };
}

/** 样本量的限制由计入样本数算出来;只说方向与幅度,不写显著性检验(§6:结论句不模板写死)。 */
export function sampleSizeLine(rep) {
  const a = rep.arms["no-note"].counted, b = rep.arms["note"].counted;
  if (!a || !b) return `- 样本量:无笔记 ${a} 次、有笔记 ${b} 次,尚不构成两组比较。`;
  return `- 样本量:无笔记 ${a} 次、有笔记 ${b} 次。这个量级只能说明方向,说不了幅度——两组的百分点差不该被读成效应大小的估计;要更有底,须在同一条件下另跑一批。`;
}

export function render(rep, manifest) {
  const NAME = { "1": "第一批", "2": "第二批", "3": "第三批" };
  const L = [`# 第三个开发闭环任务:resource-download`, "",
    `任务类型:**新增一个功能**(前两个是修已有缺陷)。采用判定靠**行为**,不靠标记。`, ""];
  const ids = Object.keys(rep.batches ?? {}).sort();
  // 每批一节,各自的结论与样本表。**不给合计** —— 两批条件不同,合起来算没有意义。
  for (const id of ids) {
    const st = rep.batches[id];
    const label = `${NAME[id] ?? "第 " + id + " 批"}`;
    L.push(`## ${label}:结论`, "", st.conclusion, "");
    L.push(`### ${label}:样本`, "", `| 组 | 记录 | 计入样本 | 排除 | PASS | 通过率 |`, `|---|---|---|---|---|---|`);
    for (const [arm, a] of Object.entries(st.arms)) {
      L.push(`| ${arm} | ${a.total} | ${a.counted} | ${a.excluded} | ${a.pass} | ${a.rate === null ? "未知(无样本)" : (a.rate * 100).toFixed(0) + "%"} |`);
    }
    if (st.void_flatters.length) {
      for (const arm of st.void_flatters) {
        const v = st.if_voided_counted[arm], now = st.arms[arm];
        L.push("", `**作废抬高了 ${arm} 组的数字,所以这里把两种算法都给出来。** 按冻结的作废规则,该组计入 `
          + `${now.pass}/${now.counted};**把被作废的按原判决计回去**则是 ${v.pass}/${v.counted}。`
          + `作废规则是开跑前写死的、机械执行的(见 \`batch2-conditions.json\`),不因结果调整;`
          + `但它这次恰好对结论有利,所以两个数并列,由读的人判断。`);
      }
    }
    L.push("");
  }
  if (ids.length > 1) {
    L.push(`**两批不合并。** 它们的工作副本排除清单不同(第二批排掉了本仓库自己的上游 PR 归档),`
      + `条件不同的样本合在一起算出来的比率没有意义(CLAUDE.md:更换条件不与旧口径合并)。`, "");
  }
  L.push("", `## 每次运行`, "", `| 运行 | 组 | 计入 | 判决 | 五项行为断言 | 笔记提及 | 使用判定 | 读到副本里那份说明 | 不计入的原因 |`, `|---|---|---|---|---|---|---|---|---|`);
  for (const r of rep.runs) {
    const asserts = r.assertions === null ? "未知" : r.assertions.map((x) => (x.ok ? "✓" : "✗")).join("");
    const uses = r.use_states === null ? "未知" : (r.use_states.length ? [...new Set(r.use_states)].join(",") : "无");
    const exp = r.exposure_hits === null ? "未知" : r.exposure_hits > 0 ? `是(${r.exposure_hits} 条)` : "否";
    L.push(`| ${r.run_id} | ${r.arm} | ${r.counted ? "是" : "否"} | ${r.verdict ?? "无"} | ${asserts} | ${r.note_mentions ?? "未知"} | ${uses} | ${exp} | ${r.not_counted_why ?? ""} |`);
  }
  if (rep.runs.some((r) => r.assertions)) {
    const names = rep.runs.find((r) => r.assertions)?.assertions.map((x) => `${x.n}. ${x.name.replace(/^\d+\.\s*/, "")}`);
    L.push("", `五项断言依次是:`, "", ...names.map((n) => `- ${n}`));
  }
  for (const v of rep.voided_batches) {
    L.push("", `## 作废批次:${v.batch}(${v.runs} 次)`, "", v.why, "",
      `- 闸门是否失职:${v.gate_was_not_at_fault}`,
      `- 为什么整批作废而不是只废被抓到的:${v.why_all_16_not_just_2 ?? "—"}`,
      `- 发现方式:${v.detected_by}`,
      `- 已改:`, ...(v.fixes ?? []).map((f) => `  - ${f}`),
      `- **未解决**:${v.not_fixed}`,
      `- 前两个任务:${v.earlier_tasks}`);
  }
  if (rep.exposure) {
    const e = rep.exposure_seen;
    L.push("", `## 工作副本里本不该有的那份说明`, "", rep.exposure.why, "",
      `它在这些位置:${rep.exposure.paths.map((p) => `\`${p}\``).join("、")}。`, "",
      `| 组 | 计入样本 | 其中读到了它 | 未知 |`, `|---|---|---|---|`,
      ...Object.entries(e).map(([arm, v]) => `| ${arm} | ${v.counted} | ${v.read_it} | ${v.unknown} |`), "",
      `没有清掉的原因:${rep.exposure.not_excluded_because}`);
  }
  // 规则改过几版就列几版,最新的在前;每一版的理由与影响都保留,不只显示最后一版
  for (let rj = rep.rejudged; rj; rj = rj.previous ?? null) {
    L.push("", `## 污染判定重判(${rj.rules_version})`, "", rj.why, "", rj.effect, ...(rj.note ? ["", rj.note] : []));
  }
  L.push("", `## 这份数字测的是什么,不是什么`, "",
    `- 测的是:在这一个新增功能任务上,一份写着两条实测行为的笔记,能不能让一个全新消费者把请求打到 \`files/download\`、把空内容当合法内容、把错误信封原样带出。`,
    `- 不测:笔记对其他任务的作用;也不测产品在其他场景下的检索质量。`,
    `- 允许零增益:同样的知识读 MemoryProxy 源码也能得到,所以两组打平是一个合理结果,不构成失败。`,
    sampleSizeLine(rep),
    `- 样本偏在:消费者同为一个模型,身份同为 identity c;两组之间除笔记的准入状态外不做其他变动。`,
    `- 生成:\`node evaluation/tasks/resource-download/report.mjs\`,数据来自 \`devloop-runs.json\` 与各次运行记录。`);
  return L.join("\n") + "\n";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (n) => (args.find((a) => a.startsWith(`--${n}=`)) ?? "").slice(n.length + 3) || null;
  const manifest = JSON.parse(readFileSync(opt("manifest") ?? join(HERE, "devloop-runs.json"), "utf8"));
  const task = JSON.parse(readFileSync(join(HERE, "task.json"), "utf8"));
  const tokens = JSON.parse(readFileSync(join(HERE, "tokens.json"), "utf8"));
  const noteId = Object.keys(tokens).find((k) => !k.startsWith("_")) ?? null;
  const noteName = noteId ? tokens[noteId]?.name ?? null : null;
  const load = (r) => {
    const repoCopy = join(resolve(HERE, "../../.."), "evaluation/runner/runs", r.run_id);
    const d = r.dir && existsSync(r.dir) ? r.dir : existsSync(repoCopy) ? repoCopy : null;
    const j = (n) => { try { return d && existsSync(join(d, n)) ? JSON.parse(readFileSync(join(d, n), "utf8")) : null; } catch { return null; } };
    const lines = (n) => { try { return d && existsSync(join(d, n)) ? readFileSync(join(d, n), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : null; } catch { return null; } };
    const used = lines("used-events.jsonl");
    return { verdict: j("verdict.json"), memoryChannel: j("memory-channel.json"), noteId, noteName,
      captureText: d && existsSync(join(d, "capture.jsonl")) ? readFileSync(join(d, "capture.jsonl"), "utf8") : null,
      useStates: used === null ? null : used.filter((e) => e.asset_id === noteId).map((e) => e.state) };
  };
  const rep = buildReport(manifest, load, task.copy_exposure ?? null);
  const md = render(rep, manifest);
  if (args.includes("--md")) process.stdout.write(md);
  else { const out = opt("out") ?? join(HERE, "REPORT.md"); writeFileSync(out, md); console.log(`${out} ← ${rep.runs.length} 次运行,计入样本 ${rep.runs.filter((r) => r.counted).length} 次`); }
}
