import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { RULES_VERSION, batchVerdict, commandsFromCapture, excludedForContamination, main, referenceFingerprints, sampleRunsOf, scanCapture, scanDisk, taskNeedles, tokensIn } from "./contamination.mjs";

const sha = (s) => createHash("sha256").update(s).digest("hex");
const REF = `
import { test } from "node:test";
test("1. 非空资源:拿到的是原始字节,不是信封", async () => {});
test("4. 请求打到 files/download —— files/read 无论加不加 -o 都只回 JSON 信封", async () => {});
test("x", () => {});
`;

test("用例标题就是指纹,太短的标题不算", () => {
  const f = referenceFingerprints(REF);
  assert.equal(f.length, 2);
  assert.ok(f[1].includes("files/download"));
});

const OWN = "/private/tmp/topic4-sessions/20260913T112941Z-devloop-no-note.k26K/session";

test("把共享根目录整个列一遍就是在枚举别人的运行", () => {
  const cmds = ["ls -la /private/tmp/topic4-sessions/ && grep -rln x /private/tmp/topic4-sessions/"];
  const r = scanCapture({ text: "", runId: "20260913T112941Z-devloop-no-note", ownPaths: [OWN], commands: cmds });
  assert.equal(r.contaminated, true);
  assert.deepEqual(r.findings.map((f) => f.rule), ["foreign_run_access"]);
});

test("命令点到别的运行的目录 —— 污染", () => {
  const cmds = ["cat /private/tmp/topic4-sessions/20260913T111005Z-devloop-no-note.0r6T/session/a.mjs"];
  assert.equal(scanCapture({ text: "", runId: "20260913T112941Z-devloop-no-note", ownPaths: [OWN], commands: cmds }).contaminated, true);
});

test("自己的目录不算污染,自己目录的父目录也不算(run.json 里就记着它)", () => {
  const cmds = [`cd ${OWN} && git status`, `ls ${OWN}/..`];
  assert.equal(scanCapture({ text: "", runId: "20260913T112941Z-devloop-no-note", ownPaths: [OWN, OWN.replace(/\/session$/, "")], commands: cmds }).contaminated, false);
});

test("别的运行的路径出现在**读到的文本**里不算污染 —— 仓库自己的交付文档就引用着它们", () => {
  // 2026-09-13 三次因此被误报:它们只是在自己的副本里读了 evaluation/delivery/… 那些报告
  const rows = [{ body: { json: { messages: [
    { role: "assistant", tool_calls: [{ function: { arguments: JSON.stringify({ command: `cat ${OWN}/evaluation/delivery/2026-09-13c/REPORT.md` }) } }] },
    { role: "tool", content: "Stdout: needs_review ← Bash cd /private/tmp/topic4-sessions/20260911T185119Z-devloop-note.1pXe/session && node --test" },
  ] } } }];
  const text = JSON.stringify(rows[0]);
  const r = scanCapture({ text, runId: "20260913T124050Z-devloop-note", ownPaths: [OWN], commands: commandsFromCapture(rows) });
  assert.equal(r.contaminated, false, JSON.stringify(r.findings));
});

test("省略号写出来的路径不是路径(文档里的 …/session)", () => {
  const r = scanCapture({ text: "", runId: "r1", ownPaths: [OWN], commands: ["grep x /private/tmp/topic4-sessions/.../session"] });
  assert.equal(r.contaminated, false);
});

test("commandsFromCapture 只取 tool_calls 的参数,工具回显一概不算", () => {
  const rows = [{ body: { json: { messages: [
    { role: "assistant", tool_calls: [{ function: { arguments: JSON.stringify({ command: "ls /a" }) } }, { function: { arguments: JSON.stringify({ path: "/c" }) } }] },
    { role: "tool", content: 'Command: cat /b' },
  ] } } }];
  assert.deepEqual(commandsFromCapture(rows), ["ls /a", "/c"]);
});

test("参考测试的标题出现在上下文里 —— 它只在验收时才写进工作副本,模型不该见过", () => {
  const text = 'Stdout: test("4. 请求打到 files/download —— files/read 无论加不加 -o 都只回 JSON 信封", ...)';
  const r = scanCapture({ text, runId: "r1", fingerprints: referenceFingerprints(REF) });
  assert.deepEqual(r.findings.map((f) => f.rule), ["reference_leak"]);
});

test("判别值:无笔记组见到即污染,有笔记组见到是正常的", () => {
  const opts = { tokenPattern: "(bt-[a-z0-9]+)", tokenSha256: [sha("bt-realvalue1")] };
  const text = "the note says bt-realvalue1";
  assert.equal(scanCapture({ text, runId: "r1", ...opts, noteExpected: false }).contaminated, true);
  assert.equal(scanCapture({ text, runId: "r1", ...opts, noteExpected: true }).contaminated, false);
});

test("只认登记过的判别值 —— 形状像但没登记的串不作数", () => {
  assert.deepEqual(tokensIn("bt-madeup999 and bt-realvalue1", { tokenPattern: "(bt-[a-z0-9]+)", tokenSha256: [sha("bt-realvalue1")] }), ["bt-realvalue1"]);
});

test("开跑前扫盘按内容找答案,不按路径找 —— 上一次的污染源在 /private/tmp/scen-check,不在共享根下", () => {
  const root = mkdtempSync(join(tmpdir(), "contam-"));
  const stray = join(root, "scen-check");
  mkdirSync(stray);
  writeFileSync(join(stray, "fetch-resource.mjs"), 'test("4. 请求打到 files/download —— files/read 无论加不加 -o 都只回 JSON 信封", () => {});');
  const needles = referenceFingerprints(REF);
  assert.equal(scanDisk({ roots: [], extraRoots: [root], needles }).clean, false);
  assert.equal(scanDisk({ roots: [], extraRoots: [join(root, "nothing-here")], needles }).clean, true);
});

test("taskNeedles 从任务目录读出指纹与哈希,退休掉的旧值也要认", () => {
  const dir = mkdtempSync(join(tmpdir(), "task-"));
  mkdirSync(join(dir, "reference"));
  writeFileSync(join(dir, "reference", "regression.reference.mjs"), REF);
  writeFileSync(join(dir, "tokens.json"), JSON.stringify({
    _note: "x",
    "skl-a": { token_pattern: "(bt-[a-z0-9]+)", token_sha256: [sha("bt-current")] },
    _history: [{ asset_id: "skl-a", token_sha256: [sha("bt-retired")] }],
  }));
  const n = taskNeedles(dir);
  assert.equal(n.fingerprints.length, 2);
  assert.ok(n.tokenSha256.includes(sha("bt-current")), "当前值要在册");
  assert.ok(n.tokenSha256.includes(sha("bt-retired")), "退休的旧值也要在册 —— 旧值同样泄露答案");
});

test("每份判定都带规则版本 —— 规则改过,旧判定不能被静默改写", () => {
  const r = scanCapture({ text: "", runId: "r1" });
  assert.equal(r.rules_version, RULES_VERSION);
  assert.match(RULES_VERSION, /^contamination-\d{4}-\d{2}-\d{2}[a-z]$/);
});

// ── 2026-09-13 自查补的三条 ──
test("不带斜杠地点到共享根目录同样是枚举 —— 首版只有带斜杠才抓得住", () => {
  const r = scanCapture({ text: "", runId: "r1", ownPaths: [OWN, OWN.replace(/\/session$/, "")], commands: ["ls -la /private/tmp/topic4-sessions"] });
  assert.equal(r.contaminated, true, JSON.stringify(r.findings));
});

test("/tmp/… 与 /private/tmp/… 是同一个目录(macOS 的符号链接):别人的算污染,自己的不算", () => {
  const foreign = scanCapture({ text: "", runId: "r1", ownPaths: [OWN], commands: ["cat /tmp/topic4-sessions/20260913T111005Z-devloop-no-note.0r6T/session/a.mjs"] });
  assert.equal(foreign.contaminated, true);
  const own = scanCapture({ text: "", runId: "r1", ownPaths: [OWN], commands: [`cd ${OWN.replace("/private/tmp/", "/tmp/")} && ls`] });
  assert.equal(own.contaminated, false, JSON.stringify(own.findings));
});

test("命令从每一条请求里取并按 id 去重,不只看最长的那份对话", () => {
  const tc = (id, command) => ({ id, function: { arguments: JSON.stringify({ command }) } });
  const rows = [
    { body: { json: { messages: [{ role: "assistant", tool_calls: [tc("c1", "ls /a")] }, { role: "tool" }, { role: "assistant", tool_calls: [tc("c2", "ls /b")] }] } } },
    { body: { json: { messages: [{ role: "assistant", tool_calls: [tc("c9", "ls /z")] }] } } },   // 另一段更短的对话(子代理)
    { body: { json: { messages: [{ role: "assistant", tool_calls: [tc("c1", "ls /a")] }] } } },   // 同一调用再次出现
  ];
  assert.deepEqual(commandsFromCapture(rows).sort(), ["ls /a", "ls /b", "ls /z"]);
});

// ── --batch:验收用 ──
test("样本的选取:作废的与标成非样本的不算", () => {
  const m = { runs: [{ run_id: "a" }, { run_id: "b", voided: { batch: "x" } }, { run_id: "c", sample: false }, { run_id: "d", sample: true }] };
  assert.deepEqual(sampleRunsOf(m).map((r) => r.run_id), ["a", "d"]);
});

test("一批的总判:未知与污染同样不过,干净必须是明确的 false", () => {
  assert.equal(batchVerdict([{ run_id: "a", contaminated: false }, { run_id: "b", contaminated: false }]).ok, true);
  const v = batchVerdict([{ run_id: "a", contaminated: false }, { run_id: "b", contaminated: null }, { run_id: "c", contaminated: true }]);
  assert.equal(v.ok, false); assert.deepEqual(v.bad, ["b", "c"]); assert.equal(v.unknown, 1); assert.equal(v.contaminated, 1);
});

// ── 2026-09-13:--batch 缺省时被拼成字符串 "null",检查器去读一个叫 null 的文件而崩溃 ──
test("没给的参数就是「没给」,不能变成字符串 'null'", async () => {
  const { readFileSync, mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const d = mkdtempSync(join(tmpdir(), "argnull-"));
  writeFileSync(join(d, "capture.jsonl"), JSON.stringify({ body: { json: { messages: [] } } }) + "\n");
  writeFileSync(join(d, "run.json"), JSON.stringify({ run_id: "r1", session: { cwd: "/x/y" } }));
  const task = mkdtempSync(join(tmpdir(), "argtask-"));
  // 不传 --batch:必须走单次检查的分支并正常返回,而不是去 open('null')
  const rc = await main([`--run=${d}`, `--task=${task}`, "--arm=no-note"]);
  assert.equal(rc, 0, "没给 --batch 时不该崩,也不该被当成批量模式");
  assert.ok(readFileSync(join(d, "capture.jsonl"), "utf8").length > 0);
});

// ── 2026-09-13:检查器与报告对「样本」的定义打架,导致验收永远红 ──
// 清单只追加,污染的运行永远留在里面;报告对它们返回 counted:false(记录 6 / 计入 5 / 排除 1),
// 而 sampleRunsOf 把它们当样本,于是「样本里有污染」永真。作废本来就是对付污染的正解。
// 改法**只去掉这一点**:已判污染的不进扫描集;真正计入的那些仍逐次重新扫盘,未知照样阻断。
test("已判污染的运行不进扫描集 —— 报告也不计入它们", () => {
  const m = { runs: [
    { run_id: "a", sample: true, contaminated: false },
    { run_id: "b", sample: true, contaminated: true },
    { run_id: "c", sample: false },
    { run_id: "d", sample: true, voided: { batch: "x" } },
  ] };
  assert.deepEqual(sampleRunsOf(m).map((r) => r.run_id), ["a"]);
  assert.equal(excludedForContamination(m).length, 1, "排掉的要数出来,不能悄悄消失");
  assert.equal(excludedForContamination(m)[0].run_id, "b");
});

test("严格性不变:计入的那些里出现未知或污染,照样不过", () => {
  assert.equal(batchVerdict([{ run_id: "a", contaminated: false }]).ok, true);
  assert.equal(batchVerdict([{ run_id: "a", contaminated: null }]).ok, false, "未知同样阻断");
  assert.equal(batchVerdict([{ run_id: "a", contaminated: true }]).ok, false, "重新扫盘扫出来的污染仍要阻断");
});
