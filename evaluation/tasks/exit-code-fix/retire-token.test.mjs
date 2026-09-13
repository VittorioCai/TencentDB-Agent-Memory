import { test } from "node:test";
import assert from "node:assert/strict";
import { retireIntoHistory } from "./retire-token.mjs";

const T = { _note: "x", "skl-a": { role: "note", version: 1, token_sha256: ["aa"], content_hash: "h1" } };

test("轮换前把当前规格搬进 _history:版本、哈希、内容哈希、时间与原因都带上", () => {
  const out = retireIntoHistory(T, "skl-a", { retiredAt: "2026-09-13T15:00:00Z", why: "值已进 git 历史" });
  assert.equal(out._history.length, 1);
  assert.deepEqual(out._history[0], { asset_id: "skl-a", version: 1, token_sha256: ["aa"], content_hash: "h1", retired_at: "2026-09-13T15:00:00Z", why: "值已进 git 历史" });
  assert.equal(T._history, undefined, "不改输入");
});

test("首次建资产没有可退休的;同一版不会退两次", () => {
  assert.deepEqual(retireIntoHistory({ _note: "x" }, "skl-new", { retiredAt: "t", why: "w" }), { _note: "x" });
  const once = retireIntoHistory(T, "skl-a", { retiredAt: "t", why: "w" });
  const twice = retireIntoHistory(once, "skl-a", { retiredAt: "t2", why: "w2" });
  assert.equal(twice._history.length, 1);
});

test("已有的 _history 只追加,不覆盖", () => {
  const withOld = { ...T, _history: [{ asset_id: "skl-a", version: 0, token_sha256: ["zz"] }] };
  const out = retireIntoHistory(withOld, "skl-a", { retiredAt: "t", why: "w" });
  assert.deepEqual(out._history.map((h) => h.version), [0, 1]);
});
