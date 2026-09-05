/**
 * Acceptance for the bridge-address scenario: did the task actually succeed?
 *
 * The question is narrower than "did anything work". A run reads assets, issues
 * several calls, and ends with some text. What decides the outcome is whether
 * **the attempt the task was about** succeeded — the call to the address the
 * asset documented — and nothing else.
 *
 * Four outcomes, and each exists because the obvious rule gets it wrong:
 *
 *   FAIL   a prerequisite read succeeded and the target call timed out.
 *          "Some call in this session returned 200" is true here and the task
 *          plainly failed: the 200 was the model fetching the asset that told
 *          it which address to use.
 *
 *   FAIL   the target succeeded early and failed at the end. "Ever succeeded"
 *          is true and the run did not work. A model that gets a good response
 *          and then breaks it has not completed the task.
 *
 *   PASS   the target failed first and succeeded last. "Never failed" is false
 *          and the run did work — retrying after an error is ordinary, correct
 *          behaviour, and a rule that punishes it measures neatness.
 *
 *   ERROR  no attempt at the target, or an outcome that cannot be read. Exits
 *          non-zero, separately from FAIL, and says which. A run that never
 *          tried is not a run that tried and failed, and collapsing them turns
 *          a broken harness into evidence about the asset.
 *
 * So the rule is: **the last attempt at the target decides**, and no attempt at
 * all is not a verdict.
 *
 * Usage:
 *   node evaluation/tasks/bridge-addr/verify.mjs <capture.jsonl ...> \
 *     [--tool-calls=<tool-call-logs.jsonl>] [--json]
 *
 * Exit: 0 PASS · 1 FAIL · 2 ERROR (including "never attempted")
 */

import { readFileSync } from "node:fs";
import {
  parseJsonl,
  normalizeSessionKey,
  splitCommandAndOutput,
  commandEndpoint,
} from "../../provenance/build-events.mjs";

/**
 * The call the task is about.
 *
 * Not any skill-bridge call: fetching the asset that documents the address is
 * itself a skill-bridge call, and counting it makes "the model read the
 * instructions" indistinguishable from "the model followed them". The task asks
 * for a *search* against the documented address, and both assets document that
 * endpoint — so the action pins the target and the host and port say which
 * asset was followed.
 */
export const TARGET = /https?:\/\/(?:([\d.]+|localhost))(?::(\d+))?\/skill-bridge\/v3\/skill\/search\b/;

export const PASS = "PASS";
export const FAIL = "FAIL";
export const ERROR = "ERROR";

/**
 * Read one attempt's outcome from its result text.
 *
 * A shell result carries three separable signals and they disagree often
 * enough to matter: the exit code, the HTTP status, and the envelope's own
 * `code`. A 200 carrying `{"code":40101}` is a refusal that curl calls success.
 */
export function outcomeOfAttempt(resultText) {
  const { output } = splitCommandAndOutput(resultText);
  const s = String(resultText ?? "");

  const exit = /(?:^|\n)Exit code:\s*(\d+)/.exec(s);
  const exitCode = exit ? Number(exit[1]) : null;
  if (exitCode === 28 || /Operation timed out|Connection timed out/.test(s)) {
    return { ok: false, why: "timed out" };
  }
  if (exitCode !== null && exitCode !== 0) return { ok: false, why: `exit ${exitCode}` };
  if (/Could not resolve host|Connection refused|Failed to connect/.test(s)) {
    return { ok: false, why: "could not connect" };
  }

  const http = /HTTP_CODE:\s*(\d{3})/.exec(s);
  if (http && !/^2/.test(http[1])) return { ok: false, why: `http ${http[1]}` };

  const envelope = /"code"\s*:\s*(\d+)/.exec(output);
  if (envelope) {
    return Number(envelope[1]) === 0
      ? { ok: true, why: "code 0" }
      : { ok: false, why: `service code ${envelope[1]}` };
  }

  // Nothing readable. Not a failure — an unreadable outcome, which is its own
  // answer and must not be rounded to either verdict.
  if (!output.trim()) return { ok: null, why: "no output" };
  return { ok: null, why: "outcome not readable" };
}

/** Every attempt at the target address, in the order the model made them. */
export function attempts(captureEvents) {
  const seen = new Set();
  const found = [];

  const requests = captureEvents
    .filter((e) => e?.event === "http.request" && Array.isArray(e?.body?.json?.messages))
    .sort((a, b) => String(a.timestamp ?? "").localeCompare(String(b.timestamp ?? "")));

  for (const event of requests) {
    const sessionKey = normalizeSessionKey(
      event?.headers?.["x-conversation-id"] ?? event?.headers?.["X-Conversation-Id"] ?? "",
    );
    const msgs = event.body.json.messages;
    msgs.forEach((message, index) => {
      const isTool = message?.role === "tool";
      const blocks = Array.isArray(message?.content) ? message.content : [];
      const items = isTool
        ? [{ callId: String(message.tool_call_id ?? ""), text: typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? "") }]
        : blocks.filter((b) => b?.type === "tool_result")
            .map((b) => ({ callId: String(b.tool_use_id ?? ""), text: typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? "") }));

      for (const { callId, text } of items) {
        const { command } = splitCommandAndOutput(text);
        const m = TARGET.exec(command);
        if (!m) continue;
        const key = `${sessionKey}|${callId}|${index}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({
          session_key: sessionKey,
          call_id: callId,
          message_index: index,
          host: m[1] ?? "",
          port: m[2] ?? "80",
          endpoint: commandEndpoint(command),
          ...outcomeOfAttempt(text),
        });
      }
    });
  }
  return found;
}

/**
 * The verdict.
 *
 * The last attempt decides. Everything before it is history: a run that failed
 * and retried succeeded, and a run that succeeded and then broke it did not.
 */
export function verify(captureEvents) {
  const tried = attempts(captureEvents);

  if (tried.length === 0) {
    return {
      verdict: ERROR,
      reason: "no attempt at the target address — the task was never carried out, "
        + "which is not the same as carrying it out and failing",
      attempts: tried,
    };
  }

  const last = tried[tried.length - 1];
  if (last.ok === null) {
    return {
      verdict: ERROR,
      reason: `the final attempt's outcome could not be read (${last.why}); `
        + "an unreadable result is not a failure and must not be scored as one",
      attempts: tried,
    };
  }

  const earlier = tried.slice(0, -1);
  const note = earlier.length === 0
    ? ""
    : last.ok
      ? ` after ${earlier.filter((a) => a.ok === false).length} earlier failure(s)`
      : ` despite ${earlier.filter((a) => a.ok === true).length} earlier success(es)`;

  return {
    verdict: last.ok ? PASS : FAIL,
    reason: `the final attempt at ${last.host}:${last.port} ${last.ok ? "succeeded" : "failed"} (${last.why})${note}`,
    attempts: tried,
  };
}

export function render({ verdict, reason, attempts: tried }) {
  const lines = [`${verdict}  ${reason}`, ""];
  if (tried.length === 0) {
    lines.push("  no call to the bridge address appears in the capture");
  } else {
    lines.push(`  ${tried.length} attempt(s) at the target:`);
    for (const a of tried) {
      const mark = a.ok === true ? "ok  " : a.ok === false ? "fail" : "?   ";
      lines.push(`    ${mark} msg[${a.message_index}] ${a.host}:${a.port}  ${a.why}`);
    }
  }
  return lines.join("\n");
}

// ── CLI ───────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const capturePaths = args.filter((a) => !a.startsWith("--"));
  if (capturePaths.length === 0) {
    console.error("usage: node verify.mjs <capture.jsonl ...> [--json]");
    process.exit(2);
  }

  const result = verify(capturePaths.flatMap((p) => parseJsonl(readFileSync(p, "utf8"))));
  console.log(args.includes("--json") ? JSON.stringify(result, null, 2) : render(result));
  process.exit(result.verdict === PASS ? 0 : result.verdict === FAIL ? 1 : 2);
}
