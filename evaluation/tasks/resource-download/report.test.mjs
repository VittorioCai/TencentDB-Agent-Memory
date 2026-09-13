import { test } from "node:test";
import assert from "node:assert/strict";
import { assertionsFromTap, buildReport, render, sampleSizeLine, sampleState } from "./report.mjs";

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
  const cap = (t) => JSON.stringify({ body: { json: { messages: [{ role: "tool", content: t }] } } });
  const load = (r) => ({ verdict: { checks: { reference_test: { output: TAP } } }, captureText: r.text ?? null, noteId: "skl-a", useStates: [] });
  const m = { runs: [
    run({ run_id: "a1", text: cap("…the success path returns raw bytes…") }),
    run({ run_id: "a2", text: cap("什么都没读到") }),
    run({ run_id: "b1", arm: "note", text: cap("raw bytes 和 只有后者 都读到了") }),
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

test("污染规则改过几版,报告就列几版 —— 上一版的理由不能被最新版挤掉", () => {
  const m = { runs: [run({})], contamination_rejudged: { rules_version: "c", why: "c 为什么", effect: "c 影响",
    previous: { rules_version: "b", why: "b 为什么", effect: "b 影响", note: "b 备注" } } };
  const md = render(buildReport(m, load), m);
  assert.match(md, /重判\(c\)/); assert.match(md, /重判\(b\)/);
  assert.match(md, /b 为什么/); assert.match(md, /b 备注/);
  assert.ok(md.indexOf("重判(c)") < md.indexOf("重判(b)"), "最新的在前");
});

test("样本量那句由计入样本数算出,只说方向不说幅度,没有 p 值", () => {
  const m = { runs: [run({ run_id: "a1" }), run({ run_id: "a2" }), run({ run_id: "b1", arm: "note" })] };
  const line = sampleSizeLine(buildReport(m, load));
  assert.match(line, /无笔记 2 次、有笔记 1 次/);
  assert.match(line, /只能说明方向/);
  assert.ok(!/p\s*[=≈<]/.test(line) && !/显著/.test(line), "不写显著性");
  assert.match(sampleSizeLine(buildReport({ runs: [run({})] }, load)), /尚不构成两组比较/);
});

// ── 第二批开跑前定死形状:两批**永不合并**(CLAUDE.md:更换条件不与旧口径合并) ──
test("按批次分组,各批各报,绝不合在一起算", () => {
  const m = { runs: [
    run({ run_id: "a1", batch: "1", verdict: "FAIL" }),
    run({ run_id: "b1", batch: "1", arm: "note", verdict: "PASS" }),
    run({ run_id: "a2", batch: "2", verdict: "FAIL" }),
    run({ run_id: "b2", batch: "2", arm: "note", verdict: "FAIL" }),
  ] };
  const rep = buildReport(m, load);
  assert.deepEqual(Object.keys(rep.batches).sort(), ["1", "2"]);
  assert.equal(rep.batches["1"].arms["note"].pass, 1);
  assert.equal(rep.batches["2"].arms["note"].pass, 0, "第二批的结果不能被第一批带上去");
  assert.equal(rep.batches["1"].gain, 1);
  assert.equal(rep.batches["2"].gain, 0);
});

test("没标批次的旧运行归入第一批,不丢", () => {
  const rep = buildReport({ runs: [run({ run_id: "x" })] }, load);
  assert.ok(rep.batches["1"], JSON.stringify(Object.keys(rep.batches)));
});

test("渲染时每批一节,并各自带自己的结论句", () => {
  const m = { runs: [
    run({ run_id: "a1", batch: "1", verdict: "FAIL" }), run({ run_id: "b1", batch: "1", arm: "note", verdict: "PASS" }),
    run({ run_id: "a2", batch: "2", verdict: "PASS" }), run({ run_id: "b2", batch: "2", arm: "note", verdict: "PASS" }) ] };
  const md = render(buildReport(m, load), m);
  assert.match(md, /第一批/);
  assert.match(md, /第二批/);
  assert.match(md, /持平/, "第二批打平要如实写成持平");
  assert.match(md, /这 2 批不合并/, "必须明说不合并,且批数由数据决定");
  assert.ok(!/两批合计|合计通过率|总体通过率/.test(md), "不得给出合计口径");
});

test("作废让某组更好看时,必须同时给出「把作废的按原判决计回去」的数 —— 由计算得出,不手写", () => {
  const m = { runs: [
    run({ run_id: "a1", batch: "2", verdict: "FAIL" }),
    run({ run_id: "b1", batch: "2", arm: "note", verdict: "PASS" }),
    run({ run_id: "b2", batch: "2", arm: "note", verdict: "FAIL", contaminated: true, contamination_rules: ["foreign_run_access"] }),
  ] };
  const st = buildReport(m, load).batches["2"];
  assert.equal(st.arms["note"].counted, 1);
  assert.equal(st.arms["note"].pass, 1);
  assert.deepEqual(st.if_voided_counted["note"], { counted: 2, pass: 1 }, "计回去应当是 1/2");
  assert.equal(st.void_flatters.includes("note"), true, "作废抬高了该组,必须标出来");
  const md = render(buildReport(m, load), m);
  assert.match(md, /把被作废的.*计回去/);
});

test("作废不影响或压低某组时,不标「更好看」", () => {
  const m = { runs: [
    run({ run_id: "b1", batch: "2", arm: "note", verdict: "PASS" }),
    run({ run_id: "b2", batch: "2", arm: "note", verdict: "PASS", contaminated: true, contamination_rules: ["x"] }),
  ] };
  const st = buildReport(m, load).batches["2"];
  assert.equal(st.void_flatters.includes("note"), false);
});

// ── 第九轮复核:整份抓包扫字符串,模型自己写出来的也被记成「读到」 ──
const capOf = (msgs) => JSON.stringify({ body: { json: { messages: msgs } } });
const NEEDLE = "| `files/download`, success | **0** |";
const EXP = { why: "w", paths: ["evaluation/upstream/"], needles: [NEEDLE], not_excluded_because: "x" };
const loadCap = (r) => ({ verdict: { checks: { reference_test: { output: TAP } } }, captureText: r.cap ?? null, noteId: "skl-a", useStates: [] });

test("模型自己在 assistant 消息里写出特征文本,不算输入侧命中", () => {
  const m = { runs: [run({ run_id: "r1", cap: capOf([{ role: "assistant", content: "我猜是 " + NEEDLE }]) })] };
  const rep = buildReport(m, loadCap, EXP);
  assert.equal(rep.runs[0].exposure_hits, 0, "assistant 自己写的不算");
});

test("工具回显或 user 消息里出现,才算输入侧命中", () => {
  for (const role of ["tool", "user"]) {
    const m = { runs: [run({ run_id: "r1", cap: capOf([{ role, content: "Stdout: " + NEEDLE }]) })] };
    assert.equal(buildReport(m, loadCap, EXP).runs[0].exposure_hits, 1, role);
  }
});

test("抓包读不出来仍是未知,不折成 0", () => {
  const m = { runs: [run({ run_id: "r1" })] };
  assert.equal(buildReport(m, loadCap, EXP).runs[0].exposure_hits, null);
});

test("曝光统计按批次分开,不合并", () => {
  const m = { runs: [
    run({ run_id: "a1", batch: "1", cap: capOf([{ role: "tool", content: NEEDLE }]) }),
    run({ run_id: "a2", batch: "2", cap: capOf([{ role: "tool", content: "什么都没有" }]) }),
  ] };
  const rep = buildReport(m, loadCap, EXP);
  assert.equal(rep.batches["1"].exposure_seen["no-note"].read_it, 1);
  assert.equal(rep.batches["2"].exposure_seen["no-note"].read_it, 0);
  const md = render(rep, m);
  assert.ok(!/无笔记 \| 10 \|/.test(md), "不得出现两批合计的曝光数");
});

test("样本量那句也按批次给", () => {
  const m = { runs: [
    run({ run_id: "a1", batch: "1" }), run({ run_id: "b1", batch: "1", arm: "note" }),
    run({ run_id: "a2", batch: "2" }), run({ run_id: "b2", batch: "2", arm: "note" }) ] };
  const md = render(buildReport(m, loadCap, EXP), m);
  assert.equal((md.match(/样本量:/g) ?? []).length, 2, "两批各一句");
});

test("归因为什么闭不上:逐批数服务端受信行,0 行要明说是证据没被写下来", () => {
  const ld = (r) => ({ verdict: { checks: { reference_test: { output: TAP } } }, captureText: null,
    noteId: "skl-a", useStates: r.uses ?? [], bridgeCalls: r.bc ?? null });
  const m = { runs: [
    run({ run_id: "a1", batch: "1", bc: 11, uses: ["needs_review"] }),
    run({ run_id: "b1", batch: "2", bc: 0, uses: ["needs_review"] }),
    run({ run_id: "b2", batch: "2", arm: "note", bc: 0, uses: [] }),
  ] };
  const rep = buildReport(m, ld);
  assert.equal(rep.batches["1"].bridge_calls.runs_with_rows, 1);
  assert.equal(rep.batches["1"].bridge_calls.max, 11, "给的是这次运行自己的行数,不是跨运行的和");
  assert.equal(rep.batches["2"].bridge_calls.runs_with_rows, 0, "一次都没有");
  const md = render(rep, m);
  assert.match(md, /服务端受信行/);
  assert.match(md, /0 行/);
});

test("受信行数读不出来是未知,不当成 0", () => {
  const ld = () => ({ verdict: { checks: { reference_test: { output: TAP } } }, captureText: null, noteId: "skl-a", useStates: [], bridgeCalls: null });
  const rep = buildReport({ runs: [run({ run_id: "x", batch: "1" })] }, ld);
  assert.equal(rep.batches["1"].bridge_calls.unknown, 1);
  assert.equal(rep.batches["1"].bridge_calls.max, null, "读不出来就没有分布,不折成 0");
  assert.equal(rep.batches["1"].bridge_calls.unknown, 1);
});

// ── 第三批(2026-09-13 晚):落点恢复之后,受信行与采用判定这两格都要说对 ──

test("受信行只数这次运行自己的:导出窗口是 30 分钟,文件里装着别的运行的行", () => {
  const m = { runs: [
    run({ run_id: "a", batch: "3", bc: 3 }),
    run({ run_id: "b", batch: "3", arm: "note", bc: 3 }),
  ] };
  const ld = (r) => ({ ...load(r), bridgeCalls: r.bc });
  const bc = buildReport(m, ld).batches["3"].bridge_calls;
  assert.equal(bc.runs_with_rows, 2);
  assert.equal(bc.per_run_own, true, "必须声明这是每次运行自己的行");
  const md = render(buildReport(m, ld), m);
  assert.ok(!/合计 \*\*\d+ 行\*\*/.test(md), "跨运行相加没有意义,不许给出一个合计数");
  assert.match(md, /不给跨运行的合计/);
  assert.match(md, /每次运行自己的/);
});

test("采用判定按批汇总:有没有 used,没有就说卡在哪一步", () => {
  const m = { runs: [
    run({ run_id: "a", batch: "3", arm: "note", st: ["needs_review", "needs_review"] }),
    run({ run_id: "b", batch: "3", arm: "note", st: ["needs_review"] }),
  ] };
  const ld = (r) => ({ ...load(r), noteId: "skl-a", useStates: r.st ?? [] });
  const at = buildReport(m, ld).batches["3"].attribution;
  assert.equal(at.runs_with_used, 0);
  assert.equal(at.runs_with_needs_review, 2);
  assert.equal(at.closed, false);
  const md = render(buildReport(m, ld), m);
  assert.match(md, /0 次 `used`/);
  assert.match(md, /REJUDGE-POOL\.md/, "没有 used 时必须指向重判页,不能只说结论");
  assert.match(md, /不在判决规则,在喂给它的资产池/);
});

test("有 used 就如实说闭合,不写死成失败", () => {
  const m = { runs: [run({ run_id: "a", batch: "3", arm: "note", st: ["used"] })] };
  const ld = (r) => ({ ...load(r), noteId: "skl-a", useStates: r.st ?? [] });
  const at = buildReport(m, ld).batches["3"].attribution;
  assert.equal(at.runs_with_used, 1);
  assert.equal(at.closed, true);
  assert.match(render(buildReport(m, ld), m), /闭合/);
});

test("读不出来的运行算未知,不折成 0(§2)", () => {
  const m = { runs: [run({ run_id: "a", batch: "3", arm: "note" })] };
  const ld = (r) => ({ ...load(r), noteId: "skl-a", useStates: null, bridgeCalls: null });
  const st = buildReport(m, ld).batches["3"];
  assert.equal(st.attribution.unknown, 1);
  assert.equal(st.bridge_calls.unknown, 1);
  assert.match(render(buildReport(m, ld), m), /未知/);
});

test("批数由数据决定,不写死成「两批」", () => {
  const ld = (r) => ({ ...load(r), noteId: "skl-a", useStates: [] });
  const m = { runs: [run({ run_id: "a", batch: "1" }), run({ run_id: "b", batch: "2" }), run({ run_id: "c", batch: "3" })] };
  const md = render(buildReport(m, ld), m);
  assert.match(md, /这 3 批不合并/);
  assert.match(md, /第三批与第二批只差一个条件/, "第三批变的是落点,要说出来");
});
