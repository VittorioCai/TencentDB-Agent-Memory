/**
 * 交付复跑的判决:给每个步骤一个**明示的策略**,并把离线复算与线上检查分开判。
 *
 * 为什么要写这一份:原来的判决句内嵌在 deliver-check.sh 里,用两份硬编码白名单
 * 决定"谁的退出码算数""谁的差异算数",不在名单里的步骤既不判也不提示。实物证据:
 * `evaluation/delivery/2026-09-13/` 里 `REPARSE-DIFF.diff` 是 4 行,而那份 SUMMARY 的
 * 判决句写"有差异的:1(devloop-report 5 行)"——rejudge-diff 两个名单都不在,于是那 4 行
 * 消失了。更糟的是缺依赖:复判副本不在时 calibration 那行以 exit 3 记 "copies absent",
 * 而它的退出码不参与判决,总结论照样是绿的 —— 一个总绿色盖住了"根本没跑成"。
 *
 * 现在的规则:
 *   - `POLICY` 必须覆盖每一个会出现的步骤;出现未登记的步骤本身就是失败。
 *   - 步骤缺失算失败(脚本半途退出不能表现成"没问题")。
 *   - 期望非零的步骤要写明**为什么**期望非零,并且只有匹配到写明的形态才算"期望之内"。
 *   - 缺依赖单列,不与普通失败混在一起 —— 读者要能一眼看出"是没跑成"还是"跑了没过"。
 *   - 离线复算(offline)与线上检查(live)各出一个结论,总结论是两者之和。
 */

/** kind: "offline" | "live";  exit: 0 | "expected";  diff: true 表示该步必须 diff 0。 */
export const POLICY = {
  "suite":                       { kind: "offline", exit: 0, diff: false, what: "全套单元测试" },
  "selfcheck":                   { kind: "offline", exit: "expected", diff: false, what: "第一任务自检",
    expect: /seg0=0 seg1=1 seg2=0/, why: "闭环之后判别值已进记录并烧毁,seg4 按设计失败" },
  "selfcheck-exit-line-collect": { kind: "offline", exit: "expected", diff: false, what: "第二任务自检",
    expect: /seg0=0 seg1=1 seg2=0/, why: "同上:笔记 v2 的值已进记录并烧毁" },
  "rejudge-regenerate":          { kind: "offline", exit: 0, diff: false, what: "重判副本生成",
    note: "失败时后面所有比对会拿旧副本去比,所以必须判" },
  "calibration":                 { kind: "offline", exit: 0, diff: true, what: "批次四校准表" },
  "summary":                     { kind: "offline", exit: 0, diff: true, what: "批次四汇总表" },
  "rejudge-diff":                { kind: "offline", exit: 0, diff: true, what: "批次四重判差异表" },
  "reparse-exitline":            { kind: "offline", exit: 0, diff: true, what: "退出行 reparse" },
  "devloop-report":              { kind: "offline", exit: 0, diff: true, what: "第一任务闭环报告" },
  "devloop-report-2":            { kind: "offline", exit: 0, diff: true, what: "第二任务闭环报告" },
  "devloop-report-3":            { kind: "offline", exit: 0, diff: true, what: "第三任务闭环报告(新增功能,行为判定)" },
  "rejudge-execute":             { kind: "offline", exit: 0, diff: false, what: "第三任务重判**实跑**(从入库归档重算,不是重画表格)",
    note: "判别值已烧毁并登记,离线路线可解析,所以干净克隆上也能重判", expect: /三份 rows 全部产出,差异行 0/ },
  "rejudge-pool":                { kind: "offline", exit: 0, diff: true, what: "第三任务采用归因重判页(池快照更正)",
    note: "两组保真对照必须全对 —— 重放装置会造出或抹掉 used 的话,差值不成立" },
  "contamination-3":             { kind: "offline", exit: 0, diff: false, what: "第三任务样本污染批检",
    note: "污染与未知同样阻断:一次样本不是明确的干净就不能计入" },
  "author-recheck":              { kind: "offline", exit: 0, diff: true, what: "作者评估重验(五份,从 raw_model_output)" },
  "stated-suite-size":           { kind: "offline", exit: 0, diff: false, what: "文档里写的套件规模与实跑一致",
    note: "这个数漂过两次(彩排 E 修过一回,9/13 又漂成 643 对 729);叙述里抄一个会变的数,只能靠每次比" },
  "generated-reports":           { kind: "offline", exit: 0, diff: false, what: "生成报告登记核对",
    note: "未登记的生成报告一律阻断 —— 验收此前不知道仓库里一共有哪几份,少查一份不会有人发现" },
  "seal-record":                 { kind: "offline", exit: 0, diff: true, what: "封版核对页(从入库的克隆验收记录重算)" },
  "reports-executed":            { kind: "offline", exit: 0, diff: false, what: "登记的报告本轮真的跑过",
    note: "登记完整不等于执行完整:改个不存在的步骤名、或多登记一份而循环没跑它,只核登记都穿得过去" },
  "comparison-figures":          { kind: "offline", exit: 0, diff: false, what: "对照报告主表与生成 summary 逐格比对" },
  "demo":                        { kind: "offline", exit: 0, diff: false, what: "演示脚本" },
  "chain":                       { kind: "offline", exit: 0, diff: false, what: "闭环展示:主链条 + 两个反例",
    expect: /3\/3 条 case 成功/, why: "三条 case 逐次记退出码;少跑一条时退出码仍为 0,只能靠这个形态挡住" },
  "selection":                   { kind: "offline", exit: 0, diff: false, what: "相关性筛选:准入与任务相关两层分开" },
  "conditions-check":            { kind: "live", exit: "expected", diff: false, what: "批次条件核对",
    expect: /未登记 0 项/, why: "exit 1 是常态;放行条件是每一项 FAIL 都在 conditions-expected.json 里登记了性质与原因(三类:批次后的正常变化 / 已载明的实验限制 / 证据缺口),未登记即阻断" },
  "live-state":                  { kind: "live", exit: 0, diff: false, what: "线上状态记录" },
};

/** 缺依赖的形态:不是"跑了没过",是"根本没跑成"。 */
const MISSING_DEP = /copies absent|not found|未找到|缺少|no such file/i;

export function verdict(rows) {
  const seen = new Map(rows.map((r) => [r.step, r]));
  const missing = Object.keys(POLICY).filter((s) => !seen.has(s));
  const unregistered = rows.filter((r) => !POLICY[r.step]).map((r) => r.step);

  const failures = [], expected_failures = [], dependencies_missing = [];
  for (const [step, p] of Object.entries(POLICY)) {
    const r = seen.get(step);
    if (!r) continue;                                   // 归入 missing
    const note = r.note ?? "";
    if (p.exit === "expected") {
      if (p.expect.test(note)) expected_failures.push({ step, why: p.why, note });
      else failures.push({ step, kind: p.kind, why: `期望之内的失败形态未出现(期望 ${p.expect}),实际:${note.slice(0, 80)}` });
    } else if (r.exit !== p.exit) {
      const dep = MISSING_DEP.test(note);
      const why = `退出码 ${r.exit}(期望 ${p.exit})${dep ? " —— 依赖缺失,不是跑了没过" : ""}${note ? `:${note.slice(0, 80)}` : ""}`;
      failures.push({ step, kind: p.kind, why });
      if (dep) dependencies_missing.push({ step, why: note.slice(0, 120) });
    } else if (p.expect && !p.expect.test(note)) {
      // 退出码对,不等于这一步真的把该做的都做了:chain 少跑一条 case 退出码仍是 0
      // (2026-09-13 复核方的反例)。要求 note 写出该有的形态,由这里核。
      failures.push({ step, kind: p.kind, why: `退出码正常,但 note 的形态不对(期望 ${p.expect}),实际:${note.slice(0, 80)}` });
    }
    if (p.diff && r.diff_lines !== 0) {
      failures.push({ step, kind: p.kind, why: r.diff_lines == null ? "该步应产出差异行数,却没有记录" : `与提交副本差异 ${r.diff_lines} 行` });
    }
  }
  for (const s of missing) failures.push({ step: s, kind: POLICY[s].kind, why: "该步骤没有出现在本次复跑里" });
  for (const s of unregistered) failures.push({ step: s, kind: "offline", why: "出现了未登记策略的步骤,判决无法覆盖它" });

  const of_kind = (k) => failures.filter((f) => f.kind === k);
  const offline = { ok: of_kind("offline").length === 0, failures: of_kind("offline") };
  const live = { ok: of_kind("live").length === 0, failures: of_kind("live") };
  const fmt = (fs) => fs.map((f) => `${f.step}(${f.why})`).join(";") || "无";
  const line =
    `判决:离线复算 ${offline.ok ? "通过" : "**失败**"} —— ${fmt(offline.failures)};` +
    `线上检查 ${live.ok ? "通过" : "**失败**"} —— ${fmt(live.failures)};` +
    `缺依赖 ${dependencies_missing.length ? dependencies_missing.map((d) => d.step).join("、") : "无"};` +
    `按设计应失败并已核对形态的 ${expected_failures.length} 项(${expected_failures.map((e) => e.step).join("、") || "无"})。`;

  return { ok: offline.ok && live.ok, offline, live, failures, missing, unregistered, dependencies_missing, expected_failures, line };
}

// ── CLI:deliver-check.sh 用它生成 SUMMARY.md 并给出总退出码 ──────────────
//   node evaluation/deliver-verdict.mjs <rows.jsonl> <SUMMARY.md> <stamp> <head>
// 判决失败 → 退出 1。交付复跑不再"无论如何都返回 0"。
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync, writeFileSync } = await import("node:fs");
  const [rowsPath, outPath, stamp, head] = process.argv.slice(2);
  const rows = readFileSync(rowsPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const v = verdict(rows);
  const esc = (x) => String(x ?? "").replace(/\|/g, "\\|");
  const L = [`# 交付复跑 ${stamp}(HEAD ${String(head).slice(0, 7)};脚本生成)`, "",
             "| 步骤 | 判 | 命令 | 退出码 | 期望 | 实际 / 差异行数 |", "|---|---|---|---|---|---|"];
  for (const r of rows) {
    const p0 = POLICY[r.step];
    const mark = !p0 ? "**未登记**" : p0.exit === "expected" ? "期望非零" : p0.kind === "live" ? "线上" : "离线";
    let actual = r.note || "";
    if (r.diff_lines != null) actual = (actual ? actual + " " : "") + `diff ${r.diff_lines} 行`;
    L.push(`| ${r.step} | ${mark} | \`${esc(r.command)}\` | ${r.exit} | ${esc(r.expected)} | ${esc(actual)} |`);
  }
  L.push("", v.line, "");
  if (v.expected_failures.length) {
    L.push("**按设计应失败的项,逐条说明原因**:", "");
    for (const e of v.expected_failures) L.push(`- \`${e.step}\`:${e.why}`);
    L.push("");
  }
  if (!v.ok) {
    L.push("**本次交付复跑判为失败。** 逐条:", "");
    for (const f of v.failures) L.push(`- \`${f.step}\`(${f.kind === "live" ? "线上检查" : "离线复算"}):${f.why}`);
    L.push("");
  }
  writeFileSync(outPath, L.join("\n") + "\n");
  console.log(L.join("\n"));
  process.exit(v.ok ? 0 : 1);
}
