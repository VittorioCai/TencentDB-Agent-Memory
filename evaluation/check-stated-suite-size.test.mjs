import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { actualFromSuiteOutput, checkStated, statedSizes } from "./check-stated-suite-size.mjs";

const OUT = "ℹ tests 729\nℹ pass 729\nℹ fail 0\n";

test("从 node --test 的摘要行读实际数;读不到是 null,不折成 0", () => {
  assert.equal(actualFromSuiteOutput(OUT), 729);
  assert.equal(actualFromSuiteOutput("什么都没有"), null);
  assert.equal(actualFromSuiteOutput(null), null);
});

test("只认当前值的写法", () => {
  assert.deepEqual(statedSizes("Full suite: 729 tests (…)").map((s) => s.stated), [729]);
  assert.deepEqual(statedSizes("套件 729/729;离线通过").map((s) => s.stated), [729]);
  assert.deepEqual(statedSizes("这里没有数字"), []);
});

test("对不上就失败,并指出文件、行号、两边各是什么", () => {
  const r = checkStated(OUT, { "a.md": "Full suite: 643 tests" });
  assert.equal(r.ok, false);
  assert.equal(r.actual, 729);
  assert.equal(r.mismatches[0].stated, 643);
  assert.equal(r.mismatches[0].path, "a.md");
  assert.equal(r.mismatches[0].line, 1);
});

test("一致就通过;实际数读不出来时不通过 —— 未知不能当通过(§2)", () => {
  assert.equal(checkStated(OUT, { "a.md": "Full suite: 729 tests" }).ok, true);
  const unknown = checkStated("跑挂了", { "a.md": "Full suite: 729 tests" });
  assert.equal(unknown.ok, false);
  assert.match(unknown.why, /读不到/);
});

// ── 2026-09-13 第八轮复核:靠日期猜历史是错的,当前声明也带日期和提交号 ──
test("带日期或提交号的行**不再**自动算历史 —— STATE 的「验证时间」行就是当前声明", () => {
  const line = "| 验证时间 | **2026-09-13T15:09Z(受测提交 `7429693`)**:套件 999/999;离线通过 |";
  const s = statedSizes(line);
  assert.equal(s.length, 1, "必须被认出来");
  assert.equal(s[0].stated, 999);
  assert.equal(s[0].historical, false);
  assert.equal(checkStated(OUT, { "STATE.md": line }).ok, false, "对不上就要失败");
});

test("历史记录靠**显式标注**,不靠猜", () => {
  const marked = "| 彩排 G | 套件 626/626(当时的数)| ";
  assert.equal(statedSizes(marked)[0].historical, true);
  assert.equal(checkStated(OUT, { "a.md": marked }).ok, true, "标了就不比");
  const unmarked = "早先那次:套件 626/626";
  assert.equal(statedSizes(unmarked)[0].historical, false, "没标就得比");
  assert.equal(checkStated(OUT, { "a.md": unmarked }).ok, false);
});

test("真文档:当前声明不止一处,且全部与实跑一致", () => {
  const docs = {};
  for (const p of ["evaluation/README.md", "evaluation/STATE.md"]) docs[p] = readFileSync(p, "utf8");
  const cur = Object.entries(docs).flatMap(([p, md]) => statedSizes(md).filter((s) => !s.historical).map((s) => ({ p, ...s })));
  assert.ok(cur.length >= 2, `当前声明应不止 README 一处,实际 ${cur.length} 处`);
  const n = cur[0].stated;
  for (const s of cur) assert.equal(s.stated, n, `${s.p}:${s.line} 与其他当前声明不一致`);
});
