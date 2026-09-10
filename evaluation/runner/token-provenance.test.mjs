/**
 * 一个 token 只有在**别处不存在**的时候,才能证明"内容来自这个资产"。
 *
 * 旧口径的 token 是部署地址(`10.244.7.19`、端口 `47318`)。它高不高熵是次要的,
 * 要害是**来源不唯一**:地址写在资产里,也写在记忆基线里、写在模型自己发出的
 * curl 命令行里、还能从部署环境读出来。命中一次 token 并不说明读了资产。
 *
 * 所以换 token 之前先跑这个检查:候选值是否已经出现在任务说明、池内其他资产、
 * 系统提示、历史记忆基线、或任何缓存里。**高熵本身不保证来源唯一。**
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { scanSources, provenanceOf, isDerivableFromDeployment } from "./token-provenance.mjs";

const src = (name, kind, text) => ({ name, kind, text });

test("token 出现在任何一个来源里,就不算干净", () => {
  const sources = [
    src("task.md", "task", "reach the bridge and report"),
    src("baseline/persona.md", "memory", "上次用 47318 成功了"),
  ];
  const v = provenanceOf("47318", sources);
  assert.equal(v.clean, false);
  assert.deepEqual(v.found_in.map((f) => f.kind), ["memory"]);
});

test("哪个来源命中要报出来,不能只说不干净", () => {
  const sources = [
    src("assets/right.md", "asset", "port 47318"),
    src("assets/wrong.md", "asset", "port 8096"),
    src("system-prompt", "system", "you are a CLI"),
  ];
  const v = provenanceOf("47318", sources);
  assert.equal(v.clean, false);
  assert.deepEqual(v.found_in.map((f) => f.name), ["assets/right.md"]);
});

test("本资产自己的正文不算污染——那正是它该在的地方", () => {
  const sources = [src("assets/right.md", "self", "marker rk-abc123")];
  const v = provenanceOf("rk-abc123", sources);
  assert.equal(v.clean, true, "kind=self 的来源要排除在外");
});

test("完全没出现过 → 干净", () => {
  const v = provenanceOf("rk-deadbeef", [src("task.md", "task", "reach the bridge")]);
  assert.equal(v.clean, true);
  assert.deepEqual(v.found_in, []);
});

test("匹配不区分大小写,且要能穿过被切开的写法", () => {
  // FTS5 的 snippet 会在标点处切分并补空格;被切开的 token 仍然是 token。
  const sources = [src("cache", "cache", "value RK- ABC123 was returned")];
  const v = provenanceOf("rk-abc123", sources);
  assert.equal(v.clean, false, "切开的写法也要算命中");
});

// ---------------------------------------------------------------------------
// 可从部署环境推导 —— 高熵挡不住的那一类
// ---------------------------------------------------------------------------

test("地址形状的值一律拒绝:它可以从部署环境读出来", () => {
  for (const bad of ["10.244.7.19", "47318", "127.0.0.1", "8096", "10.244.7.19:8096"]) {
    assert.equal(isDerivableFromDeployment(bad), true, `${bad} 应被判为可从环境推导`);
  }
});

test("随机标记不可从部署环境推导", () => {
  for (const ok of ["rk-9f2c1ab77e04", "mk-0a1b2c3d4e5f6071"]) {
    assert.equal(isDerivableFromDeployment(ok), false, `${ok} 不应被判为可推导`);
  }
});

test("太短的值即使随机也拒绝:短串会撞上无关数字", () => {
  assert.equal(isDerivableFromDeployment("ab12"), true, "长度不足,区分度无从谈起");
});

test("scanSources 逐个来源返回命中次数", () => {
  const hits = scanSources("rk-abc", [
    src("a", "memory", "rk-abc rk-abc"),
    src("b", "task", "none here"),
  ]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].name, "a");
  assert.equal(hits[0].count, 2);
});

// ---------------------------------------------------------------------------
// 扫不到 ≠ 没有 —— 2026-09-09 独立审阅 D3 / D4
// ---------------------------------------------------------------------------
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sourcesFromRun, readTextFilesUnder } from "./token-provenance.mjs";

test("捕获首行解析不出来 → 记为问题,不静默算 0 来源", () => {
  const d = mkdtempSync(join(tmpdir(), "prov-"));
  writeFileSync(join(d, "capture.jsonl"), '{"event":"http.request","body":{BROKEN');
  const r = sourcesFromRun(d);
  assert.equal(r.sources.length, 0);
  assert.equal(r.problems.length, 1, "读不出来必须说出来,否则 0 处来源会被当成扫过了");
  assert.match(r.problems[0].why, /解析/);
});

test("坏行不阻断后面的:第一条能解析的请求才算数", () => {
  const d = mkdtempSync(join(tmpdir(), "prov-"));
  const good = JSON.stringify({ event: "http.request", body: { messages: [{ role: "system", content: "港口 47318" }] } });
  writeFileSync(join(d, "capture.jsonl"), `{"event":"http.request","body":{BROKEN\n${good}\n`);
  const r = sourcesFromRun(d);
  assert.equal(r.sources.length, 1, "后面那条是好的,应该被读到");
  assert.equal(r.problems.length, 0, "有能解析的行就不算问题");
});

test("捕获文件存在但一条请求都读不出 → 也是问题", () => {
  const d = mkdtempSync(join(tmpdir(), "prov-"));
  writeFileSync(join(d, "capture.jsonl"), '{"event":"http.response","body":{}}\n');
  const r = sourcesFromRun(d);
  assert.equal(r.problems.length, 1);
});

test("超过大小上限的文件记为未扫描,不是不存在", () => {
  const d = mkdtempSync(join(tmpdir(), "prov-"));
  mkdirSync(join(d, "sub"), { recursive: true });
  writeFileSync(join(d, "sub", "huge.md"), "x".repeat(500) + " 47318");
  const r = readTextFilesUnder(d, "memory", 100);
  assert.equal(r.files.length, 0, "确实没读");
  assert.equal(r.skipped.length, 1, "但必须报出来,不能当作扫过了");
  assert.ok(r.skipped[0].bytes > 100);
});

test("运行目录不存在 → 明确报缺输入,不是 0 来源 0 问题", () => {
  const r = sourcesFromRun("/tmp/definitely-not-a-run-dir-9f31");
  assert.equal(r.sources.length, 0);
  assert.equal(r.problems.length, 1, "指定了却不存在,是缺输入,不是扫过了没有");
  assert.match(r.problems[0].why, /不存在/);
});

test("捕获文件缺失 → 也是缺输入", () => {
  const d = mkdtempSync(join(tmpdir(), "prov-"));
  const r = sourcesFromRun(d);
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0].why, /capture\.jsonl/);
});

// ---------------------------------------------------------------------------
// 任务目录里哪些文件是模型看得到的 —— 2026-09-10
//
// tokens.json、pair.json、测试文件、条件清单都写着 token,但它们是评测的记录,
// 不会交给会话。把它们当污染源,新 token 永远通不过来源检查;把它们静默跳过,
// 又会掩盖真正的泄漏。所以分三类并写明:self(资产正文,token 的家)、record
// (评测记录,不交给会话——前提是会话在空目录里跑,由 run-once.sh 保证)、task
// (任务说明等,会交给会话,命中即污染)。
// ---------------------------------------------------------------------------
import { taskFileKind } from "./token-provenance.mjs";

test("资产正文是 self,任务说明是 task,评测记录是 record", () => {
  assert.equal(taskFileKind("assets/right.md"), "self");
  assert.equal(taskFileKind("task.md"), "task");
  assert.equal(taskFileKind("tokens.json"), "record");
  assert.equal(taskFileKind("pair.json"), "record");
  assert.equal(taskFileKind("verify.test.mjs"), "record");
  assert.equal(taskFileKind("README.md"), "record");
  assert.equal(taskFileKind("confounders.watch"), "record");
  assert.equal(taskFileKind("verify.mjs"), "record");
});

test("record 不算污染,task 算", () => {
  const sources = [
    { name: "task:tokens.json", kind: "record", text: '{"tokens":["bt-abc123xyz9"]}' },
    { name: "task:task.md", kind: "task", text: "无关内容" },
  ];
  assert.equal(provenanceOf("bt-abc123xyz9", sources).clean, true);
  sources[1].text = "请发送 bt-abc123xyz9";
  assert.equal(provenanceOf("bt-abc123xyz9", sources).clean, false);
});
