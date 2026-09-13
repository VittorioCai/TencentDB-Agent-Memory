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
export function buildReport(manifest, load) {
  const runs = (manifest.runs ?? []).map((r) => {
    const st = sampleState(r);
    const rec = load(r) ?? {};
    const tap = rec.verdict?.checks?.reference_test?.output ?? null;
    return { ...r, counted: st.counted, not_counted_why: st.why, assertions: assertionsFromTap(tap),
      memory_reads: rec.memoryChannel?.reads ?? null, note_returned: rec.noteReturned ?? null };
  });
  const arms = {};
  for (const arm of ["no-note", "note"]) {
    const all = runs.filter((r) => r.arm === arm);
    const counted = all.filter((r) => r.counted);
    const pass = counted.filter((r) => r.verdict === "PASS").length;
    arms[arm] = { total: all.length, counted: counted.length, pass,
      rate: counted.length ? pass / counted.length : null,
      excluded: all.length - counted.length };
  }
  const a = arms["no-note"], b = arms["note"];
  const comparable = a.counted > 0 && b.counted > 0;
  const gain = comparable ? b.rate - a.rate : null;
  return { arms, comparable, gain, runs,
    voided_batches: manifest.voided_batches ?? [],
    // 结论句由数字决定,不预设方向(§6)
    conclusion: !comparable
      ? `未知:${a.counted === 0 ? "无笔记组" : ""}${a.counted === 0 && b.counted === 0 ? "与" : ""}${b.counted === 0 ? "有笔记组" : ""}没有可计样本,两组无法比较。`
      : gain > 0 ? `有笔记组高出 ${(gain * 100).toFixed(0)} 个百分点(${b.pass}/${b.counted} 对 ${a.pass}/${a.counted})。`
      : gain === 0 ? `两组持平(各 ${b.pass}/${b.counted} 与 ${a.pass}/${a.counted});这是结果,不是失败 —— 这条知识读 MemoryProxy 源码同样得得到。`
      : `有笔记组反而低 ${(-gain * 100).toFixed(0)} 个百分点(${b.pass}/${b.counted} 对 ${a.pass}/${a.counted});按此样本量不足以说明笔记有害,只能说没测出正向作用。` };
}

export function render(rep, manifest) {
  const L = [`# 第三个开发闭环任务:resource-download`, "",
    `任务类型:**新增一个功能**(前两个是修已有缺陷)。采用判定靠**行为**,不靠标记。`, "",
    `## 结论`, "", rep.conclusion, ""];
  L.push(`## 样本`, "", `| 组 | 记录 | 计入样本 | 排除 | PASS | 通过率 |`, `|---|---|---|---|---|---|`);
  for (const [arm, a] of Object.entries(rep.arms)) {
    L.push(`| ${arm} | ${a.total} | ${a.counted} | ${a.excluded} | ${a.pass} | ${a.rate === null ? "未知(无样本)" : (a.rate * 100).toFixed(0) + "%"} |`);
  }
  L.push("", `## 每次运行`, "", `| 运行 | 组 | 计入 | 判决 | 五项行为断言 | 记忆读取 | 不计入的原因 |`, `|---|---|---|---|---|---|---|`);
  for (const r of rep.runs) {
    const asserts = r.assertions === null ? "未知" : r.assertions.map((x) => (x.ok ? "✓" : "✗")).join("");
    L.push(`| ${r.run_id} | ${r.arm} | ${r.counted ? "是" : "否"} | ${r.verdict ?? "无"} | ${asserts} | ${r.memory_reads ?? "未知"} | ${r.not_counted_why ?? ""} |`);
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
  L.push("", `## 这份数字测的是什么,不是什么`, "",
    `- 测的是:在这一个新增功能任务上,一份写着两条实测行为的笔记,能不能让一个全新消费者把请求打到 \`files/download\`、把空内容当合法内容、把错误信封原样带出。`,
    `- 不测:笔记对其他任务的作用;也不测产品在其他场景下的检索质量。`,
    `- 允许零增益:同样的知识读 MemoryProxy 源码也能得到,所以两组打平是一个合理结果,不构成失败。`,
    `- 样本偏在:消费者同为一个模型,身份同为 identity c;两组之间除笔记的准入状态外不做其他变动。`,
    `- 生成:\`node evaluation/tasks/resource-download/report.mjs\`,数据来自 \`devloop-runs.json\` 与各次运行记录。`);
  return L.join("\n") + "\n";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (n) => (args.find((a) => a.startsWith(`--${n}=`)) ?? "").slice(n.length + 3) || null;
  const manifest = JSON.parse(readFileSync(opt("manifest") ?? join(HERE, "devloop-runs.json"), "utf8"));
  const load = (r) => {
    const repoCopy = join(resolve(HERE, "../../.."), "evaluation/runner/runs", r.run_id);
    const d = r.dir && existsSync(r.dir) ? r.dir : existsSync(repoCopy) ? repoCopy : null;
    const j = (n) => { try { return d && existsSync(join(d, n)) ? JSON.parse(readFileSync(join(d, n), "utf8")) : null; } catch { return null; } };
    return { verdict: j("verdict.json"), memoryChannel: j("memory-channel.json") };
  };
  const rep = buildReport(manifest, load);
  const md = render(rep, manifest);
  if (args.includes("--md")) process.stdout.write(md);
  else { const out = opt("out") ?? join(HERE, "REPORT.md"); writeFileSync(out, md); console.log(`${out} ← ${rep.runs.length} 次运行,计入样本 ${rep.runs.filter((r) => r.counted).length} 次`); }
}
