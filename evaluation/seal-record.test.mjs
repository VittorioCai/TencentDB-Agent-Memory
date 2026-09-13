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
  assert.match(md, /HEAD 比它新几个提交/, "页里的提交号必然早于分支 HEAD,要说明差的是什么");
  assert.ok(!/新一个提交|新两个提交/.test(md), "不许写死个数 —— 再提交一次就烂了");
  assert.match(md, /git log abc1234\.\.HEAD/, "要给出能自己列出差异的命令");
  assert.match(md, /abc1234/);
  assert.match(md, /example\.invalid\/repo\/tree\/topic4-attribution-gate/);
  assert.match(md, /compare\/0468a2a\.\.\.c372d80/);
});

test("剩余缺点一节必须在,且写明第三任务的归因补了什么、还剩什么", () => {
  const md = render([row("suite")], OPTS);
  assert.match(md, /剩余缺点/);
  assert.match(md, /并非每次都闭合/, "闭合了也不能写成每次都闭合");
  assert.match(md, /第一批补不上/);
  assert.match(md, /不能单凭 `used` 宣称任务成功由这条笔记造成/, "展示边界必须在");
  assert.match(md, /REJUDGE-POOL\.md/, "要指向会重算的重判页,不在这里抄数");
  assert.match(md, /改的是评测自己的采集,产品一行没动/);
  assert.match(md, /前两次都不是根因/, "改过口径要如实留着,不能抹掉");
});

test("真文件:入库的 SEAL-CHECK.md 与从入库 rows.jsonl 重算的一致", () => {
  const rows = parseRows(readFileSync("evaluation/delivery/SEAL-1891601/rows.jsonl", "utf8"));
  const md = render(rows, {
    commit: "189160174184c2a459e296e0e91f5f8898565e13",
    url: "https://github.com/VittorioCai/TencentDB-Agent-Memory",
    archive: "evaluation/delivery/SEAL-1891601/rows.jsonl",
  });
  assert.equal(md, readFileSync("evaluation/SEAL-CHECK.md", "utf8"));
});

test("实跑重判**不再**是干净克隆上跑不了的那一类 —— 判别值已烧毁并登记,离线可解析", () => {
  const md = render([row("suite")], OPTS);
  assert.ok(!/\| `rejudge-execute` \|/.test(md), "不该再列进「按设计不通过」那张表");
});

test("可见性这一条要写成「已核过什么」,并说明它证明不了什么", () => {
  const md = render([row("suite")], OPTS);
  assert.match(md, /- \[x\] \*\*上面两个链接任何人都打得开\*\*/);
  assert.match(md, /private = false/);
  assert.match(md, /证明不了某位评委那一侧/, "不能把「公开可访问」说成「评委一定打得开」");
  assert.match(md, /- \[ \] \*\*提交渠道已收到材料\*\*/, "这一条实施者做不到,必须留空");
});
