/**
 * 解析契约:按冻结的(资产 id、版本、内容哈希、token 哈希)从 Core 取明文,
 * 任一不符即 verified:false;要明文的一律经 plainTokensOrThrow,失败明确中止。
 *
 * 2026-09-11 审阅:解析器读 head 不钉版本、不走管理读取、asPlainTokens 丢版本且不拒绝
 * verified:false——gate-on 把错资产置 failed 后分析端读不到,静默变 not_delivered。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolveTokens, plainTokensOrThrow } from "./resolve-tokens.mjs";

const sha = (s) => createHash("sha256").update(s).digest("hex");
const md5 = (s) => createHash("md5").update(s).digest("hex");
const body = (trace) => `---\nname: x\n---\nheaders:\n    x-team-trace: ${trace}\nend\n`;

const spec = (trace, over = {}) => ({
  "skl-a": {
    role: "wrong", version: 4, content_hash: md5(body(trace)),
    token_sha256: [sha(trace)], token_pattern: "x-team-trace:\\s*(bt-[a-z0-9]+)", adoption_fields: ["value"],
    ...over,
  },
});
const pair = { team_id: "t", author_agent_id: "agt-a" };
const readOk = (trace, version = 4) => async () => ({ code: 0, data: { version, content: body(trace) } });

test("版本、内容哈希、token 哈希全部对上 → verified,明文与版本一起返回", async () => {
  const r = await resolveTokens({ tokens: spec("bt-abcdefgh11"), pair }, { read: readOk("bt-abcdefgh11"), author_user_id: "u" });
  assert.equal(r["skl-a"].verified, true);
  assert.deepEqual(r["skl-a"].tokens, ["bt-abcdefgh11"]);
  assert.equal(r["skl-a"].version, 4);
  assert.equal(r["skl-a"].read_purpose, "manage");
});

test("Core 返回的版本 ≠ 钉住的版本 → 不 verified", async () => {
  const r = await resolveTokens({ tokens: spec("bt-abcdefgh11"), pair }, { read: readOk("bt-abcdefgh11", 5), author_user_id: "u" });
  assert.equal(r["skl-a"].verified, false);
  assert.match(r["skl-a"].why, /版本/);
});

test("正文 md5 ≠ 钉住的 content_hash → 不 verified", async () => {
  const r = await resolveTokens({ tokens: spec("bt-abcdefgh11", { content_hash: "0".repeat(32) }), pair }, { read: readOk("bt-abcdefgh11"), author_user_id: "u" });
  assert.equal(r["skl-a"].verified, false);
  assert.match(r["skl-a"].why, /content_hash|内容哈希/);
});

test("抽出的值哈希 ≠ token_sha256 → 不 verified", async () => {
  const r = await resolveTokens({ tokens: spec("bt-abcdefgh11"), pair }, { read: readOk("bt-zzzzzzzz99"), author_user_id: "u" });
  assert.equal(r["skl-a"].verified, false);
});

test("读取失败(闸门/网络)→ 不 verified,不静默返回空", async () => {
  const r = await resolveTokens({ tokens: spec("bt-abcdefgh11"), pair }, { read: async () => ({ code: 40301, message: "SKILL_NOT_ADMITTED" }), author_user_id: "u" });
  assert.equal(r["skl-a"].verified, false);
  assert.deepEqual(r["skl-a"].tokens, []);
});

test("plainTokensOrThrow:有一个不 verified 就抛,点名资产;全 verified 返回带版本的明文形态", async () => {
  const bad = await resolveTokens({ tokens: spec("bt-abcdefgh11"), pair }, { read: readOk("bt-abcdefgh11", 5), author_user_id: "u" });
  assert.throws(() => plainTokensOrThrow(bad), /skl-a/);
  const good = await resolveTokens({ tokens: spec("bt-abcdefgh11"), pair }, { read: readOk("bt-abcdefgh11"), author_user_id: "u" });
  const plain = plainTokensOrThrow(good);
  assert.deepEqual(plain["skl-a"].tokens, ["bt-abcdefgh11"]);
  assert.equal(plain["skl-a"].version, 4, "版本不能丢");
  assert.deepEqual(plain["skl-a"].adoption_fields, ["value"]);
});

test("明文形态(老批次)原样通过,不联网,版本保留", async () => {
  const r = await resolveTokens({ tokens: { "skl-old": { version: 2, tokens: ["10.244.7.19"] } }, pair }, { read: async () => { throw new Error("must not be called"); } });
  assert.equal(r["skl-old"].verified, true);
  assert.equal(plainTokensOrThrow(r)["skl-old"].version, 2);
});
