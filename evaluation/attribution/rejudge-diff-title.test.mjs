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
