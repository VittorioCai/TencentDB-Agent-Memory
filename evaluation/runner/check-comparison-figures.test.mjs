import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COLUMN_MAP, checkFigures, parseTables, rowFor } from "./check-comparison-figures.mjs";

const SUM = `# Runs

| label | started | pass | fail |
|---|---|---|---|
| gate-off | 5 | 1 | 0 |
| gate-on | 5 | 5 | 0 |

后面还有一张表

| label | corrected | validated |
|---|---|---|
| gate-off | 2 | 1 |
| gate-on | 0 | 5 |
`;
const CMP = (off = "| gate-off | 5 | 1 | 0 | 2 | 1 |") => `# 对照

| 臂 | 起跑 | PASS | FAIL | corrected | validated |
|---|---:|---:|---:|---:|---:|
${off}
| gate-on | 5 | 5 | 0 | 0 | 5 |
`;
const MAP = { "起跑": "started", "PASS": "pass", "FAIL": "fail", "corrected": "corrected", "validated": "validated" };

test("表格解析:跳过分隔行,按表头取列名,一份文档里的多张表都取到", () => {
  const t = parseTables(SUM);
  assert.equal(t.length, 2);
  assert.equal(t[0].rows[0]["pass"], "1");
  assert.equal(t[1].rows[1]["validated"], "5");
});

test("同一臂的列从所有表里合起来;找不到返回 null", () => {
  const r = rowFor(parseTables(SUM), "gate-off");
  assert.equal(r["pass"], "1");
  assert.equal(r["corrected"], "2", "第二张表的列也要合进来");
  assert.equal(rowFor(parseTables(SUM), "gate-nope"), null);
});

test("抄对了就通过,并报出比了多少格", () => {
  const r = checkFigures(SUM, CMP(), { map: MAP });
  assert.equal(r.ok, true);
  assert.equal(r.checked, 10);
  assert.deepEqual(r.mismatches, []);
});

test("抄错一格就失败,并指出是哪一格、两边各是什么 —— 这正是 §1 出处里那种分叉", () => {
  const r = checkFigures(SUM, CMP("| gate-off | 5 | 4 | 0 | 2 | 1 |"), { map: MAP });
  assert.equal(r.ok, false);
  assert.equal(r.mismatches.length, 1);
  assert.deepEqual(r.mismatches[0], { arm: "gate-off", comparison_column: "PASS", comparison: "4", summary_column: "pass", summary: "1" });
});

test("加粗不算差异(对照报告里有 **ERROR** 这种写法)", () => {
  assert.equal(checkFigures(SUM, CMP("| gate-off | 5 | **1** | 0 | 2 | 1 |"), { map: MAP }).ok, true);
});

test("对照表少了一臂,或生成表里没有某一列,都算失败,不静默跳过", () => {
  const noArm = checkFigures(SUM, "| 臂 | 起跑 |\n|---|---|\n| gate-on | 5 |\n", { map: { "起跑": "started" } });
  assert.equal(noArm.ok, false);
  assert.equal(noArm.missing_arms[0].arm, "gate-off");
  const noCol = checkFigures(SUM, CMP(), { map: { ...MAP, "不存在的列": "nope" } });
  assert.equal(noCol.ok, false);
  assert.ok(noCol.missing_columns.length > 0);
});

test("真文件:对照报告的主表与生成的 summary 现在逐格一致", () => {
  const r = checkFigures(
    readFileSync("evaluation/runner/summary-2026-09-11-reparsed.md", "utf8"),
    readFileSync("evaluation/runner/COMPARISON-2026-09-11-reparsed.md", "utf8"),
  );
  assert.equal(r.ok, true, JSON.stringify(r.mismatches.concat(r.missing_columns, r.missing_arms)));
  assert.equal(r.checked, Object.keys(COLUMN_MAP).length * 2);
});
