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
    "Send requests to eval-bridge-endpoint-b at 10.9.8.7.",
  ].join("\n");

  assert.match(ownMetadata(asset), /eval-bridge-endpoint-b/);
  const screened = screen(extractTokens(asset), { "own name/description": ownMetadata(asset) });
  assert.equal(tokenOf(screened, "eval-bridge-endpoint-b").discriminative, false);
  assert.equal(tokenOf(screened, "10.9.8.7").discriminative, true);
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
  const tokens = discriminativeTokens("bridge at 10.244.7.19:47318", {});
  assert.deepEqual(findTokens("connect to the bridge at 10.244.7.19", tokens).map((t) => t.token), ["10.244.7.19"]);
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

  assert.deepEqual(wrongTokens, ["10.244.7.19"]);
  assert.deepEqual(rightTokens, ["47318"]);
});

test("the right-address asset cannot document the endpoint already in the prompt", () => {
  // Regression on the finding that forced the rewrite: right.md originally read
  // 127.0.0.1:8096, which is in <skill_tools> verbatim on every turn. It had no
  // discriminative token at all, so "the model used the right asset" would have
  // been unprovable in the direction the demo depends on.
  const systemPrompt = systemPromptsFromCapture(
    readFileSync("evaluation/gate0/artifacts/gate0-threechannel-capture.jsonl", "utf8"),
  );
  const original = readFileSync("evaluation/tasks/bridge-addr/assets/right.md", "utf8")
    .replace("127.0.0.1:47318", "127.0.0.1:8096");
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

test("the two assets differ only in the address they document", () => {
  // Any second difference gives attribution a second explanation.
  const strip = (s) => s.replace(/eval-bridge-endpoint-[ab]/g, "NAME")
    .replace(/(10\.244\.7\.19:8096|127\.0\.0\.1:47318)/g, "ADDR");
  assert.equal(
    strip(readFileSync("evaluation/tasks/bridge-addr/assets/wrong.md", "utf8")),
    strip(readFileSync("evaluation/tasks/bridge-addr/assets/right.md", "utf8")),
  );
});
