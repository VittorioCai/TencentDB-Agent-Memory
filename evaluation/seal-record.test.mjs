import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LIVE_ONLY, parseRows, render, summarise } from "./seal-record.mjs";

const row = (step, exit = 0, diff = null, note = "x") => ({ step, exit, diff_lines: diff, note });
const OPTS = { commit: "abc1234", url: "https://example.invalid/repo", archive: "evaluation/delivery/SEAL-abc1234/rows.jsonl" };

test("逐行解析 rows.jsonl", () => {
  assert.equal(parseRows('{"step":"a","exit":0,"diff_lines":null,"note":"n"}\n').length, 1);
  assert.deepEqual(parseRows(""), []);
});

test("统计:带 diff 的份数、其中非 0 的、离线是否全过", () => {
  const s = summarise([row("suite"), row("calibration", 0, 0), row("conditions-check", 1), row("selfcheck", 1)]);
  assert.equal(s.steps, 4);
  assert.equal(s.diffed, 1);
  assert.deepEqual(s.diff_non_zero, []);
  assert.equal(s.offline_ok, true, "线上依赖的两步失败不算离线失败");
});

test("离线步骤失败会被算进去,并点名", () => {
  const s = summarise([row("suite", 1), row("calibration", 0, 3)]);
  assert.equal(s.offline_ok, false);
  assert.deepEqual(s.offline_bad.sort(), ["calibration", "suite"]);
});

test("结论句由数据决定:全 0 就说全部 0 行,有差异就点名", () => {
  const clean = render([row("calibration", 0, 0), row("summary", 0, 0)], OPTS);
  assert.match(clean, /全部 0 行/);
  assert.match(clean, /离线复算全部通过/);
  const dirty = render([row("calibration", 0, 2)], OPTS);
  assert.match(dirty, /其中 calibration 有差异/);
  assert.match(dirty, /离线复算未通过:calibration/);
  assert.ok(!/全部 0 行/.test(dirty), "有差异时不得还写「全部 0 行」");
});

test("线上依赖那一节逐步给出本次实际记到的说明;缺这一步要说缺,不能装作跑过", () => {
  const md = render([row("suite")], OPTS);
  for (const step of Object.keys(LIVE_ONLY)) assert.ok(md.includes(`\`${step}\``), `${step} 应出现`);
  assert.match(md, /本次没有这一步/);
});

test("提交号与链接来自参数,不写死在正文里", () => {
  const md = render([row("suite")], OPTS);
  assert.match(md, /abc1234/);
  assert.match(md, /example\.invalid\/repo\/tree\/topic4-attribution-gate/);
  assert.match(md, /compare\/0468a2a\.\.\.c372d80/);
});

test("剩余缺点一节必须在,且写明第三任务的归因未闭合", () => {
  const md = render([row("suite")], OPTS);
  assert.match(md, /剩余缺点/);
  assert.match(md, /needs_review/);
  assert.match(md, /卡在取回通道/);
  assert.match(md, /评测设计的缺口,不是产品缺陷/);
  assert.match(md, /都不是根因/, "早先两次归因错了要如实留着,不能抹掉");
});

test("真文件:入库的 SEAL-CHECK.md 与从入库 rows.jsonl 重算的一致", () => {
  const rows = parseRows(readFileSync("evaluation/delivery/SEAL-f8c1a7f/rows.jsonl", "utf8"));
  const md = render(rows, {
    commit: "f8c1a7f99ae8e8ca9b62d90f8ca5a5e9707b44f6",
    url: "https://github.com/VittorioCai/TencentDB-Agent-Memory",
    archive: "evaluation/delivery/SEAL-f8c1a7f/rows.jsonl",
  });
  assert.equal(md, readFileSync("evaluation/SEAL-CHECK.md", "utf8"));
});
