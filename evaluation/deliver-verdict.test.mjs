/**
 * deliver-check.sh 的判决句原来靠一份**硬编码白名单**:只有 suite / demo / 两份
 * devloop-report / reparse-exitline / selfcheck* 的退出码会被判,只有 calibration /
 * summary / 两份 devloop-report / reparse-exitline 的差异会被判。
 *
 * 后果有实物为证:`evaluation/delivery/2026-09-13/` 里 `REPARSE-DIFF.diff` 是 4 行,
 * 而同一份 SUMMARY 的判决句写的是"有差异的:1(devloop-report 5 行)"——漏掉了那 4 行,
 * 因为 rejudge-diff 既不在退出白名单也不在差异白名单里。
 *
 * 更要紧的是缺依赖会被判成"没问题":复判副本不在时,calibration 那行以 exit 3 记
 * "copies absent",而 calibration 的退出码根本不参与判决,于是总结论照样是绿的。
 *
 * 这里把判决改成:**每个步骤都要有明示的策略**,期望非零的逐项写明原因,
 * 缺步骤算失败,离线复算与线上检查分别判定。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { verdict, POLICY } from "./deliver-verdict.mjs";

const row = (step, exit = 0, diff = null, note = "") => ({ step, exit, diff_lines: diff, note, command: "x", expected: "y" });

/** 一组全绿的行(含两个期望非零的步骤),作为各用例的基准。 */
const green = () => [
  row("suite", 0, null, "ℹ tests 754 ℹ pass 754 ℹ fail 0"),
  row("selfcheck", 1, null, "结论:验证器未全过(seg0=0 seg1=1 seg2=0 seg4=1) 已出现于 [task] task:REPORT.md"),
  row("selfcheck-exit-line-collect", 1, null, "结论:验证器未全过(seg0=0 seg1=1 seg2=0 seg4=1) 已出现于 [record] devloop-runs.json"),
  row("rejudge-regenerate", 0, null, "14 copies"),
  row("calibration", 0, 0),
  row("summary", 0, 0),
  row("rejudge-diff", 0, 0),
  row("reparse-exitline", 0, 0),
  row("devloop-report", 0, 0),
  row("devloop-report-2", 0, 0),
  row("devloop-report-3", 0, 0, "计入样本 8 次"),
  row("contamination-3", 0, null, "样本 8 次:污染 0,未知 0,规则 contamination-2026-09-13c;全部干净"),
  row("author-recheck", 0, 0, "5 份重验"),
  row("stated-suite-size", 0, null, "套件实际 754 个测试;文档里声明当前规模的地方 2 处,全部一致"),
  row("generated-reports", 0, null, "入库 .md 73 份:叙述 44 份,登记的报告 29 份 —— regenerated 12,figures_checked 1,not_regenerable 1,historical 15;未登记 0 份"),
  row("seal-record", 0, 0, "evaluation/SEAL-CHECK.md ← 22 步"),
  row("reports-executed", 0, null, "登记为要重算的 14 份,逐份核对本轮的执行记录与产物,全部对上"),
  row("comparison-figures", 0, null, "对照报告的主表与生成的 summary 逐格比对:26 格,全部一致"),
  row("demo", 0, null, "Segments: 2 live, 5 record, 0 fixture"),
  row("chain", 0, null, "3/3 条 case 成功;21 个环节,其中未证明 3 个"),
  row("selection", 0, null, "池中 7 项;放行 5 项;挡下 2 项"),
  row("conditions-check", 1, null, "47 PASS / 20 FAIL;conditions-check 的 20 项 FAIL:批次后的正常变化 14 项、已知限制 5 项、**记录缺口 1 项**;未登记 0 项;登记了但本次未失败 0 项。"),
  row("live-state", 0, null, "skill.extraction.enabled: file=false container=enabled:false"),
];

test("每个步骤都有明示策略 —— 没有'未被判决'的步骤", () => {
  for (const r of green()) assert.ok(POLICY[r.step], `${r.step} 没有策略`);
  assert.deepEqual(Object.keys(POLICY).sort(), green().map((r) => r.step).sort());
});

test("全绿:离线与线上都通过", () => {
  const v = verdict(green());
  assert.equal(v.ok, true);
  assert.equal(v.offline.ok, true);
  assert.deepEqual(v.failures, []);
});

test("历史回归:rejudge-diff 差异 4 行必须被报出来(旧逻辑报'无')", () => {
  const rows = green().map((r) => (r.step === "rejudge-diff" ? { ...r, diff_lines: 4 } : r));
  const v = verdict(rows);
  assert.equal(v.ok, false);
  assert.equal(v.offline.ok, false);
  assert.ok(v.failures.some((f) => f.step === "rejudge-diff" && /差异 4 行/.test(f.why)), JSON.stringify(v.failures));
});

test("缺依赖不算通过:复判副本不在时 calibration 以 exit 3 记录,总结论必须失败", () => {
  const rows = green().map((r) => (r.step === "calibration"
    ? { ...r, exit: 3, diff_lines: null, note: "copies absent at /private/tmp/topic4-rejudge/2026-09-11" } : r));
  const v = verdict(rows);
  assert.equal(v.ok, false);
  assert.ok(v.failures.some((f) => f.step === "calibration" && /退出码 3/.test(f.why)));
  assert.ok(v.dependencies_missing.length >= 1, "缺依赖要单列,不能混在普通失败里");
});

test("重判生成失败必须失败 —— 否则后面所有比对拿旧副本去比", () => {
  const rows = green().map((r) => (r.step === "rejudge-regenerate" ? { ...r, exit: 1 } : r));
  assert.equal(verdict(rows).ok, false);
});

test("期望非零的两个步骤:符合写明的形态算通过,并单列出来", () => {
  const v = verdict(green());
  assert.equal(v.expected_failures.length, 3);   // 两个 selfcheck + conditions-check
  assert.ok(v.expected_failures.every((e) => e.why));
});

test("conditions-check 出现未登记的 FAIL → 阻断(放行条件是「未登记 0 项」)", () => {
  const rows = green().map((r) => (r.step === "conditions-check"
    ? { ...r, note: "47 PASS / 21 FAIL;…;未登记 1 项(某新项)。" } : r));
  const v = verdict(rows);
  assert.equal(v.ok, false);
  assert.ok(v.failures.some((f) => f.step === "conditions-check"));
});

test("selfcheck 变成别的失败形态就不再是'期望之内'", () => {
  const rows = green().map((r) => (r.step === "selfcheck"
    ? { ...r, note: "结论:验证器未全过(seg0=1 seg1=1 seg2=1 seg4=1)" } : r));
  const v = verdict(rows);
  assert.equal(v.ok, false);
  assert.ok(v.failures.some((f) => f.step === "selfcheck"));
});

test("步骤整个缺失算失败 —— 脚本半途退出不能表现成'没问题'", () => {
  const v = verdict(green().filter((r) => r.step !== "devloop-report"));
  assert.equal(v.ok, false);
  assert.deepEqual(v.missing, ["devloop-report"]);
});

test("线上检查与离线复算分开判:线上那行异常不影响离线结论", () => {
  const rows = green().map((r) => (r.step === "live-state" ? { ...r, exit: 7 } : r));
  const v = verdict(rows);
  assert.equal(v.offline.ok, true, "离线复算不该被线上状态拖下水");
  assert.equal(v.live.ok, false);
  assert.equal(v.ok, false);
});

test("判决句把两侧分开写,且列出缺依赖", () => {
  const rows = green().map((r) => (r.step === "calibration" ? { ...r, exit: 3, note: "copies absent" } : r));
  const line = verdict(rows).line;
  assert.match(line, /离线复算/);
  assert.match(line, /线上检查/);
  assert.match(line, /缺依赖/);
});

test("第三任务:样本里有一次污染或未知,验收整体失败", () => {
  for (const note of ["样本 8 次:污染 1,未知 0;不通过:x", "样本 8 次:污染 0,未知 1;不通过:y"]) {
    const rows = green().map((r) => (r.step === "contamination-3" ? { ...r, exit: 1, note } : r));
    const v = verdict(rows);
    assert.equal(v.ok, false, note);
    assert.ok(v.failures.some((f) => f.step === "contamination-3"));
  }
});

test("第三任务报告有差异就失败,和前两份一样按差异判", () => {
  const rows = green().map((r) => (r.step === "devloop-report-3" ? { ...r, diff_lines: 2 } : r));
  assert.equal(verdict(rows).ok, false);
});

test("新加的三道:任一失败都要拖垮离线结论", () => {
  for (const step of ["author-recheck", "generated-reports", "comparison-figures", "stated-suite-size", "reports-executed"]) {
    const rows = green().map((r) => (r.step === step ? { ...r, exit: 1 } : r));
    const v = verdict(rows);
    assert.equal(v.ok, false, step);
    assert.equal(v.offline.ok, false, step);
  }
});

test("作者评估重验有差异就失败 —— 渲染页必须与入库副本一致", () => {
  const rows = green().map((r) => (r.step === "author-recheck" ? { ...r, diff_lines: 3 } : r));
  assert.equal(verdict(rows).ok, false);
});

test("退出码为 0 的步骤也能要求 note 的形态 —— chain 少跑一条 case,退出码仍是 0,必须靠形态挡住", () => {
  const rows = green().map((r) => (r.step === "chain" ? { ...r, exit: 0, note: "2/3 条 case 成功;14 个环节,其中未证明 2 个" } : r));
  const v = verdict(rows);
  assert.equal(v.ok, false);
  assert.ok(v.failures.some((f) => f.step === "chain" && /形态/.test(f.why)), JSON.stringify(v.failures));
});

test("chain 三条都成功时照常通过", () => {
  assert.equal(verdict(green()).ok, true);
});
