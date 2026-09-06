/**
 * Cost of one run, from the capture.
 *
 * Token usage is read from the streamed responses: an OpenAI-compatible
 * upstream asked with `stream_options.include_usage` sends one final chunk
 * carrying `usage` before `[DONE]`. That chunk lives in the response body's
 * SSE text, not in any request. The first version of this collector looked
 * for `usage` inside request JSON and reported "not present in this capture"
 * for every run — a null that was honest about what it had looked at and
 * wrong about what the capture held.
 *
 * Null still means "no usage chunk was found"; zero would read as "measured,
 * and it was free".
 *
 * Usage:
 *   node evaluation/runner/cost.mjs <capture.jsonl> <out.json> [--started=<epoch seconds>] [--wall=<seconds>]
 */

import { readFileSync, writeFileSync } from "node:fs";

/** Parse a streamed response body's SSE text and return the last usage block, or null. */
export function usageFromSse(text) {
  let last = null;
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    let chunk;
    try { chunk = JSON.parse(payload); } catch { continue; }
    if (chunk && typeof chunk === "object" && chunk.usage && typeof chunk.usage === "object") last = chunk.usage;
  }
  return last;
}

/** Usage of one response event, streamed or plain JSON. Null when absent. */
export function usageOfResponse(event) {
  const body = event?.body ?? {};
  if (body.json && typeof body.json === "object" && body.json.usage) return body.json.usage;
  if (typeof body.text === "string") return usageFromSse(body.text);
  return null;
}

const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : 0);

/** Aggregate a capture's events into the cost record. */
export function costOf(events, { wallSeconds = null } = {}) {
  let turns = 0;
  let systemChars = 0;
  const perTurn = [];
  for (const e of events) {
    const body = e?.body ?? {};
    if (e?.event === "http.request" && Array.isArray(body.json?.messages)) {
      turns += 1;
      const first = body.json.messages[0];
      if (first?.role === "system") {
        const c = first.content;
        systemChars = Math.max(systemChars, (typeof c === "string" ? c : JSON.stringify(c ?? "")).length);
      }
    }
    if (e?.event === "http.response") {
      const u = usageOfResponse(e);
      if (u) {
        perTurn.push({
          request_id: e.requestId ?? null,
          prompt_tokens: num(u.prompt_tokens),
          completion_tokens: num(u.completion_tokens),
          total_tokens: num(u.total_tokens) || num(u.prompt_tokens) + num(u.completion_tokens),
          cached_tokens: num(u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens),
          reasoning_tokens: num(u.completion_tokens_details?.reasoning_tokens),
        });
      }
    }
  }
  const sum = (k) => perTurn.reduce((a, t) => a + t[k], 0);
  const seen = perTurn.length > 0;
  return {
    turns,
    responses_with_usage: perTurn.length,
    wall_seconds: wallSeconds,
    system_prompt_chars: systemChars,
    prompt_tokens: seen ? sum("prompt_tokens") : null,
    completion_tokens: seen ? sum("completion_tokens") : null,
    total_tokens: seen ? sum("total_tokens") : null,
    cached_tokens: seen ? sum("cached_tokens") : null,
    reasoning_tokens: seen ? sum("reasoning_tokens") : null,
    token_source: seen ? "final usage chunk of each streamed response in the capture" : "no usage chunk in any captured response",
    per_turn: perTurn,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const [capture, out] = args.filter((a) => !a.startsWith("--"));
  const arg = (name) => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
  if (!capture || !out) { console.error("usage: node cost.mjs <capture.jsonl> <out.json> [--started=EPOCH] [--wall=SECONDS]"); process.exit(2); }
  const events = readFileSync(capture, "utf8").split("\n").filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  let wall = arg("wall") != null ? Number(arg("wall")) : null;
  if (wall === null && arg("started") != null) wall = Math.floor(Date.now() / 1000) - Number(arg("started"));
  const cost = costOf(events, { wallSeconds: wall });
  writeFileSync(out, JSON.stringify(cost, null, 2) + "\n");
  console.log(`turns ${cost.turns}, prompt ${cost.prompt_tokens ?? "—"}, completion ${cost.completion_tokens ?? "—"}, cached ${cost.cached_tokens ?? "—"}, wall ${cost.wall_seconds ?? "—"}s`);
}
