/**
 * Tests for discriminative token extraction.
 *
 * Every case here defends one claim: that finding this string in the work has
 * no explanation other than the asset. A token that fails any of them turns a
 * "used" judgement into a coincidence.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  extractTokens,
  screen,
  discriminativeTokens,
  findTokens,
  systemPromptsFromCapture,
  poolCorpus,
  ownMetadata,
} from "./extract-tokens.mjs";

const tokenOf = (list, token) => list.find((t) => t.token === token);

// ── derivability: a prior on the shape ────────────────────────────

test("a loopback address proves nothing — everyone writes it from memory", () => {
  assert.equal(tokenOf(extractTokens("connect to 127.0.0.1:8096"), "127.0.0.1").derivable, true);
});

test("a private-range address is not guessable and counts", () => {
  // 10.244.7.19 is as unguessable as a public address. Treating "private" as
  // "well known" would throw away the only usable token in the pair.
  assert.equal(tokenOf(extractTokens("connect to 10.244.7.19:8096"), "10.244.7.19").derivable, false);
});

test("a well-known port is derivable, an arbitrary one is not", () => {
  const t = extractTokens("try :443 then :47318");
  assert.equal(tokenOf(t, "443").derivable, true);
  assert.equal(tokenOf(t, "47318").derivable, false);
});

test("prefixed ids are never derivable", () => {
  assert.equal(tokenOf(extractTokens("skill_id skl-gWTY69V4tFw7"), "skl-gWTY69V4tFw7").derivable, false);
});

test("an invalid octet is not read as an address", () => {
  assert.equal(tokenOf(extractTokens("version 10.244.7.999"), "10.244.7.999"), undefined);
});

// ── screening: the filter that actually holds ─────────────────────

test("a token already in the injected system prompt is rejected", () => {
  // The load-bearing case. The <skill_tools> block names the bridge endpoint on
  // every turn, so an asset documenting it adds nothing the model did not have.
  const screened = screen(extractTokens("use http://127.0.0.1:8096/skill-bridge/v3/skill/search"), {
    "system prompt": "path: http://127.0.0.1:8096/skill-bridge/v3/skill/search",
  });
  const ip = tokenOf(screened, "127.0.0.1");
  assert.equal(ip.discriminative, false);
  assert.deepEqual(ip.blocked_by, ["system prompt"]);
});

test("a token shared with another candidate asset is rejected", () => {
  // Constraint (c). Seeing it in the work cannot say which of the two was read.
  const screened = screen(extractTokens("host 10.244.7.19"), { "sibling asset": "also mentions 10.244.7.19" });
  assert.equal(tokenOf(screened, "10.244.7.19").discriminative, false);
});

test("a rejection names the source that killed it", () => {
  // A count of rejections is useless; the scenario can only be repaired if you
  // know which corpus the token leaked from.
  const screened = screen(extractTokens("host 10.9.8.7"), {
    "task description": "deploy to 10.9.8.7",
    "pre-change files": "nothing relevant",
  });
  assert.deepEqual(tokenOf(screened, "10.9.8.7").blocked_by, ["task description"]);
});

test("an asset's own name is not evidence that its body was read", () => {
  // The name is what the candidate listing shows. A model that writes it has
  // demonstrated recall, not use.
  const asset = [
    "---",
    "name: eval-bridge-endpoint-b",
    "description: Where to reach the bridge.",
    "---",
    "Send requests to eval-bridge-endpoint-b with trace bt-yf39kfehc5.",
  ].join("\n");

  assert.match(ownMetadata(asset), /eval-bridge-endpoint-b/);
  const screened = screen(extractTokens(asset), { "own name/description": ownMetadata(asset) });
  assert.equal(tokenOf(screened, "eval-bridge-endpoint-b").discriminative, false);
  assert.equal(tokenOf(screened, "bt-yf39kfehc5").discriminative, true);
});

// ── corpora ───────────────────────────────────────────────────────

test("only system messages of requests are read as injected context", () => {
  // A model's own reply is not context it was given. Counting it would let the
  // model screen out its own tokens.
  const capture = [
    JSON.stringify({ event: "http.request", body: { json: { messages: [
      { role: "system", content: "endpoint 127.0.0.1:8096" },
      { role: "assistant", content: "I will use 10.9.8.7" },
    ] } } }),
    JSON.stringify({ event: "http.response", body: { json: { choices: [] } } }),
  ].join("\n");

  const corpus = systemPromptsFromCapture(capture);
  assert.match(corpus, /127\.0\.0\.1/);
  assert.doesNotMatch(corpus, /10\.9\.8\.7/);
});

test("the pool corpus excludes the assets under test", () => {
  const snapshot = { assets: [
    { asset_id: "skl-A", name: "under-test", description: "uses 10.9.8.7" },
    { asset_id: "skl-B", name: "other", description: "uses 10.1.1.2" },
  ] };
  const corpus = poolCorpus(snapshot, ["skl-A"]);
  assert.doesNotMatch(corpus, /10\.9\.8\.7/);
  assert.match(corpus, /10\.1\.1\.2/);
});

test("a task description carrying a discriminative token is caught", () => {
  // P4-1b's check: a task description that names the answer makes every later
  // "used" judgement meaningless.
  const tokens = discriminativeTokens("send x-team-trace: bt-7c4wgsmdac to the bridge", {});
  assert.deepEqual(findTokens("carry the trace bt-7c4wgsmdac", tokens).map((t) => t.token), ["bt-7c4wgsmdac"]);
  assert.deepEqual(findTokens("fetch a team skill and follow it", tokens), []);
});

// ── the mainline pair ─────────────────────────────────────────────

test("each mainline asset yields exactly one discriminative token, and they differ", () => {
  const wrong = readFileSync("evaluation/tasks/bridge-addr/assets/wrong.md", "utf8");
  const right = readFileSync("evaluation/tasks/bridge-addr/assets/right.md", "utf8");
  const systemPrompt = systemPromptsFromCapture(
    readFileSync("evaluation/gate0/artifacts/gate0-threechannel-capture.jsonl", "utf8"),
  );

  const forAsset = (text, sibling) => discriminativeTokens(text, {
    "system prompt": systemPrompt,
    sibling,
    "own name/description": ownMetadata(text),
  });

  const wrongTokens = forAsset(wrong, right).map((t) => t.token);
  const rightTokens = forAsset(right, wrong).map((t) => t.token);

  // v3(2026-09-09):判别性 token 是每条资产各自的追踪值。地址仍在正文里,但它可以
  // 从部署读出来,所以不再算判别性——抽取器与 token-provenance.mjs 用同一条判据。
  assert.deepEqual(wrongTokens, ["bt-7c4wgsmdac"]);
  assert.deepEqual(rightTokens, ["bt-yf39kfehc5"]);
});

test("地址不再算判别性 token,哪怕语料里一次都没出现过", () => {
  const asset = "Send requests to http://10.244.7.19:8096/skill-bridge/v3/skill/search";
  const screened = screen(extractTokens(asset), {});
  const ip = tokenOf(screened, "10.244.7.19");
  assert.equal(ip.discriminative, false, "地址写在部署配置里,有进程在监听,shell 就能拿到");
  assert.equal(ip.derivable_from_deployment, true);
  assert.deepEqual(ip.blocked_by, [], "它不是被语料挡下的,是被形状挡下的——两者理由不同");
});

test("the right-address asset cannot document the endpoint already in the prompt", () => {
  // Regression on the finding that forced the rewrite: right.md originally read
  // 127.0.0.1:8096, which is in <skill_tools> verbatim on every turn. It had no
  // discriminative token at all, so "the model used the right asset" would have
  // been unprovable in the direction the demo depends on.
  const systemPrompt = systemPromptsFromCapture(
    readFileSync("evaluation/gate0/artifacts/gate0-threechannel-capture.jsonl", "utf8"),
  );
  // v3 之后这条要连追踪值一起去掉才成立:追踪头正是为了让"资产被读过"不再依赖
  // 地址而加的。去掉它、再把地址换回提示词里已有的那个,资产就退回当初那个状态——
  // 一个判别性 token 都没有,"模型用了对的资产"无从证明。
  const original = readFileSync("evaluation/tasks/bridge-addr/assets/right.md", "utf8")
    .replace("127.0.0.1:47318", "127.0.0.1:8096")
    .replace(/^ *x-team-trace: .*$/m, "")
    .replace(/## About the trace header[\s\S]*?\n## /m, "## ");
  // The sibling belongs in the corpus: constraint (c) is about the pool these
  // two are in. Without it the shared task marker survives screening, and a
  // value both assets carry cannot say which one was followed.
  const sibling = readFileSync("evaluation/tasks/bridge-addr/assets/wrong.md", "utf8");

  assert.deepEqual(
    discriminativeTokens(original, {
      "system prompt": systemPrompt,
      sibling,
      "own name/description": ownMetadata(original),
    }),
    [],
  );
});

test("the two assets differ only in the address and the trace value", () => {
  // Any further difference gives attribution a second explanation. The trace
  // value joined the address as a deliberate difference in v3 (2026-09-09);
  // everything else still has to match byte for byte.
  const strip = (s) => s.replace(/eval-bridge-endpoint-[ab]/g, "NAME")
    .replace(/(10\.244\.7\.19:8096|127\.0\.0\.1:47318)/g, "ADDR")
    .replace(/bt-[a-z0-9]+/g, "TRACE");
  assert.equal(
    strip(readFileSync("evaluation/tasks/bridge-addr/assets/wrong.md", "utf8")),
    strip(readFileSync("evaluation/tasks/bridge-addr/assets/right.md", "utf8")),
  );
});
