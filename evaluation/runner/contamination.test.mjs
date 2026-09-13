import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { referenceFingerprints, scanCapture, scanDisk, taskNeedles, tokensIn } from "./contamination.mjs";

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

test("上下文里出现别的运行 id —— 消费者编不出这种 id,一定是读到了别人的目录", () => {
  const text = 'Command: grep -rln x /private/tmp/topic4-sessions/\n/private/tmp/topic4-sessions/20260913T111005Z-devloop-no-note.0r6T/session/a.mjs';
  const r = scanCapture({ text, runId: "20260913T112941Z-devloop-no-note", fingerprints: [] });
  assert.equal(r.contaminated, true);
  assert.deepEqual(r.findings.map((f) => f.rule), ["foreign_run"]);
  assert.deepEqual(r.findings[0].sample, ["20260913T111005Z-devloop-no-note"]);
});

test("自己的运行目录不算污染", () => {
  const text = "/private/tmp/topic4-runs/20260913T112941Z-devloop-no-note.k26K/run.json";
  assert.equal(scanCapture({ text, runId: "20260913T112941Z-devloop-no-note" }).contaminated, false);
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
