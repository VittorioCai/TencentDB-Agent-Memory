import { test } from "node:test";
import assert from "node:assert/strict";
import { compare, keyOf, parseErrors, parseLine } from "./compare-typecheck.mjs";

const e = (f, ln, code, msg) => `${f}(${ln},7): error ${code}: ${msg}`;

test("只认 tsc 的错误行,摘要行与空行不算", () => {
  assert.equal(parseLine("src/a.ts(3,7): error TS2345: bad").code, "TS2345");
  assert.equal(parseLine("Found 123 errors."), null);
  assert.equal(parseLine(""), null);
  assert.equal(parseErrors(["x", e("src/a.ts", 3, "TS1", "m")].join("\n")).length, 1);
});

test("行号不参与比较 —— 插入代码把同一条错误推下去,不能报成一增一减", () => {
  const base = e("src/a.ts", 10, "TS2345", "bad thing");
  const head = e("src/a.ts", 812, "TS2345", "bad thing");
  const r = compare(base, head);
  assert.equal(r.added_count, 0);
  assert.equal(r.removed_count, 0);
  assert.equal(keyOf(parseLine(base)), keyOf(parseLine(head)), "键里不能含行列");
});

test("真正的新增与消掉都要报出来,并带样本", () => {
  const base = [e("src/a.ts", 1, "TS1", "old"), e("src/b.ts", 2, "TS2", "gone")].join("\n");
  const head = [e("src/a.ts", 5, "TS1", "old"), e("src/c.ts", 9, "TS3", "new one")].join("\n");
  const r = compare(base, head);
  assert.equal(r.added_count, 1);
  assert.equal(r.removed_count, 1);
  assert.equal(r.added[0].file, "src/c.ts");
  assert.match(r.added[0].message, /new one/);
  assert.equal(r.removed[0].file, "src/b.ts");
});

test("同一条错误重复出现按次数比,不被集合吞掉", () => {
  const base = e("src/a.ts", 1, "TS1", "dup");
  const head = [e("src/a.ts", 1, "TS1", "dup"), e("src/a.ts", 40, "TS1", "dup")].join("\n");
  const r = compare(base, head);
  assert.equal(r.added_count, 1, "第二次出现是新增的一条");
  assert.equal(r.added[0].times, 1);
});

test("--scope 只看某个子树", () => {
  const base = [e("src/metadata/x.ts", 1, "TS1", "m"), e("src/other/y.ts", 1, "TS2", "o")].join("\n");
  const head = e("src/other/y.ts", 1, "TS2", "o");
  const r = compare(base, head, { scope: "src/metadata" });
  assert.equal(r.base_count, 1);
  assert.equal(r.removed_count, 1);
});

test("消息里的绝对路径是环境不是内容 —— 两棵树在不同目录下的同一条错误不能算新增", () => {
  const base = `src/gateway/v2-schemas.ts(10,3): error TS2430: Interface 'import("/tmp/pristine/MemoryCore/src/gateway/v2-schemas").AtomicDetail' incorrectly extends interface 'import("/tmp/pristine/MemoryCore/src/gateway/generated/types").AtomicDetail'.`;
  const head = `src/gateway/v2-schemas.ts(812,3): error TS2430: Interface 'import("/Users/me/worktrees/gcm/MemoryCore/src/gateway/v2-schemas").AtomicDetail' incorrectly extends interface 'import("/Users/me/worktrees/gcm/MemoryCore/src/gateway/generated/types").AtomicDetail'.`;
  const r = compare(base, head);
  assert.equal(r.added_count, 0, JSON.stringify(r.added));
  assert.equal(r.removed_count, 0);
});

test("错误码不同就是不同的条目 —— TS2304 与 TS2552 不悄悄并成一条", () => {
  const base = `src/a.ts(1,1): error TS2304: Cannot find name 'wikiX'.`;
  const head = `src/a.ts(9,1): error TS2552: Cannot find name 'wikiX'. Did you mean 'skillX'?`;
  const r = compare(base, head);
  assert.equal(r.added_count, 1, "同一个名字换了错误码,仍要如实报出来,由读的人判断");
  assert.equal(r.removed_count, 1);
});
