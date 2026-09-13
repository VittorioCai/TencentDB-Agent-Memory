/**
 * 池快照闸门的**位置**测试。
 *
 * 2026-09-13 第十轮复核:闸门原先排在 run-once.sh 第 472 行,而 CodeBuddy 在第 311 行就启动了 ——
 * 它只拦住了后面的归因,模型那一趟已经白烧。光比行号证不了「没被调用」,所以这里**真跑一次**:
 * 给一个登记资产不在任何快照里的任务,断言脚本非零退出,且消费者、proxy 切换、会话产物
 * **一件都没生成**。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);

test("登记资产不在快照里:脚本拒跑,且消费者/proxy/会话一件副作用都没有", () => {
  const task = mkdtempSync(join(tmpdir(), "guard-task-"));
  const records = mkdtempSync(join(tmpdir(), "guard-runs-"));
  writeFileSync(join(task, "tokens.json"), JSON.stringify({ "skl-DOESNOTEXIST": { role: "note", version: 1, token_sha256: ["dead"] } }));
  writeFileSync(join(task, "task.json"), JSON.stringify({ kind: "repo", start_commit: "HEAD", archive_excludes: [], scope: [] }));
  writeFileSync(join(task, "task.md"), "fake");
  writeFileSync(join(task, "verify.mjs"), "process.exit(0)\n");

  const r = spawnSync("bash", ["evaluation/runner/run-once.sh", "--task", task, "--auto", "--fresh-consumer", "--identity", "c", "--label", "guardtest"],
    { env: { ...process.env, RUN_RECORDS_ROOT: records }, encoding: "utf8", timeout: 120000 });

  assert.notEqual(r.status, 0, "必须非零退出");
  assert.match(r.stderr + r.stdout, /skl-DOESNOTEXIST/, "要点名缺的是哪个资产");

  const files = walk(records).map((f) => f.split("/").pop());
  for (const forbidden of ["consumer.json", "fresh-consumer.log", "prepare.log", "codebuddy-stdout.txt", "capture.jsonl"]) {
    assert.ok(!files.includes(forbidden), `闸门之后不该产生 ${forbidden},实际产生了:${files.join(", ")}`);
  }
});

test("静态顺序:闸门必须排在建消费者与启动会话之前", () => {
  const lines = readFileSync("evaluation/runner/run-once.sh", "utf8").split("\n");
  const at = (re) => lines.findIndex((l) => re.test(l));
  const guard = at(/check-pool-snapshot\.mjs/);
  const consumer = at(/fresh-consumer\.mjs/);
  const launch = at(/bash "\$EVAL\/gate0\/run-codebuddy\.sh"/);
  assert.ok(guard > 0, "闸门还在");
  assert.ok(guard < consumer, `闸门(${guard + 1})必须早于建消费者(${consumer + 1})`);
  assert.ok(guard < launch, `闸门(${guard + 1})必须早于启动会话(${launch + 1})`);
});
