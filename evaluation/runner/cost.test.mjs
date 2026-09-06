import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { usageFromSse, usageOfResponse, costOf } from "./cost.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const sse = (chunks) => chunks.map((c) => `data: ${typeof c === "string" ? c : JSON.stringify(c)}`).join("\n\n") + "\n\ndata: [DONE]\n";

test("usage comes from the last SSE chunk that carries it, not from earlier null-usage chunks", () => {
  const text = sse([
    { choices: [{ delta: { content: "hi" } }], usage: null },
    { choices: [{ delta: { content: "!" } }], usage: null },
    { choices: [], usage: { prompt_tokens: 27509, completion_tokens: 1302, total_tokens: 28811, prompt_tokens_details: { cached_tokens: 3328 }, completion_tokens_details: { reasoning_tokens: 1110 } } },
  ]);
  const u = usageFromSse(text);
  assert.equal(u.prompt_tokens, 27509);
  assert.equal(u.prompt_tokens_details.cached_tokens, 3328);
});

test("a stream with no usage chunk yields null, never zero", () => {
  assert.equal(usageFromSse(sse([{ choices: [{ delta: { content: "x" } }] }])), null);
  assert.equal(usageFromSse("garbage\ndata: not json\n"), null);
  const c = costOf([{ event: "http.response", body: { text: sse([{ choices: [] }]) } }]);
  assert.equal(c.prompt_tokens, null);
  assert.equal(c.total_tokens, null);
  assert.match(c.token_source, /no usage chunk/);
});

test("plain JSON responses with a usage object are read too", () => {
  assert.equal(usageOfResponse({ body: { json: { usage: { prompt_tokens: 5 } } } }).prompt_tokens, 5);
});

test("costOf sums per response and counts turns and the largest system prompt", () => {
  const req = (n) => ({ event: "http.request", body: { json: { messages: [{ role: "system", content: "s".repeat(n) }, { role: "user", content: "u" }] } } });
  const resp = (p, c, cached = 0, reasoning = 0) => ({ event: "http.response", requestId: `r${p}`, body: { text: sse([{ usage: { prompt_tokens: p, completion_tokens: c, total_tokens: p + c, prompt_tokens_details: { cached_tokens: cached }, completion_tokens_details: { reasoning_tokens: reasoning } } }]) } });
  const cost = costOf([req(100), resp(10, 2, 3, 1), req(120), resp(20, 4, 5, 2)], { wallSeconds: 33 });
  assert.equal(cost.turns, 2);
  assert.equal(cost.responses_with_usage, 2);
  assert.equal(cost.system_prompt_chars, 120);
  assert.equal(cost.prompt_tokens, 30);
  assert.equal(cost.completion_tokens, 6);
  assert.equal(cost.total_tokens, 36);
  assert.equal(cost.cached_tokens, 8);
  assert.equal(cost.reasoning_tokens, 3);
  assert.equal(cost.wall_seconds, 33);
  assert.equal(cost.per_turn.length, 2);
});

test("real capture: every streamed response in run 3 of the off arm carries usage", () => {
  const p = join(HERE, "runs", "20260906T111638Z-gate-off", "capture.jsonl");
  if (!existsSync(p)) return;
  const events = readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const cost = costOf(events);
  assert.equal(cost.responses_with_usage, 5);
  assert.ok(cost.prompt_tokens > 100000, String(cost.prompt_tokens));
  assert.ok(cost.cached_tokens > 0);
});
