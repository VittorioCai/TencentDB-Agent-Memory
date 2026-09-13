import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkCommitted, checkConditions, requiredExcludes } from "./check-frozen-conditions.mjs";

const TASK = { start_commit: "9e3752fe", archive_excludes: ["a", "b"] };
const TOKENS = { "skl-X": { version: 2 } };
const COND = { frozen: { start_commit: "9e3752fe", note_asset: { asset_id: "skl-X", version: 2 } } };

test("要求的排除项:认新字段,也认第二批的旧字段名", () => {
  assert.deepEqual(requiredExcludes({ frozen: { archive_excludes_required: ["a"] } }), ["a"]);
  assert.deepEqual(requiredExcludes({ changed_from_batch_1: { archive_excludes_added: ["b"] } }), ["b"]);
  assert.deepEqual(requiredExcludes({}), [], "没写就是不要求,不是报错");
});

test("三项都对就通过", () => {
  assert.deepEqual(checkConditions(COND, { task: TASK, tokens: TOKENS }), { ok: true, problems: [] });
});

test("start_commit 不符 / 排除项缺失 / 笔记版本漂了,各自点名", () => {
  const a = checkConditions(COND, { task: { ...TASK, start_commit: "deadbeef" }, tokens: TOKENS });
  assert.equal(a.ok, false);
  assert.match(a.problems[0], /start_commit/);

  const cond = { frozen: { ...COND.frozen, archive_excludes_required: ["a", "missing"] } };
  const b = checkConditions(cond, { task: TASK, tokens: TOKENS });
  assert.equal(b.ok, false);
  assert.match(b.problems.join(""), /missing/);

  const c = checkConditions(COND, { task: TASK, tokens: { "skl-X": { version: 3 } } });
  assert.equal(c.ok, false);
  assert.match(c.problems.join(""), /版本/);

  const d = checkConditions(COND, { task: TASK, tokens: {} });
  assert.equal(d.ok, false);
  assert.match(d.problems.join(""), /skl-X/);
});

// ── 冻结必须先入库:否则「先冻结再跑」无法验证,看到结果再改一行没人拦得住 ──
test("冻结文件没进 HEAD,或工作树与 HEAD 不一致,都不许跑", () => {
  assert.equal(checkCommitted({ tracked: true, dirty: false }).ok, true);
  const untracked = checkCommitted({ tracked: false, dirty: false });
  assert.equal(untracked.ok, false);
  assert.match(untracked.problems[0], /还没提交/);
  const dirty = checkCommitted({ tracked: true, dirty: true });
  assert.equal(dirty.ok, false);
  assert.match(dirty.problems[0], /与 HEAD 不一致/);
});

test("真文件:第二批的冻结条件在当前 task.json / tokens.json 下仍然成立", () => {
  const h = "evaluation/tasks/resource-download";
  const r = checkConditions(JSON.parse(readFileSync(`${h}/batch2-conditions.json`, "utf8")), {
    task: JSON.parse(readFileSync(`${h}/task.json`, "utf8")),
    tokens: JSON.parse(readFileSync(`${h}/tokens.json`, "utf8")),
  });
  assert.deepEqual(r.problems, []);
});
