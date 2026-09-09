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
 *   node evaluation/tasks/bridge-addr/verify.mjs <capture.jsonl ...> [--json]
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
 * The marker that separates carrying out the task from looking for it.
 *
 * The action alone is not enough. The task's *first* step is a search — for the
 * asset that documents the address — so accepting any `skill/search` scores
 * discovery as execution: search succeeds, reading the guidance asset fails,
 * the address is never used, and the run passes.
 *
 * Both assets therefore specify this query value for the call the task is
 * about, and both specify the same one, so it says "this is the task request"
 * without saying which asset was followed. The host and port say that.
 *
 * It appears in neither the task description nor the system prompt, so a run
 * that read no asset cannot produce it — and that run has not done the task,
 * which is exactly what "no attempt" should mean here.
 */
export const TASK_MARKER = "team-bridge-reachability";

/** The endpoint the assets document. */
export const TARGET_URL = /https?:\/\/(?:([\d.]+|localhost))(?::(\d+))?\/skill-bridge\/v3\/skill\/search\b/;

/**
 * The per-asset trace header, and why the discriminative token moved onto it.
 *
 * The address used to be the discriminative value: whichever host and port the
 * model dialled said which asset it had followed. That reading has a hole. The
 * address is a property of the **deployment** — it sits in the proxy config,
 * something is listening on it, and a model with a shell can find it without
 * reading any asset. So a hit did not establish that the asset was read.
 *
 * Each asset now also records a trace value that exists nowhere else: not in
 * the task description, not in the pool, not in the system prompt, not in the
 * memory baseline, not in any captured run. Checked with
 * `evaluation/runner/token-provenance.mjs` before the values were written in.
 * Following the asset means sending it, because the asset says to send it —
 * which is the guarantee "used ⇒ this token appears" needs, and a guarantee
 * about strings alone can never give.
 *
 * **Acceptance does not read it.** PASS and FAIL are decided by the outcome of
 * the target call and nothing else; the trace value is recorded and handed to
 * attribution. Acceptance staying independent of attribution is a standing
 * constraint — a run that reaches the address correctly without the header has
 * done the task, and it is attribution's problem that it cannot then say which
 * asset was followed.
 */
export const TRACE_HEADER = /x-team-trace\s*:\s*([A-Za-z0-9._-]+)/i;

/** The trace value this command carried, or "" when it carried none. */
export function traceOf(command) {
  return (TRACE_HEADER.exec(String(command ?? "")) ?? [, ""])[1] ?? "";
}

/** Was this command the task's request, rather than a search for the asset? */
export function isTargetCommand(command) {
  const cmd = String(command ?? "");
  return TARGET_URL.test(cmd) && cmd.includes(TASK_MARKER);
}

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

/**
 * Every attempt at the target, in the order the model made them.
 *
 * Built from the **calls**, not from the results. Walking results only makes an
 * attempt whose result was never captured invisible — so a run that succeeded
 * once and then fired a second call at the wrong address, with that result
 * missing, scored a clean PASS on the earlier success. The last thing the model
 * did has to be in the list even when nothing is known about how it ended;
 * that is what turns it into ERROR instead of silently restoring the previous
 * verdict.
 *
 * Results are then attached by `call_id`. An attempt with no result carries
 * `ok: null` — unknown, which is neither pass nor fail.
 */
export function attempts(captureEvents) {
  const calls = new Map();   // call_id -> attempt
  const results = new Map(); // call_id -> result text

  const requests = captureEvents
    .filter((e) => e?.event === "http.request" && Array.isArray(e?.body?.json?.messages))
    .sort((a, b) => String(a.timestamp ?? "").localeCompare(String(b.timestamp ?? "")));

  for (const event of requests) {
    const sessionKey = normalizeSessionKey(
      event?.headers?.["x-conversation-id"] ?? event?.headers?.["X-Conversation-Id"] ?? "",
    );

    event.body.json.messages.forEach((message, index) => {
      for (const tc of Array.isArray(message?.tool_calls) ? message.tool_calls : []) {
        const args = String(tc?.function?.arguments ?? JSON.stringify(tc?.input ?? ""));
        if (!isTargetCommand(args)) continue;
        const id = String(tc?.id ?? "");
        if (calls.has(id)) continue; // messages accumulate; one call, one attempt
        const m = TARGET_URL.exec(args);
        calls.set(id, {
          session_key: sessionKey, call_id: id, message_index: index,
          host: m?.[1] ?? "", port: m?.[2] ?? "80",
          value: traceOf(args),
          endpoint: commandEndpoint(args),
        });
      }

      const blocks = Array.isArray(message?.content) ? message.content : [];
      for (const block of blocks) {
        if (block?.type === "tool_use") {
          const args = JSON.stringify(block.input ?? "");
          if (!isTargetCommand(args)) continue;
          const id = String(block.id ?? "");
          if (calls.has(id)) continue;
          const m = TARGET_URL.exec(args);
          calls.set(id, {
            session_key: sessionKey, call_id: id, message_index: index,
            host: m?.[1] ?? "", port: m?.[2] ?? "80",
            value: traceOf(args),
            endpoint: commandEndpoint(args),
          });
        } else if (block?.type === "tool_result") {
          const id = String(block.tool_use_id ?? "");
          if (!results.has(id)) {
            results.set(id, typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? ""));
          }
        }
      }

      if (message?.role === "tool") {
        const id = String(message.tool_call_id ?? "");
        if (!results.has(id)) {
          results.set(id, typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? ""));
        }
      }
    });
  }

  return [...calls.values()]
    .sort((a, b) => a.message_index - b.message_index)
    .map((attempt) => {
      const text = results.get(attempt.call_id);
      return {
        ...attempt,
        ...(text === undefined
          ? { ok: null, why: "no result was captured for this call" }
          : outcomeOfAttempt(text)),
      };
    });
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
      reason: `no request carrying the task marker (${TASK_MARKER}) — the task was `
        + "never carried out, which is not the same as carrying it out and failing",
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
    lines.push(`  no call carrying the task marker (${TASK_MARKER}) appears in the capture`);
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
