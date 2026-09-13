/**
 * 这份报告的标题原来盖的是**生成当天**的日期(`new Date()`),于是提交副本和任何
 * 隔天的重新生成必然差一行——每份交付归档里 `REPARSE-DIFF.diff` 都是 4 行,
 * 而交付文档要求的是"生成报告与提交副本 diff 0"。2026-09-13 通读时发现。
 *
 * 日期本来就在数据里:复判副本的目录名(`/private/tmp/topic4-rejudge/2026-09-11`)。
 * 从它取,同一份副本无论哪天重跑都得到同一个标题。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { titleDate } from "./rejudge-diff.mjs";

test("日期取自复判副本的目录名,不是今天", () => {
  assert.equal(titleDate("/private/tmp/topic4-rejudge/2026-09-11"), "2026-09-11");
  assert.equal(titleDate("/private/tmp/topic4-rejudge/devloop-2026-09-11"), "2026-09-11");
  assert.equal(titleDate("/x/2026-09-11/"), "2026-09-11");
});

test("同一个副本路径,今天明天都算出同一个标题", () => {
  const p = "/private/tmp/topic4-rejudge/2026-09-11";
  assert.equal(titleDate(p), titleDate(p));
  assert.notEqual(titleDate(p), new Date().toISOString().slice(0, 10));
});

test("路径里没有日期就不编一个:返回 null,标题里省掉那段", () => {
  assert.equal(titleDate("/private/tmp/topic4-rejudge/copies"), null);
  assert.equal(titleDate(""), null);
});

/**
 * 2026-09-13 用全新目录从原始记录重建时暴露:同样的输入,只因复判副本的目录名不同,
 * 报告就差两行 —— 标题日期取自目录名,正文还把绝对路径印了出来。
 * 环境相关的东西不该进报告正文,否则它在别的机器上永远对不上。
 */
import { describeAfter } from "./rejudge-diff.mjs";

test("日期优先取自数据里的验收版本,与副本目录名无关", () => {
  assert.equal(titleDate("/tmp/fresh-20260913T095621Z", ["attempts-2026-09-11"]), "2026-09-11");
  assert.equal(titleDate("/tmp/2026-09-99", ["attempts-2026-09-11"]), "2026-09-11", "数据优先于目录名");
  assert.equal(titleDate("/tmp/whatever", []), null, "都没有就不写,不编");
});

test("正文不印复判副本的绝对路径", () => {
  const s = describeAfter("/private/tmp/topic4-rejudge/fresh-20260913T095621Z");
  assert.doesNotMatch(s, /private|tmp|\//);
  assert.equal(describeAfter("/a/b"), describeAfter("/c/d"), "换个目录,这句话必须一模一样");
});
