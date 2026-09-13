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

test("带提交号、日期或「彩排」的是历史记录,不参与比较", () => {
  assert.deepEqual(statedSizes("验收复跑(HEAD 16189f9)套件 702/702"), []);
  assert.deepEqual(statedSizes("2026-09-12 的那次:套件 633/633"), []);
  assert.deepEqual(statedSizes("| 彩排 G | 套件 626/626(当时的数)|"), []);
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

test("真文档:README 与 STATE 里声明的当前套件规模都与实际一致", () => {
  const docs = {};
  for (const p of ["evaluation/README.md", "evaluation/STATE.md"]) docs[p] = readFileSync(p, "utf8");
  const stated = Object.entries(docs).flatMap(([p, md]) => statedSizes(md).map((s) => ({ p, ...s })));
  assert.ok(stated.length >= 1, "至少 README 里要有一处声明");
  const n = stated[0].stated;
  for (const s of stated) assert.equal(s.stated, n, `${s.p}:${s.line} 与其他声明不一致`);
});
