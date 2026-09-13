/**
 * 相关性筛选的展示。第六轮复核:"准入过滤与任务相关性筛选要分开"——它们是**两个不同的执行者**
 * 在**两个不同的问题**上做的过滤:
 *   - 准入:产品闸门问"这份资产可不可以被送达",与当前任务无关;
 *   - 相关性:模型自己检索时问"这份资产和我手头的事有没有关系"。
 * 把两者混成一句"筛掉了 N 项",就看不出到底是产品拦的还是模型没要。
 *
 * 另一条硬规则:**没有测量的东西不报**。这里能数的是字符数,不是 token —— 手边没有分词器,
 * 就说字符数,不拿 chars/4 之类的估算冒充 token 数。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { selectionView, ADMIT_STATES } from "./selection.mjs";

const pool = [
  { asset_id: "a1", name: "note-relevant", status: "approved", visibility: "team" },
  { asset_id: "a2", name: "other-1", status: "approved", visibility: "team" },
  { asset_id: "a3", name: "other-2", status: "approved", visibility: "team" },
  { asset_id: "b1", name: "still-candidate", status: "candidate", visibility: "team" },
  { asset_id: "b2", name: "known-bad", status: "failed", visibility: "team" },
];
const calls = [
  { kind: "search", result: "…note-relevant…other-1…other-2…", chars: 300 },
  { kind: "get-by-name", result: "…note-relevant full body…", chars: 2729, fetched: "note-relevant" },
];

test("模型路径只放行 approved —— 准入状态是明示的,不是猜的", () => {
  assert.deepEqual(ADMIT_STATES, ["approved"]);
});

test("两层分开报:准入挡掉的,和准入放行但模型没要的", () => {
  const v = selectionView({ pool, calls, verdict: { verdict: "PASS" } });
  assert.equal(v.pool_total, 5);
  assert.deepEqual(v.admission.excluded.map((x) => x.name).sort(), ["known-bad", "still-candidate"]);
  assert.equal(v.admission.admitted, 3);
  assert.deepEqual(v.relevance.not_taken.sort(), ["other-1", "other-2"]);
  assert.deepEqual(v.relevance.taken, ["note-relevant"]);
});

test("被闸门挡掉的不算进「模型没要」—— 两类原因不能混", () => {
  const v = selectionView({ pool, calls, verdict: {} });
  for (const n of v.relevance.not_taken) assert.ok(!["still-candidate", "known-bad"].includes(n));
});

test("报字符数,并明说不是 token", () => {
  const v = selectionView({ pool, calls, verdict: {} });
  assert.equal(v.context.chars, 2729);
  assert.match(v.context.note, /字符/);
  assert.match(v.context.note, /不是 token|未测量 token/);
});

test("够不够完成任务,只引验收结果,不自己下结论", () => {
  const v = selectionView({ pool, calls, verdict: { verdict: "PASS", reason: "reference test passed (6/6)" } });
  assert.match(v.sufficiency, /PASS/);
  assert.match(v.sufficiency, /6\/6/);
  const u = selectionView({ pool, calls, verdict: {} });
  assert.match(u.sufficiency, /没有验收结果/);
});

test("一次检索都没有时,如实说是注入为空、模型未检索,而不是「筛掉了」", () => {
  const v = selectionView({ pool, calls: [], verdict: {} });
  assert.equal(v.relevance.searches, 0);
  assert.match(v.relevance.note, /没有发起检索/);
});
