/**
 * Which row a run lands in.
 *
 * The formal sample is the manifest (`batch4-runs.json`), not "every run whose
 * baseline says batch 4": the trial pair and the preparation runs carry the
 * same baseline and were being counted into the batch-4 row (28 decisions
 * instead of 20). The manifest decides membership; labels only name the
 * non-sample rows.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { experimentOf } from "./calibrate-runs.mjs";

const manifest = { batch: 4, runs: [{ run_id: "f1" }, { run_id: "f2" }] };

test("a run named in the manifest is the formal sample, whatever its label", () => {
  assert.equal(experimentOf({ label: "gate-off", run_id: "f1", base: "batch4", manifest }), "batch4");
  assert.equal(experimentOf({ label: "gate-on", run_id: "f2", base: "batch4", manifest }), "batch4");
});

test("the trial pair is its own row, not a sample", () => {
  assert.equal(experimentOf({ label: "trial-gate-off", run_id: "t1", base: "batch4", manifest }), "batch4-trial (checkpoint pair, not a sample)");
  assert.equal(experimentOf({ label: "trial-gate-on", run_id: "t2", base: "batch4", manifest: null }), "batch4-trial (checkpoint pair, not a sample)");
});

test("preparation runs stay the evidence-base row", () => {
  assert.equal(experimentOf({ label: "b4-prep", run_id: "p1", base: "batch4", manifest }), "batch4-prep (evidence base, not a sample)");
});

test("a batch-4 run that is neither in the manifest nor labelled prep/trial is listed apart, never folded into the sample", () => {
  assert.equal(experimentOf({ label: "gate-off", run_id: "stray", base: "batch4", manifest }), "batch4-other (not in the formal manifest)");
});

test("the manifest only governs its own batch; older batches keep their row", () => {
  assert.equal(experimentOf({ label: "gate-on-core", run_id: "old", base: "batch3", manifest }), "batch3");
});

// ── the same run passed twice is one run ──────────────────────────
// `runs/2026*-gate-*/` also matches `…-trial-gate-off`, so a call that lists
// the trial pair separately fed it twice (8 decisions from 2 runs, 2026-09-11).
import { uniqueDirs } from "./calibrate-runs.mjs";

test("a run directory named twice on the command line is analysed once", () => {
  assert.deepEqual(uniqueDirs(["runs/a/", "runs/b", "runs/a", "runs/b/"]), ["runs/a", "runs/b"]);
});

// --- 2026-09-12 第二人复核:口径修正 -------------------------------------------------
// ① 送达 ≠ 采用:隔离失败不能推出"判 used 是对的"。
// ② 正式样本与准备/试跑不能在正文里合并。
// ③ 运行期间写记忆 ≠ 本次受污染;回滚失败 ≠ 本次读过别人的内容。
// ④ 报告要带真实命令与运行名单。
// ⑤ "闸门没有旁路""突破会被记下来"说得过满。
import { report as buildReport, contaminationOf, mergeIsolationFindings } from "./calibrate-runs.mjs";

const memRun = (over = {}) => ({ run_id: "r1", agent_memory: { hash_before: "h0", hash_after: "h0", hash_restored: "h0", isolated: true, written_during_run: false, consumer_scope: { files_before: 0 } }, ...over });
const withMem = (m) => memRun({ agent_memory: { ...memRun().agent_memory, ...m } });

test("③ 运行期间写了记忆:只说明之后的运行不再从同一起点,本次不判受污染", () => {
  const c = contaminationOf(withMem({ written_during_run: true, isolated: true }));
  assert.notEqual(c.contaminated, true);
  assert.equal(c.independent, null);                  // 未确认,不是"干净"
  assert.equal(c.memory_facts.wrote_during_run, true);
  assert.match(c.why, /之后/);
  assert.doesNotMatch(c.why, /本次受污染/);
});

test("③ 回滚失败(isolated=false)记为回滚事实,不等于本次读过别的运行", () => {
  const c = contaminationOf(withMem({ isolated: false, written_during_run: true, hash_restored: "hX" }));
  assert.notEqual(c.contaminated, true);
  assert.equal(c.memory_facts.rollback_ok, false);
  assert.equal(c.independent, null);
  assert.match(c.why, /回滚/);
});

test("③ 有直接证据才判受污染:记录标注来源,或复算确认他源送达", () => {
  assert.equal(contaminationOf({ contaminated_by: "run-x" }).contaminated, true);
  assert.equal(contaminationOf({ contaminated_by: "run-x" }).independent, false);
  const merged = mergeIsolationFindings([memRun()], { runs: [{ run_id: "r1", leak_confirmed: true, leaks: [{ where: "capture" }] }] })[0];
  assert.equal(merged.contaminated, true);
  assert.equal(merged.independent, false);
});

test("③ 回滚成功且没写入 → 本次独立;没有 agent_memory → 全未知", () => {
  assert.equal(contaminationOf(memRun()).independent, true);
  const unk = contaminationOf({ run_id: "r0" });
  assert.equal(unk.independent, null);
  assert.equal(unk.memory_facts.rollback_ok, null);
});

const setResult = (formalKey, formal, cumulative) => ({
  rows: [], cumulative, by_rules_version: { "rulesX": cumulative }, by_experiment: { [formalKey]: formal },
});
const T = (o) => ({ true_positive: 0, false_positive: 0, true_negative: 0, false_negative: 0, unsettled: 0, isolation_failure: 0, unknown_adoption: 0, decisions_rated: 0, decisions_total: 0, accuracy: null, adoption_coverage: null, adopted_and_worked: 0, adopted_but_failed: 0, adopted_benefit_unknown: 0, ...o });

test("② 正文主结论只报正式组;累计另说并标明含准备与试跑", () => {
  const formalKey = "rulesX · batch4";
  const result = setResult(formalKey, T({ decisions_rated: 20, decisions_total: 20, accuracy: 0.95, false_negative: 1 }), T({ decisions_rated: 28, decisions_total: 28, accuracy: 0.964, false_negative: 1 }));
  const usage = setResult(formalKey, T({ decisions_rated: 20, decisions_total: 20, accuracy: 1, adoption_coverage: 1, adopted_and_worked: 9, adopted_but_failed: 4, adopted_benefit_unknown: 1 }),
    T({ decisions_rated: 28, decisions_total: 28, accuracy: 1, adoption_coverage: 1, adopted_and_worked: 13, adopted_but_failed: 5, adopted_benefit_unknown: 3 }));
  const md = buildReport(result, { frozen: "rulesX", runs: [{ run_id: "a1", started_at: "t1" }], usage, manifest: { batch: 4, runs: [{ run_id: "a1" }] }, command: "node … --manifest=…" });
  assert.match(md, /正式样本组/);
  assert.match(md, /可评 20\/20/);                       // 主结论是正式组
  assert.doesNotMatch(md, /\*\*规则 rulesX\*\*:可评 28\/28/); // 不把累计当主结论
  assert.match(md, /累计[^\n]*含准备|准备与试跑/);          // 累计出现时必须标明范围
  assert.match(md, /20 个判定项[^\n]*不是 20 次独立/);       // 判定项 ≠ 独立实验
  assert.match(md, /采纳且奏效 9 项/);                      // 收益按正式组
});

test("① 隔离失败不推出使用判定正确;送达表的 FN 不叫漏报", () => {
  const md = buildReport(setResult("rulesX · batch4", T({ decisions_rated: 1, decisions_total: 1, isolation_failure: 1 }), T({ decisions_rated: 1, decisions_total: 1, isolation_failure: 1 })),
    { frozen: "rulesX", runs: [{ run_id: "a1" }], manifest: { batch: 4, runs: [{ run_id: "a1" }] }, command: "cmd" });
  assert.doesNotMatch(md, /判 used 是对的/);
  assert.match(md, /仍须由实际采纳证据判断|由采纳证据判断/);
  assert.match(md, /已送达但未判使用/);
});

test("④ 报告带真实命令与运行 id 名单,不是固定模板", () => {
  const md = buildReport(setResult("rulesX · batch4", T({}), T({})), { frozen: "rulesX", command: "node evaluation/attribution/calibrate-runs.mjs --frozen=rulesX --manifest=m.json <14 个运行目录>", runs: [{ run_id: "20260910T232424Z-gate-off" }, { run_id: "20260910T232507Z-gate-on" }], manifest: { batch: 4, runs: [{ run_id: "20260910T232424Z-gate-off" }] } });
  assert.match(md, /--manifest=m\.json/);
  assert.match(md, /20260910T232424Z-gate-off/);
  assert.match(md, /20260910T232507Z-gate-on/);
  assert.doesNotMatch(md, /runs\/2026\*-gate-\*/);        // 旧的固定通配符模板
});

test("⑤ 威胁模型不再断言闸门没有旁路、突破一定会被记下来", () => {
  const md = buildReport(setResult("rulesX · batch4", T({}), T({})), { frozen: "rulesX", runs: [], manifest: null, command: "cmd" });
  assert.doesNotMatch(md, /闸门本身没有旁路/);
  assert.doesNotMatch(md, /\*\*突破会被记下来\*\*/);
  assert.match(md, /已验证的产品读取路径/);
  assert.match(md, /未覆盖或无法归属/);
});

test("③ 独立性一节按四项事实分别报告,不给「不独立 N 次」的总判决", () => {
  const runs = [
    { run_id: "same-start-ok", started_at: "t1", ...contaminationOf(withMem({ isolated: true, written_during_run: false })) },
    { run_id: "rollback-failed", started_at: "t2", ...contaminationOf(withMem({ isolated: false, written_during_run: true, hash_restored: "hX" })) },
    { run_id: "wrote-only", started_at: "t3", ...contaminationOf(withMem({ isolated: true, written_during_run: true })) },
    { run_id: "no-record", started_at: "t4", ...contaminationOf({ run_id: "no-record" }) },
  ];
  const md = buildReport(setResult("rulesX · batch4", T({ decisions_rated: 8, decisions_total: 8 }), T({ decisions_rated: 8, decisions_total: 8 })),
    { frozen: "rulesX", runs, manifest: { batch: 4, runs: [{ run_id: "same-start-ok" }] }, command: "cmd" });
  assert.doesNotMatch(md, /不是独立样本 \d+ 次/);
  assert.match(md, /起点/);                       // 起点是否一致
  assert.match(md, /回滚未成功[^\n]*1 次|回滚未成功.*rollback-failed/s);
  assert.match(md, /运行期间写入记忆[^\n]*2 次|wrote-only/s);
  assert.match(md, /未记录[^\n]*1 次|no-record/s);
  assert.match(md, /独立性未确认/);
  assert.match(md, /没有判别值泄漏的证据,不等于没有记忆污染|不等于没有记忆污染/);
});
