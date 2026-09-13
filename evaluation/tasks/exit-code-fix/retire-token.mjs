/**
 * 轮换判别值时,把上一版的规格搬进 tokens.json 的 `_history`。
 *
 * 2026-09-11 第一次轮换(v1 → v2)时 `_history` 是手写进去的;fill-note.mjs 只覆盖当前规格,
 * 退休的旧值哈希就只剩 git 历史里有。可污染检查、烧毁登记都要认旧值 —— 一份留在磁盘上的旧笔记
 * 照样是答案,所以这一步不能靠人记得。纯函数,fill-note.mjs 在写入前调用。
 */
export function retireIntoHistory(tokens, id, { retiredAt, why }) {
  const cur = tokens[id];
  if (!cur || typeof cur !== "object") return tokens;      // 首次建资产:没有可退休的
  const history = Array.isArray(tokens._history) ? tokens._history : [];
  if (history.some((h) => h.asset_id === id && h.version === cur.version)) return tokens;   // 同一版只退一次
  return { ...tokens, _history: [...history, {
    asset_id: id, version: cur.version, token_sha256: cur.token_sha256 ?? [], content_hash: cur.content_hash ?? null,
    retired_at: retiredAt, why,
  }] };
}
