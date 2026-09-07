/**
 * Acceptance for the `bridge-name` scenario: did the model fetch the
 * checklist through the bridge and get its marker back?
 *
 * Same shape as the mainline's verify.mjs, different target:
 *
 *   attempt   a `skill/get` call carrying the task marker header
 *             (`x-eval-task: team-checklist-lookup`); its **value** is the
 *             `skill_id` in the request body — the analogue of host:port
 *   success   the envelope is code 0 AND the returned content carries a
 *             `checklist-marker: qz7-…` line
 *   failure   a non-zero envelope code (40401 SKILL_NOT_FOUND from core,
 *             403 not_visible from the bridge), a non-2xx HTTP code, a
 *             non-zero exit; a timeout or connection failure is
 *             environmental and is reported as such
 *   verdict   the last attempt decides, as in the mainline
 *
 * The marker header is what separates carrying out the task from discovery:
 * a `skill/get` the model makes while looking around is not an attempt.
 *
 * Usage:
 *   node verify.mjs <capture.jsonl ...> [--json]
 */

import { readFileSync } from "node:fs";
import { parseJsonl, normalizeSessionKey, splitCommandAndOutput, commandEndpoint } from "../../provenance/build-events.mjs";

export const TASK_MARKER = "team-checklist-lookup";
export const CHECKLIST_MARKER = /checklist-marker:\s*(qz7-[A-Za-z0-9-]+)/;
export const TARGET_URL = /https?:\/\/(?:([\d.]+|localhost))(?::(\d+))?\/skill-bridge\/v3\/skill\/get\b(?!-by-name)/;
export const PASS = "PASS";
export const FAIL = "FAIL";
export const ERROR = "ERROR";

export function isTargetCommand(command) {
  const cmd = String(command ?? "");
  return TARGET_URL.test(cmd) && cmd.includes(TASK_MARKER);
}

/** The skill_id the command asked for, or null. */
export function valueOf(command) {
  const cmd = String(command ?? "");
  // The command arrives JSON-stringified inside the tool arguments, so the
  // quotes around the key and the value may be escaped; both forms are read.
  const m = /skill_id\\?["']?\s*:\s*\\?["']?([A-Za-z0-9_-]+)/.exec(cmd) || /skill_id\s*=\s*([A-Za-z0-9_-]+)/.exec(cmd);
  return m ? m[1] : null;
}

export function outcomeOfAttempt(resultText) {
  const { output } = splitCommandAndOutput(resultText);
  const s = String(resultText ?? "");
  const exit = /(?:^|\n)Exit code:\s*(\d+)/.exec(s);
  const exitCode = exit ? Number(exit[1]) : null;
  if (exitCode === 28 || /Operation timed out|Connection timed out/.test(s)) return { ok: false, why: "timed out" };
  if (exitCode !== null && exitCode !== 0) return { ok: false, why: `exit ${exitCode}` };
  if (/Could not resolve host|Connection refused|Failed to connect/.test(s)) return { ok: false, why: "could not connect" };
  const http = /HTTP_CODE:\s*(\d{3})/.exec(s);
  if (http && !/^2/.test(http[1])) return { ok: false, why: `http ${http[1]}` };
  const envelope = /"code"\s*:\s*(\d+)/.exec(output);
  if (envelope) {
    if (Number(envelope[1]) !== 0) return { ok: false, why: `service code ${envelope[1]}` };
    const marker = CHECKLIST_MARKER.exec(output);
    return marker
      ? { ok: true, why: `code 0, marker ${marker[1]}` }
      : { ok: false, why: "code 0 but the content carries no checklist-marker" };
  }
  if (!output.trim()) return { ok: null, why: "no output" };
  return { ok: null, why: "outcome not readable" };
}

export function attempts(captureEvents) {
  const calls = new Map();
  const results = new Map();
  const requests = captureEvents
    .filter((e) => e?.event === "http.request" && Array.isArray(e?.body?.json?.messages))
    .sort((a, b) => String(a.timestamp ?? "").localeCompare(String(b.timestamp ?? "")));
  const record = (id, args, sessionKey, index) => {
    if (!isTargetCommand(args) || calls.has(id)) return;
    const m = TARGET_URL.exec(args);
    calls.set(id, { session_key: sessionKey, call_id: id, message_index: index, host: m?.[1] ?? "", port: m?.[2] ?? "80", value: valueOf(args), endpoint: commandEndpoint(args) });
  };
  for (const event of requests) {
    const sessionKey = normalizeSessionKey(event?.headers?.["x-conversation-id"] ?? event?.headers?.["X-Conversation-Id"] ?? "");
    event.body.json.messages.forEach((message, index) => {
      for (const tc of Array.isArray(message?.tool_calls) ? message.tool_calls : []) {
        record(String(tc?.id ?? ""), String(tc?.function?.arguments ?? JSON.stringify(tc?.input ?? "")), sessionKey, index);
      }
      for (const block of Array.isArray(message?.content) ? message.content : []) {
        if (block?.type === "tool_use") record(String(block.id ?? ""), JSON.stringify(block.input ?? ""), sessionKey, index);
        else if (block?.type === "tool_result") {
          const id = String(block.tool_use_id ?? "");
          if (!results.has(id)) results.set(id, typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? ""));
        }
      }
      if (message?.role === "tool") {
        const id = String(message.tool_call_id ?? "");
        if (!results.has(id)) results.set(id, typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? ""));
      }
    });
  }
  return [...calls.values()].sort((a, b) => a.message_index - b.message_index).map((attempt) => {
    const text = results.get(attempt.call_id);
    return { ...attempt, ...(text === undefined ? { ok: null, why: "no result was captured for this call" } : outcomeOfAttempt(text)) };
  });
}

export function verify(captureEvents) {
  const tried = attempts(captureEvents);
  if (tried.length === 0) {
    return { verdict: ERROR, reason: `no skill/get carrying the task marker (${TASK_MARKER}) — the task was never carried out, which is not the same as carrying it out and failing`, attempts: tried };
  }
  const last = tried[tried.length - 1];
  if (last.ok === null) return { verdict: ERROR, reason: `the final attempt's outcome could not be read (${last.why})`, attempts: tried };
  const earlier = tried.slice(0, -1);
  const note = earlier.length === 0 ? "" : last.ok ? ` after ${earlier.filter((a) => a.ok === false).length} earlier failure(s)` : ` despite ${earlier.filter((a) => a.ok === true).length} earlier success(es)`;
  return { verdict: last.ok ? PASS : FAIL, reason: `the final get of ${last.value ?? "?"} ${last.ok ? "succeeded" : "failed"} (${last.why})${note}`, attempts: tried };
}

export function render({ verdict, reason, attempts: tried }) {
  const lines = [`${verdict}  ${reason}`, ""];
  if (tried.length === 0) lines.push(`  no skill/get carrying the task marker (${TASK_MARKER}) appears in the capture`);
  else {
    lines.push(`  ${tried.length} attempt(s) at the target:`);
    for (const a of tried) lines.push(`    ${a.ok === true ? "ok  " : a.ok === false ? "fail" : "?   "} msg[${a.message_index}] get ${a.value ?? "?"} via ${a.host}:${a.port}  ${a.why}`);
  }
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const paths = args.filter((a) => !a.startsWith("--"));
  if (paths.length === 0) { console.error("usage: node verify.mjs <capture.jsonl ...> [--json]"); process.exit(2); }
  const result = verify(paths.flatMap((p) => parseJsonl(readFileSync(p, "utf8"))));
  console.log(args.includes("--json") ? JSON.stringify(result, null, 2) : render(result));
  process.exit(result.verdict === PASS ? 0 : result.verdict === FAIL ? 1 : 2);
}
