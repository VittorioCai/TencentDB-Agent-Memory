/**
 * 开跑前核对:**这个任务登记了判别值的资产,必须在冻结的资产池快照里**。
 *
 *   node evaluation/runner/check-pool-snapshot.mjs --snapshot=<path> --tokens=<tokens.json>
 *
 * 不在里面会怎样:`provenance/build-events.mjs` 对不在快照里的资产直接 `continue`,
 * 一个事件都不写 —— 连 `fetched` 都没有,后面的判决器无从 credit,使用判定只能停在
 * `needs_review`。2026-09-13 第三任务三批 18 次有笔记运行因此一次 `used` 都没有,
 * 而 runner 当时只打了一行 warn(`the live pool differs from the frozen snapshot`),
 * 12 次刷了 12 遍没人当回事。所以这里**硬失败**,不再是提醒。
 */
import { readFileSync } from "node:fs";

/** @returns 登记了判别值、却不在快照里的资产 id;快照读不出来时视同全缺(§2) */
export function missingFromSnapshot(snapshot, tokens) {
  const have = new Set((snapshot?.assets ?? []).map((a) => a?.asset_id).filter(Boolean));
  return Object.keys(tokens ?? {}).filter((k) => !k.startsWith("_") && !have.has(k));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d = null) => {
    const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
    return hit === undefined ? d : hit.slice(n.length + 3);
  };
  const read = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
  const missing = missingFromSnapshot(read(arg("snapshot", "")), read(arg("tokens", "")) ?? {});
  if (missing.length) {
    console.error(`冻结的资产池快照里没有这些登记资产:${missing.join(", ")}`);
    console.error("不修就跑的后果:build-events 不会为它们写任何事件,采用判定只能停在 needs_review。");
    console.error(`修法:给任务目录放一份含它们的 asset-pool-snapshot.json(snapshot-assets.sh 可生成)。`);
    process.exit(1);
  }
  console.log("池快照核对:通过(登记的资产都在冻结快照里)");
}
