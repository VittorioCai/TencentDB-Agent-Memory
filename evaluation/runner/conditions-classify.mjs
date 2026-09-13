/**
 * 把 conditions-check 的 FAIL 逐项归类,取代原来整块的"按设计如此"。
 *
 * 三种性质必须分开说:批次跑完后的正常变化、已载明的实验限制、以及**证据本身的缺口**。
 * 第三种是缺点,不是设计 —— 交付里把它并进前两类,等于用一句"按设计"盖住了一处没有的证据。
 *
 * 登记簿在 `conditions-expected.json`。未登记的 FAIL 一律阻断;登记了却不再失败的项报为过期。
 */
export const CLASSES = {
  post_batch:       { by_design: true,  label: "批次后的正常变化 / 已记录的有意改动" },
  known_limitation: { by_design: true,  label: "已载明的实验限制" },
  record_gap:       { by_design: false, label: "证据缺口(属于缺点)" },
};

export function classify(failItems, registry) {
  const known = new Map((registry?.allowed ?? []).map((a) => [a.item, a]));
  const by_class = { post_batch: [], known_limitation: [], record_gap: [] };
  const unregistered = [];
  for (const item of failItems) {
    const a = known.get(item);
    if (!a || !CLASSES[a.class]) { unregistered.push(item); continue; }
    by_class[a.class].push(a);
  }
  const stale = [...known.keys()].filter((k) => !failItems.includes(k));
  const record_gaps = by_class.record_gap;
  const line =
    `conditions-check 的 ${failItems.length} 项 FAIL:批次后的正常变化 ${by_class.post_batch.length} 项、` +
    `已知限制 ${by_class.known_limitation.length} 项、**记录缺口 ${record_gaps.length} 项**` +
    (record_gaps.length ? `(${record_gaps.map((g) => g.item).join("、")} —— 属于缺点,不是按设计)` : "") +
    `;未登记 ${unregistered.length} 项${unregistered.length ? `(${unregistered.join("、")})` : ""}` +
    `;登记了但本次未失败 ${stale.length} 项${stale.length ? `(${stale.join("、")},冻结值该更新)` : ""}。`;
  return { ok: unregistered.length === 0, by_class, unregistered, stale, record_gaps, line };
}

// ── CLI:deliver-check.sh 用它把 conditions-check 的 FAIL 逐项归类 ─────────
//   node evaluation/runner/conditions-classify.mjs <conditions-check.txt> [registry.json]
// 出现未登记的 FAIL → 退出 1。
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import("node:fs");
  const [txt, regPath = "evaluation/runner/conditions-expected.json"] = process.argv.slice(2);
  const items = readFileSync(txt, "utf8").split("\n")
    .filter((l) => l.startsWith("FAIL")).map((l) => l.replace(/^FAIL\s+/, "").trim());
  const r = classify(items, JSON.parse(readFileSync(regPath, "utf8")));
  console.log(r.line);
  process.exit(r.ok ? 0 : 1);
}
