/**
 * --freeze 不得清空已有的证据与判定 —— 2026-09-11 审阅
 *
 * 冻结条件是一回事,冻结闸门证据是另一回事(由 build-baseline.mjs 从准备运行生成)。
 * 原来 --freeze 每次都把 gate_baseline 的 events/decisions 写成空,准备运行之后再冻结
 * 条件就把证据抹了。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { gateBaselineToWrite } from "./batch-conditions.mjs";

const fresh = { schema_version: "gate-baseline-v1", batch: 4, frozen_at: "2026-09-11T00:00:00Z", assets: { a: { version: 4 } }, decisions: [], events: [], rules_version: "r" };

test("没有已有基线 → 写新的", () => {
  const w = gateBaselineToWrite(null, fresh);
  assert.equal(w.write, true);
  assert.deepEqual(w.doc.decisions, []);
});

test("已有基线没有证据 → 可以覆盖", () => {
  const w = gateBaselineToWrite({ ...fresh, decisions: [], events: [] }, fresh);
  assert.equal(w.write, true);
});

test("已有基线带证据与判定 → 不覆盖,只报保留", () => {
  const existing = { ...fresh, frozen_at: "2026-09-10T00:00:00Z", decisions: [{ asset_id: "a", decision: "reject" }], events: [{ e: 1 }], source_runs: ["r1"] };
  const w = gateBaselineToWrite(existing, fresh);
  assert.equal(w.write, false);
  assert.match(w.why, /证据|decisions/);
  assert.equal(w.doc, existing);
});

// ---------------------------------------------------------------------------
// 准备运行不得兼作对照样本 —— 2026-09-11 硬约束
//
// 第 3 步的准备运行产生闸门判定的证据(build-baseline 的 source_runs);第 6 步的正式
// 对照衡量闸门的效果。同一批运行兼两职就是用 A 证明 A。所以:正式对照运行 id 与
// source_runs 零交集,而且 source_runs 里每一条都标着准备标签。
// ---------------------------------------------------------------------------
import { prepFormalDisjoint } from "./batch-conditions.mjs";

test("零交集、且 source_runs 全是准备标签 → 通过", () => {
  const r = prepFormalDisjoint({ source_runs: ["r-prep-1", "r-prep-2"] }, { runs: ["r-off-1", "r-on-1"] }, { "r-prep-1": "b4-prep", "r-prep-2": "b4-prep" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.overlap, []);
});

test("正式对照里混进了 source_runs → 不通过,点名", () => {
  const r = prepFormalDisjoint({ source_runs: ["r-prep-1"] }, { runs: ["r-prep-1", "r-on-1"] }, { "r-prep-1": "b4-prep" });
  assert.equal(r.ok, false);
  assert.deepEqual(r.overlap, ["r-prep-1"]);
});

test("source_runs 里有不是准备标签的运行 → 不通过", () => {
  const r = prepFormalDisjoint({ source_runs: ["r-x"] }, { runs: ["r-on-1"] }, { "r-x": "gate-off" });
  assert.equal(r.ok, false);
  assert.match(r.why, /标签|label/);
});

test("证据还没建立(无 source_runs)→ 未知,不是通过", () => {
  const r = prepFormalDisjoint({ source_runs: [] }, { runs: ["r-on-1"] }, {});
  assert.equal(r.ok, null);
});

test("批次还没开(无正式清单)→ 未知", () => {
  const r = prepFormalDisjoint({ source_runs: ["r-prep-1"] }, null, { "r-prep-1": "b4-prep" });
  assert.equal(r.ok, null);
});

// ---------------------------------------------------------------------------
// 批次内的运行记录必然含 trace(模型自己发出的),它靠目录隔离不可达,不是"来源不唯一"。
// 来源扫描把记录根的命中单列,不与仓库/记忆/缓存的命中混算 —— 2026-09-11
// ---------------------------------------------------------------------------
import { splitProvenanceHits } from "./batch-conditions.mjs";

test("记录根命中单列;其余来源命中才算不唯一", () => {
  const r = splitProvenanceHits([{ name: "records:x/verdict.json", kind: "record" }, { name: "task:README.md", kind: "record" }, { name: "memory:p.md", kind: "memory" }]);
  assert.deepEqual(r.in_records.map((x) => x.name), ["records:x/verdict.json"]);
  assert.deepEqual(r.elsewhere.map((x) => x.name), ["task:README.md", "memory:p.md"]);
});

test("本批次会话的 CodeBuddy 项目缓存也算批次痕迹,单列", () => {
  const r = splitProvenanceHits([{ name: "codebuddy:private-tmp-topic4-sessions-2026x.abcd-session/s.jsonl", kind: "cache" }, { name: "codebuddy:Users-x-repo/s.jsonl", kind: "cache" }]);
  assert.equal(r.in_records.length, 1);
  assert.equal(r.elsewhere.length, 1, "仓库 slug 下的缓存命中仍算不唯一");
});

test("source_runs 是 build-baseline 的对象形态时也按 run_id 比", () => {
  const r = prepFormalDisjoint({ source_runs: [{ run_id: "r-prep-1", verdict: "PASS" }] }, { runs: [{ run_id: "r-on-1" }] }, { "r-prep-1": "b4-prep" });
  assert.equal(r.ok, true);
  const bad = prepFormalDisjoint({ source_runs: [{ run_id: "r-prep-1" }] }, { runs: [{ run_id: "r-prep-1" }] }, { "r-prep-1": "b4-prep" });
  assert.deepEqual(bad.overlap, ["r-prep-1"]);
});

// ---------------------------------------------------------------------------
// 运行时镜像摘要要冻结、要核对 —— 2026-09-11 发现的缺口
//
// 条件清单冻结了资产版本、token、消费者、proxy 配置、记忆基线、分析代码哈希,唯独
// 没冻运行时镜像。上游一旦更新 :latest,结果会变而无人知晓。核对项:容器实际镜像
// 摘要 == 冻结值;清单没冻或容器读不到 → 未知,不是通过。
// ---------------------------------------------------------------------------
import { imageDigestCheck } from "./batch-conditions.mjs";

test("冻结的镜像摘要与容器实际不同 → 不通过,两边都点名", () => {
  const r = imageDigestCheck({ core_image_digest: "sha256:aaa" }, { core: { image_id: "sha256:bbb", repo_digests: ["agentmemory/memory-core@sha256:bbb"] } }, "core");
  assert.equal(r.ok, false);
  assert.equal(r.expected, "sha256:aaa");
  assert.equal(r.actual, "sha256:bbb");
});

test("冻结值等于容器镜像 id,或等于任一 repo digest 的摘要部分 → 通过", () => {
  const live = { core: { image_id: "sha256:bbb", repo_digests: ["agentmemory/memory-core@sha256:ccc"] } };
  assert.equal(imageDigestCheck({ core_image_digest: "sha256:bbb" }, live, "core").ok, true);
  assert.equal(imageDigestCheck({ core_image_digest: "sha256:ccc" }, live, "core").ok, true);
});

test("清单没冻镜像摘要 → 未知,不是通过", () => {
  const r = imageDigestCheck({}, { core: { image_id: "sha256:bbb", repo_digests: [] } }, "core");
  assert.equal(r.ok, null);
  assert.match(r.why, /未冻结|not frozen/);
});

test("容器读不到 → 未知,不是通过", () => {
  const r = imageDigestCheck({ core_image_digest: "sha256:aaa" }, { core: null }, "core");
  assert.equal(r.ok, null);
});

test("proxy 一样按它自己的键核对", () => {
  const r = imageDigestCheck({ proxy_image_digest: "sha256:p1" }, { proxy: { image_id: "sha256:p1", repo_digests: [] } }, "proxy");
  assert.equal(r.ok, true);
});

// ---------------------------------------------------------------------------
// 接受覆盖的挂载要冻结、要核对 —— 2026-09-12(方案 ①)
//
// enable --accept-image 写一份记录(镜像摘要、挂载文件的提交、逐文件覆盖行数、
// 未生效的上游路由)。冻结把它记进 runtime.core_mount;核对三件事:闸门目录确实
// 挂着、记录的摘要等于冻结的镜像摘要且等于容器实际、挂载来源提交等于当前分支
// 对应路径的最新提交。记录缺失 → 未知,不是通过。
// ---------------------------------------------------------------------------
import { coreMountCheck } from "./batch-conditions.mjs";

test("挂载在、记录摘要一致、来源提交一致 → 三行全过", () => {
  const frozen = { core_image_digest: "sha256:img", core_mount: { image_id: "sha256:img", mounted_commit: "abc" } };
  const live = { core: { image_id: "sha256:img" }, core_mounted: true, mounted_commit_now: "abc" };
  const rows = coreMountCheck(frozen, live);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.ok === true), JSON.stringify(rows));
});

test("闸门目录没挂 → 该行不通过", () => {
  const frozen = { core_image_digest: "sha256:img", core_mount: { image_id: "sha256:img", mounted_commit: "abc" } };
  const rows = coreMountCheck(frozen, { core: { image_id: "sha256:img" }, core_mounted: false, mounted_commit_now: "abc" });
  assert.equal(rows.find((r) => /挂载/.test(r.name) && !/记录|提交/.test(r.name)).ok, false);
});

test("记录的摘要与冻结的镜像摘要不同,或与容器实际不同 → 不通过,点名", () => {
  const frozen = { core_image_digest: "sha256:img", core_mount: { image_id: "sha256:other", mounted_commit: "abc" } };
  const r = coreMountCheck(frozen, { core: { image_id: "sha256:img" }, core_mounted: true, mounted_commit_now: "abc" }).find((x) => /记录/.test(x.name));
  assert.equal(r.ok, false);
  assert.match(r.why, /sha256:other/);
});

test("挂载来源提交与当前分支不同 → 不通过(上线的不是当前代码)", () => {
  const frozen = { core_image_digest: "sha256:img", core_mount: { image_id: "sha256:img", mounted_commit: "abc" } };
  const r = coreMountCheck(frozen, { core: { image_id: "sha256:img" }, core_mounted: true, mounted_commit_now: "def" }).find((x) => /提交/.test(x.name));
  assert.equal(r.ok, false);
});

test("清单没有 core_mount 记录 → 未知,不是通过", () => {
  const rows = coreMountCheck({ core_image_digest: "sha256:img" }, { core: { image_id: "sha256:img" }, core_mounted: true, mounted_commit_now: "abc" });
  assert.ok(rows.some((r) => r.ok === null));
  assert.ok(!rows.some((r) => r.ok === true && /记录/.test(r.name)));
});
