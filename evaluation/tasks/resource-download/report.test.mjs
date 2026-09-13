import { test } from "node:test";
import assert from "node:assert/strict";
import { assertionsFromTap, buildReport, render, sampleState } from "./report.mjs";

const TAP = `TAP version 13
ok 1 - 1. 非空资源:拿到的是原始字节,不是信封
not ok 2 - 2. 空资源:零字节,而不是一个装着 JSON 的文件
ok 3 - 3. base64 的空资源同样是零字节
not ok 4 - 4. 请求打到 files/download
ok 5 - 5. 错误信封:抛错并带上 message,不吞掉
1..5
`;
const run = (o) => ({ arm: "no-note", run_id: "r", verdict: "PASS", contaminated: false, ...o });
const load = (r) => ({ verdict: { checks: { reference_test: { output: r.tap ?? TAP } } }, memoryChannel: { reads: 0 } });

test("TAP 逐条解析;解析不出来是未知,不是空表", () => {
  const a = assertionsFromTap(TAP);
  assert.equal(a.length, 5);
  assert.deepEqual(a.map((x) => x.ok), [true, false, true, false, true]);
  assert.equal(assertionsFromTap(""), null);
  assert.equal(assertionsFromTap(null), null);
  assert.equal(assertionsFromTap("完全不是 TAP"), null);
});

test("作废与污染的运行不计入样本,理由各自写明", () => {
  assert.deepEqual(sampleState(run({ voided: { batch: "b1" } })), { counted: false, why: "作废(b1)" });
  assert.equal(sampleState(run({ contaminated: true, contamination_rules: ["foreign_run"] })).counted, false);
  assert.match(sampleState(run({ contaminated: true, contamination_rules: ["foreign_run"] })).why, /foreign_run/);
  assert.equal(sampleState(run({ contaminated: undefined })).counted, false, "没查过就不能当干净样本用");
  assert.equal(sampleState(run({ verdict: null })).counted, false);
  assert.equal(sampleState(run({})).counted, true);
});

test("整批作废后两组都没有样本 —— 报告说未知,不给通过率", () => {
  const m = { runs: [run({ voided: { batch: "no-note-2026-09-13a" } }), run({ arm: "note", voided: { batch: "x" } })] };
  const rep = buildReport(m, load);
  assert.equal(rep.arms["no-note"].rate, null);
  assert.equal(rep.comparable, false);
  assert.equal(rep.gain, null);
  assert.match(rep.conclusion, /未知/);
  const md = render(rep, m);
  assert.match(md, /未知\(无样本\)/);
  assert.ok(!/\d+%/.test(md.split("## 每次运行")[0]), "没有样本时正文不得出现任何百分比");
});

test("零增益不写成失败", () => {
  const m = { runs: [run({ run_id: "a1", verdict: "PASS" }), run({ run_id: "b1", arm: "note", verdict: "PASS" })] };
  const rep = buildReport(m, load);
  assert.equal(rep.gain, 0);
  assert.match(rep.conclusion, /持平/);
  assert.match(rep.conclusion, /不是失败/);
});

test("有笔记组更高时给出百分点差,方向由数字决定", () => {
  const m = { runs: [
    run({ run_id: "a1", verdict: "FAIL" }), run({ run_id: "a2", verdict: "FAIL" }),
    run({ run_id: "b1", arm: "note", verdict: "PASS" }), run({ run_id: "b2", arm: "note", verdict: "PASS" })] };
  const rep = buildReport(m, load);
  assert.equal(rep.gain, 1);
  assert.match(rep.conclusion, /高出 100 个百分点/);
});

test("有笔记组反而更低时,不改写成正面,也不宣称笔记有害", () => {
  const m = { runs: [
    run({ run_id: "a1", verdict: "PASS" }), run({ run_id: "a2", verdict: "PASS" }),
    run({ run_id: "b1", arm: "note", verdict: "FAIL" }), run({ run_id: "b2", arm: "note", verdict: "PASS" })] };
  const rep = buildReport(m, load);
  assert.ok(rep.gain < 0);
  assert.match(rep.conclusion, /反而低/);
  assert.match(rep.conclusion, /不足以说明笔记有害/);
});

test("作废批次必须出现在报告正文里,连同没解决的那一半", () => {
  const m = { runs: [run({ voided: { batch: "no-note-2026-09-13a" } })],
    voided_batches: [{ batch: "no-note-2026-09-13a", runs: 16, why: "草稿留在磁盘上", gate_was_not_at_fault: "reads=0",
      detected_by: "contamination.mjs", fixes: ["跑完删工作副本"], not_fixed: "同一用户的 shell 面前没有读不到的位置", earlier_tasks: "干净" }] };
  const md = render(buildReport(m, load), m);
  assert.match(md, /作废批次:no-note-2026-09-13a(16 次)|作废批次/);
  assert.match(md, /未解决/);
  assert.match(md, /同一用户的 shell/);
});

test("副本里那份说明:命中数由数据算,两组分别报;读不到上下文时是未知不是 0", () => {
  const exposure = { why: "w", paths: ["evaluation/upstream/"], needles: ["raw bytes", "只有后者"], not_excluded_because: "x" };
  const load = (r) => ({ verdict: { checks: { reference_test: { output: TAP } } }, captureText: r.text ?? null, noteId: "skl-a", useStates: [] });
  const m = { runs: [
    run({ run_id: "a1", text: "…the success path returns raw bytes…" }),
    run({ run_id: "a2", text: "什么都没读到" }),
    run({ run_id: "b1", arm: "note", text: "raw bytes 和 只有后者 都读到了" }),
    run({ run_id: "b2", arm: "note" }),
  ] };
  const rep = buildReport(m, load, exposure);
  assert.deepEqual(rep.exposure_seen["no-note"], { counted: 2, read_it: 1, unknown: 0 });
  assert.deepEqual(rep.exposure_seen["note"], { counted: 2, read_it: 1, unknown: 1 });
  assert.equal(rep.runs.find((r) => r.run_id === "b2").exposure_hits, null, "没有上下文就是未知,不能算 0");
  const md = render(rep, m);
  assert.match(md, /工作副本里本不该有的那份说明/);
  assert.match(md, /没有清掉的原因/);
});

test("没有 copy_exposure 时不生造这一节", () => {
  const md = render(buildReport({ runs: [run({})] }, load), { runs: [] });
  assert.ok(!/工作副本里本不该有/.test(md));
});
