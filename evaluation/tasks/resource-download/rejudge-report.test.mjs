import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fidelityOf, parseRows, render, summarise } from "./rejudge-report.mjs";

const r = (o) => ({ run_id: "x", arm: "note", rejudged: true, before: [], after: [], changed: false, ...o });
const MAN = { runs: [
  { run_id: "n1", arm: "note", batch: "3", sample: true, contaminated: false },
  { run_id: "n2", arm: "note", batch: "3", sample: true, contaminated: true, contamination_rules: ["foreign_run_access"] },
  { run_id: "z1", arm: "no-note", batch: "3", sample: true, contaminated: false },
] };

test("逐行解析", () => {
  assert.equal(parseRows('{"run_id":"a"}\n\n').length, 1);
  assert.deepEqual(parseRows(""), []);
});

test("污染的运行不计入 —— 与报告同一口径", () => {
  const s = summarise([r({ run_id: "n1", after: ["used"] }), r({ run_id: "n2", after: ["used"] }), r({ run_id: "z1", arm: "no-note" })], MAN);
  assert.equal(s.byBatch["3"].note.counted, 1, "污染那次不算");
  assert.equal(s.byBatch["3"].note.with_used_after, 1);
  assert.equal(s.byBatch["3"].note.with_used_before, 0);
  assert.equal(s.excluded_contaminated.length, 1);
});

test("无笔记组重判后仍是零事件 —— 出现任何一条都要报出来", () => {
  const ok = summarise([r({ run_id: "z1", arm: "no-note" })], MAN);
  assert.equal(ok.byBatch["3"]["no-note"].with_any_event_after, 0);
  const bad = summarise([r({ run_id: "z1", arm: "no-note", after: ["needs_review"] })], MAN);
  assert.equal(bad.byBatch["3"]["no-note"].with_any_event_after, 1);
  assert.match(render(bad, { task2: [], baseline: [] }, MAN), /无笔记组出现了笔记事件/);
});

test("跳过的运行连原因一起列出,不折成「没有 used」", () => {
  const s = summarise([r({ run_id: "n1", rejudged: false, why: "判别值已烧毁" })], MAN);
  assert.equal(s.skipped.length, 1);
  assert.equal(s.byBatch["3"]?.note?.counted ?? 0, 0, "跳过的不进分母");
  assert.match(render(s, { task2: [], baseline: [] }, MAN), /判别值已烧毁/);
});

test("保真对照:任何一次对不上都要点名,全对才说可信", () => {
  assert.equal(fidelityOf([r({ changed: false }), r({ changed: false })]).ok, true);
  const bad = fidelityOf([r({ run_id: "q", changed: true, before: ["used"], after: [] })]);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.changed, ["q"]);
  assert.match(render(summarise([], MAN), { task2: [r({ run_id: "q", changed: true })], baseline: [] }, MAN), /重放装置不可信/);
});

test("真文件:入库的三份 rows 自洽,且基线保真全过", () => {
  const h = "evaluation/tasks/resource-download";
  const base = parseRows(readFileSync(`${h}/rejudge-baseline-rows.jsonl`, "utf8"));
  assert.equal(fidelityOf(base).ok, true, "基线必须一字不差复现");
  const ctrl = parseRows(readFileSync(`${h}/rejudge-control-task2-rows.jsonl`, "utf8"));
  assert.equal(fidelityOf(ctrl).ok, true, "第二任务的保真对照必须全过");
  assert.ok(ctrl.some((x) => (x.before ?? []).includes("used")), "对照里必须有原本带 used 的运行,否则证伪不了");
});

// 首次生成时把「改动后的 rows」当成基线去算保真,于是 10 次全报「对不上」—— 问的是
// 「改了之后跟没改一样吗」,答案当然是否。基线必须来自单独那份 baseline rows。
test("保真那一格取的是 baseline rows,不是改动后的 rows", () => {
  const changed = [r({ run_id: "n1", before: [], after: ["used"], changed: true })];
  const baseline = [r({ run_id: "n1", before: [], after: [], changed: false })];
  const md = render(summarise(changed, MAN), { task2: baseline, baseline }, MAN);
  assert.ok(!/重放装置不可信/.test(md), "改动本身造成的差异不该被当成保真失败");
  assert.match(md, /两组都全对/);
});

// ── 第十轮复核:对照缺失当成通过、阶段失败当成「没有 used」,都是把未知折成好消息 ──
test("对照为空不算通过 —— 缺对照必须阻断(§2)", () => {
  const f = fidelityOf([]);
  assert.equal(f.ok, false);
  assert.match(f.why, /没有对照/);
  assert.match(render(summarise([], MAN), { task2: [], baseline: [] }, MAN), /重放装置不可信|没有对照/);
});

test("阶段失败记 ERROR,单独列出,并阻断结论", () => {
  const rows = [r({ run_id: "n1", rejudged: false, error: "judge-hard", why: "判决失败,不借用上一次的产物" })];
  const s = summarise(rows, MAN);
  assert.equal(s.errors.length, 1);
  assert.equal(s.errors[0].error, "judge-hard");
  assert.equal(s.skipped.length, 0, "ERROR 不该混进「按设计跳过」里");
  const md = render(s, { task2: [r({ changed: false })], baseline: [r({ changed: false })] }, MAN);
  assert.match(md, /有 1 次重判以 ERROR 收场/);
  assert.match(md, /结论不成立/);
});

test("「一字不差」比的是逐事件指纹,不只是状态名", () => {
  const same = { before_fp: ["used|tool_call|req:1|v2"], after_fp: ["used|tool_call|req:1|v2"] };
  const moved = { before_fp: ["used|tool_call|req:1|v2"], after_fp: ["used|tool_call|req:9|v2"] };
  assert.equal(fidelityOf([r({ ...same, changed: false })]).compares_fingerprints, true);
  assert.equal(fidelityOf([r({ ...moved, changed: true })]).ok, false, "状态名相同但落点不同,必须算变了");
});

test("真文件:入库的 rows 带逐事件指纹", () => {
  const h = "evaluation/tasks/resource-download";
  const rows = parseRows(readFileSync(`${h}/rejudge-rows.jsonl`, "utf8")).filter((x) => x.rejudged);
  assert.ok(rows.length > 0);
  for (const x of rows) assert.ok(Array.isArray(x.before_fp) && Array.isArray(x.after_fp), `${x.run_id} 缺指纹字段`);
});

test("展示边界必须在:事后补录的索引,不能单凭 used 宣称任务成功由笔记造成", () => {
  const md = render(summarise([], MAN), { task2: [r({ changed: false })], baseline: [r({ changed: false })] }, MAN);
  assert.match(md, /事后补录的资产索引/);
  assert.match(md, /不能.*单凭 `used` 宣称任务成功由这条笔记造成/);
  assert.match(md, /逐事件指纹/);
});
