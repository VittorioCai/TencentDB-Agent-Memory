import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLASSES, checkRegistry, findMarkdown, isNarrative, render } from "./check-generated-reports.mjs";

const REG = { narrative_rules: ["/README\\.md$", "/assets/"], narrative_paths: ["evaluation/STATE.md"], reports: [] };

test("叙述按规则或按路径认;两者都不沾的必须登记", () => {
  assert.equal(isNarrative("a/README.md", REG), true);
  assert.equal(isNarrative("a/assets/note.md", REG), true);
  assert.equal(isNarrative("evaluation/STATE.md", REG), true);
  assert.equal(isNarrative("a/REPORT.md", REG), false);
});

test("扫描跳过 delivery/ 与 runs/ —— 那是验收自己的产物,不是被验收的对象", (t) => {
  const root = mkdtempSync(join(tmpdir(), "gr-"));
  mkdirSync(join(root, "delivery/2026-09-13"), { recursive: true });
  mkdirSync(join(root, "tasks"), { recursive: true });
  writeFileSync(join(root, "tasks/REPORT.md"), "# R\n\nGenerated: `node r.mjs`\n");
  writeFileSync(join(root, "delivery/2026-09-13/SUMMARY.md"), "# S\n\nGenerated: `node d.mjs`\n");
  const found = findMarkdown(root);
  assert.deepEqual(found, [join(root, "tasks/REPORT.md")]);
});

test("未登记的报告阻断 —— 这正是 exitline 那份漏掉的方式", () => {
  const r = checkRegistry(["a/REPORT.md", "b/REPORT.md"], { ...REG, reports: [{ path: "a/REPORT.md", class: "regenerated", step: "x" }] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.unregistered, ["b/REPORT.md"]);
  assert.match(render(r), /未登记\(阻断\)/);
});

test("登记了却不在磁盘上的也要报,免得登记簿变旧账", () => {
  const r = checkRegistry(["a/REPORT.md"], { reports: [
    { path: "a/REPORT.md", class: "regenerated", step: "x" },
    { path: "gone/REPORT.md", class: "regenerated", step: "y" }] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.stale, ["gone/REPORT.md"]);
});

test("not_regenerable 必须写明原因 —— 它是登记在案的缺点,不是豁免", () => {
  const withWhy = checkRegistry(["a.md"], { reports: [{ path: "a.md", class: "not_regenerable", why: "代价太大" }] });
  assert.equal(withWhy.ok, true);
  assert.match(render(withWhy), /不能重算\(缺点,已登记\)/);
  const noWhy = checkRegistry(["a.md"], { reports: [{ path: "a.md", class: "not_regenerable" }] });
  assert.equal(noWhy.ok, false);
  assert.deepEqual(noWhy.missing_why, ["a.md"]);
});

test("historical 也必须写明原因 —— 「为什么不再算」和「为什么算不了」都要说", () => {
  const ok = checkRegistry(["a.md"], { reports: [{ path: "a.md", class: "historical", why: "已被后来那份取代" }] });
  assert.equal(ok.ok, true);
  const bad = checkRegistry(["a.md"], { reports: [{ path: "a.md", class: "historical" }] });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.missing_why, ["a.md"]);
});

test("加了新类别却没登记进 CLASSES,一律按不认识阻断", () => {
  assert.deepEqual(CLASSES.slice().sort(), ["figures_checked", "historical", "not_regenerable", "regenerated"]);
});

test("不认识的类别不放行", () => {
  const r = checkRegistry(["a.md"], { reports: [{ path: "a.md", class: "看起来没问题" }] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.bad_class, ["a.md"]);
});

test("叙述文档不必登记,但也不能两头都算", () => {
  const r = checkRegistry(["a/README.md"], { ...REG, reports: [{ path: "a/README.md", class: "regenerated", step: "x" }] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.both_ways, ["a/README.md"]);
});

test("真仓库:每一份入库 .md 都有归属,登记簿没有旧账", () => {
  const registry = JSON.parse(readFileSync("evaluation/generated-reports.json", "utf8"));
  const r = checkRegistry(findMarkdown("evaluation"), registry);
  assert.equal(r.ok, true, JSON.stringify({ unregistered: r.unregistered, stale: r.stale, both: r.both_ways }));
  assert.ok((r.by_class.regenerated ?? []).length >= 12, "重算的那批不能少");
  assert.equal((r.by_class.not_regenerable ?? []).length, 1, "不能重算的只有登记在案的那一份");
});
