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
 *   ERROR  no attempt at the target, or an outcome that cannot be read, or no
 *          single last attempt. Exits non-zero, separately from FAIL, and says
 *          which. A run that never tried is not a run that tried and failed,
 *          and collapsing them turns a broken harness into evidence about the
 *          asset.
 *
 * So the rule is: **the last attempt at the target decides**, and no attempt at
 * all is not a verdict.
 *
 * What an attempt is (attempts-2026-09-11). Batch 4 showed that a tool call is
 * not a request: one Bash command dialled two addresses in sequence, a `for`
 * loop issued five searches with a variable body, and two dials were issued
 * as two tool calls in one model message. Reading the first URL in the text
 * and one outcome for the whole call recorded "127.0.0.1:47318 timed out" for
 * a request that returned code 0. Four boundaries now hold:
 *
 *   1. every request the shell would run is its own attempt, with its own
 *      address, trace value and outcome; one tool call may hold several;
 *   2. an outcome is read from the call's own result only when the call made
 *      one request; otherwise it needs evidence that separates the requests —
 *      a file the model wrote with -o and read back, or the service's own log
 *      of what it answered — and stays unknown without it;
 *   3. `;` and a newline are an order; `&&`, `||`, `if` are a condition; a
 *      loop is an unknown count; `&` and two tool calls in one message are no
 *      order at all — the text order never stands in for "last";
 *   4. the task request is recognised from the parsed action and fields (a
 *      POST to the search path whose body's query is the task marker), never
 *      from the whole command containing the marker, and never only when the
 *      address or trace is the right one.
 *
 * Usage:
 *   node evaluation/tasks/bridge-addr/verify.mjs <capture.jsonl ...> [--json]
 *        [--service-log=tool-call-logs.jsonl] [--reachability=reachability.json]
 *
 * Exit: 0 PASS · 1 FAIL · 2 ERROR (including "never attempted")
 */

import { readFileSync } from "node:fs";
import { parseJsonl, normalizeSessionKey, splitCommandAndOutput, commandEndpoint } from "../../provenance/build-events.mjs";
import { curlInvocations } from "../../provenance/shell-requests.mjs";

export const ACCEPTANCE_VERSION = "attempts-2026-09-11";

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
 * It is the **value of the body's `query` field**, read from the parsed
 * request. A search whose query merely contains it ("reachability check
 * team-bridge-reachability", batch 4 run 5) is looking for guidance, not
 * doing the task, and a command that mentions it somewhere else is not a
 * request at all.
 */
export const TASK_MARKER = "team-bridge-reachability";

/** The endpoint the assets document. */
export const TARGET_PATH = /^\/skill-bridge\/v3\/skill\/search\/?$/;
/** Kept for readers that match a URL in text (the reachability probe, older records). */
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

/**
 * The task request inside one parsed curl invocation, or why it cannot be one.
 * @returns {{host, port, value, query} | {unidentified: string} | null}
 */
export function taskRequestOf(inv) {
  if (!inv || !TARGET_PATH.test(inv.path ?? "")) return null;
  if (!inv.url_literal) return { unidentified: `url is not literal (${inv.url})` };
  if (inv.body == null) return null;
  if (!inv.body_literal) return { unidentified: `body is not literal${inv.in_loop ? " (inside a loop)" : ""}: ${inv.body.slice(0, 60)}` };
  let q = null;
  try { q = JSON.parse(inv.body)?.query ?? null; } catch { const m = /"query"\s*:\s*"([^"]*)"/.exec(inv.body); q = m ? m[1] : null; }
  if (q == null) return null;
  if (String(q).trim() !== TASK_MARKER) return null;
  return { host: inv.host, port: inv.port, value: inv.headers?.["x-team-trace"] ?? "", query: String(q) };
}

/** Was this command the task's request, rather than a search for the asset? */
export function isTargetCommand(command) {
  return curlInvocations(command).some((inv) => { const t = taskRequestOf(inv); return t && !t.unidentified; });
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

  const exit = /(?:^|\n)Exit code:\s*(\d+)/i.exec(s);
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

// ── the capture, read once ────────────────────────────────────────

const commandOf = (args) => { try { return JSON.parse(args)?.command ?? ""; } catch { return ""; } };

/**
 * Tool calls, their results, and when each was issued and returned, from the
 * capture. Messages accumulate across requests, so a call is counted once.
 */
function readCapture(captureEvents) {
  const events = (captureEvents ?? []).filter((e) => e && typeof e === "object");
  const requests = events.filter((e) => e.event === "http.request" && Array.isArray(e?.body?.json?.messages))
    .sort((a, b) => String(a.timestamp ?? "").localeCompare(String(b.timestamp ?? "")));
  const responses = events.filter((e) => e.event === "http.response")
    .sort((a, b) => String(a.timestamp ?? "").localeCompare(String(b.timestamp ?? "")));
  const ms = (t) => { const v = Date.parse(String(t ?? "")); return Number.isFinite(v) ? v : null; };

  const calls = new Map();   // id -> call
  const results = new Map(); // id -> { text, message_index }
  for (const event of requests) {
    const sessionKey = normalizeSessionKey(event?.headers?.["x-conversation-id"] ?? event?.headers?.["X-Conversation-Id"] ?? "");
    const reqAt = ms(event.timestamp);
    // the assistant message that issued a call was produced by the last response before this request
    const prior = responses.filter((r) => (ms(r.timestamp) ?? Infinity) <= (reqAt ?? -Infinity));
    const issuedAt = prior.length ? ms(prior[prior.length - 1].timestamp) : null;
    event.body.json.messages.forEach((message, index) => {
      const tcs = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
      for (const tc of tcs) {
        const id = String(tc?.id ?? "");
        if (calls.has(id)) continue;
        const args = String(tc?.function?.arguments ?? JSON.stringify(tc?.input ?? ""));
        calls.set(id, { call_id: id, session_key: sessionKey, message_index: index, args, command: commandOf(args), tool: tc?.function?.name ?? null, issued_at: issuedAt, siblings: tcs.length, returned_by: null });
      }
      const blocks = Array.isArray(message?.content) ? message.content : [];
      for (const block of blocks) {
        if (block?.type === "tool_use") {
          const id = String(block.id ?? "");
          if (calls.has(id)) continue;
          const args = JSON.stringify(block.input ?? "");
          calls.set(id, { call_id: id, session_key: sessionKey, message_index: index, args, command: block.input?.command ?? "", tool: block.name ?? null, issued_at: issuedAt, siblings: blocks.filter((b) => b?.type === "tool_use").length, returned_by: null });
        } else if (block?.type === "tool_result") {
          const id = String(block.tool_use_id ?? "");
          if (!results.has(id)) {
            results.set(id, { text: typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? ""), message_index: index });
            if (calls.has(id)) calls.get(id).returned_by = reqAt;
          }
        }
      }
      if (message?.role === "tool") {
        const id = String(message.tool_call_id ?? "");
        if (!results.has(id)) {
          results.set(id, { text: typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? ""), message_index: index });
          if (calls.has(id)) calls.get(id).returned_by = reqAt;
        }
      }
    });
  }
  return { calls, results };
}

// ── the service's own log as evidence ─────────────────────────────

const localMs = (t) => { const v = Date.parse(String(t ?? "").replace(" ", "T") + (/[Zz]|[+-]\d\d:?\d\d$/.test(String(t ?? "")) ? "" : "Z")); return Number.isFinite(v) ? v : null; };

/**
 * The log's clock relative to the capture's: model_intent rows carry the
 * command the proxy saw; the same command sits in a tool call whose issue
 * time the capture knows. Median difference, or null when nothing pairs.
 */
export function serviceClockOffset(serviceRows, calls) {
  const byCommand = new Map();
  for (const c of calls.values()) if (c.command && c.issued_at != null) byCommand.set(c.command, c.issued_at);
  const diffs = [];
  for (const r of serviceRows ?? []) {
    if (r?.kind !== "model_intent") continue;
    const cmd = commandOf(r.request_body ?? "");
    const at = localMs(r.timestamp);
    if (cmd && byCommand.has(cmd) && at != null) diffs.push(at - byCommand.get(cmd));
  }
  if (!diffs.length) return null;
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
}

/** Rows in which the service answered a request whose body's query is the task marker. */
function answeredTaskRows(serviceRows, offset) {
  const out = [];
  for (const r of serviceRows ?? []) {
    if (r?.kind !== "bridge_call" || String(r.executed_endpoint ?? "") !== "search") continue;
    let q = null;
    try { q = JSON.parse(r.request_body ?? "")?.query ?? null; } catch { const m = /"query"\s*:\s*"([^"]*)"/.exec(String(r.request_body ?? "")); q = m ? m[1] : null; }
    if (String(q ?? "").trim() !== TASK_MARKER) continue;
    const at = localMs(r.timestamp);
    out.push({ at: at == null || offset == null ? null : at - offset, status: Number(r.upstream_status), elapsed_ms: r.elapsed_ms ?? null });
  }
  return out;
}

const envelopeCodes = (output) => [...String(output ?? "").matchAll(/"code"\s*:\s*(\d+)/g)].map((m) => Number(m[1]));
// one timed-out curl prints both "curl: (28)" and "… timed out"; count the exit line when present, the phrase otherwise
const timeoutCount = (text) => {
  const s = String(text ?? "");
  const exits = (s.match(/curl: \(28\)/g) ?? []).length;
  return exits || (s.match(/Operation timed out|Connection timed out/g) ?? []).length;
};
const connectFailCount = (text) => (String(text ?? "").match(/Could not resolve host|Connection refused|Failed to connect/g) ?? []).length;

/**
 * Every attempt at the target, in the order the model made them, each with the
 * evidence its outcome rests on.
 *
 * @param captureEvents  parsed capture rows
 * @param opts.serviceRows  tool-call-logs.jsonl rows (the proxy's own record of what it answered)
 * @param opts.reachability  reachability.json (the harness probe of each address)
 */
export function attempts(captureEvents, opts = {}) {
  const { calls, results } = readCapture(captureEvents);
  const problems = [];
  const offset = serviceClockOffset(opts.serviceRows, calls);
  const answered = opts.serviceRows?.length ? answeredTaskRows(opts.serviceRows, offset) : [];
  if (opts.serviceRows?.length && offset == null) problems.push("service log given but no model_intent row pairs with a captured tool call; its rows cannot be placed in time and are not used");
  const reach = opts.reachability?.targets ?? opts.reachability ?? null;
  const reachOf = (host, port) => (reach && reach[`${host}:${port}`] ? reach[`${host}:${port}`].ok ?? null : null);

  const perCall = [];
  for (const call of [...calls.values()].sort((a, b) => a.message_index - b.message_index)) {
    if (!call.command) {
      if (/skill-bridge\/v3\/skill\/search/.test(call.args)) problems.push(`${call.call_id} (msg ${call.message_index}): mentions the target path but is not a shell command; not parsed`);
      continue;
    }
    const invs = curlInvocations(call.command);
    if (!invs.length) {
      if (/skill-bridge\/v3\/skill\/search/.test(call.command)) problems.push(`${call.call_id} (msg ${call.message_index}): mentions the target path but makes no curl request; not parsed`);
      continue;
    }
    const list = [];
    for (const inv of invs) {
      const t = taskRequestOf(inv);
      if (!t) continue;
      if (t.unidentified) { problems.push(`${call.call_id} (msg ${call.message_index}): a request to the target path cannot be identified as the task request — ${t.unidentified}`); continue; }
      list.push({
        session_key: call.session_key, call_id: call.call_id, message_index: call.message_index, request_index: list.length,
        host: t.host, port: t.port, value: t.value, endpoint: commandEndpoint(inv.url),
        out_file: inv.out_file, max_time: inv.max_time,
        in_loop: inv.in_loop, conditional: inv.conditional, background: inv.background, sequential: inv.sequential,
        issued_with: call.siblings, // tool calls in the same model message
        executed: null, executed_at: null, ok: null, why: "", evidence: [],
      });
    }
    if (list.length) perCall.push({ call, invs, list });
  }

  // outcomes
  for (const { call, invs, list } of perCall) {
    const res = results.get(call.call_id);
    if (!res) { for (const a of list) { a.why = "no result was captured for this call"; } continue; }
    const text = res.text;
    const { output } = splitCommandAndOutput(text);

    if (invs.length === 1) {
      const a = list[0];
      if (a.in_loop) { a.why = "inside a loop: executed an unknown number of times; outcome not separable"; a.evidence.push("loop"); continue; }
      Object.assign(a, outcomeOfAttempt(text));
      a.executed = true;
      a.evidence.push("the only request in the call; outcome read from its result");
      continue;
    }

    // several requests in one call: each needs evidence of its own
    // (a) a file the model wrote with -o and read back later
    for (const a of list) {
      if (!a.out_file) continue;
      const later = [...calls.values()].filter((c) => c.message_index > call.message_index && c.command && c.command.includes(a.out_file))
        .sort((x, y) => x.message_index - y.message_index);
      for (const c of later) {
        const r = results.get(c.call_id);
        if (!r) continue;
        const codes = envelopeCodes(splitCommandAndOutput(r.text).output);
        if (!codes.length) continue;
        a.ok = codes.every((x) => x === 0) ? true : codes.every((x) => x !== 0) ? false : null;
        a.why = a.ok === true ? "code 0" : a.ok === false ? `service code ${codes.find((x) => x !== 0)}` : "the file shows mixed envelope codes";
        a.executed = true;
        a.evidence.push(`file ${a.out_file} read back at msg ${c.message_index} (${c.call_id})`);
        break;
      }
    }
    // (b) the service's log: which requests were answered, in this call's window
    const open = list.filter((a) => a.ok === null && !a.evidence.length);
    if (open.length && offset != null) {
      const from = (call.issued_at ?? -Infinity) - 2000, to = (call.returned_by ?? Infinity) + 2000;
      const rows = answered.filter((r) => r.at != null && r.at >= from && r.at <= to);
      const servable = list.filter((a) => reachOf(a.host, a.port) === true);
      const unservable = list.filter((a) => reachOf(a.host, a.port) === false);
      const unknownReach = list.filter((a) => reachOf(a.host, a.port) === null);
      const codes = envelopeCodes(output);
      if (!unknownReach.length && rows.length === servable.length) {
        const rowsAgree = rows.every((r) => r.status === 200);
        const codesAgree = codes.length > 0 && codes.every((c) => c === codes[0]);
        for (const a of servable) {
          if (a.ok !== null || a.evidence.length) continue;
          a.executed = true;
          a.executed_at = rows.length === 1 ? new Date(rows[0].at).toISOString() : null;
          if (rowsAgree && codesAgree) {
            a.ok = codes[0] === 0; a.why = a.ok ? "code 0" : `service code ${codes[0]}`;
            a.evidence.push(`answered per the service log (${rows.length} row(s) in the call's window, status 200); the envelope code(s) in the output all read ${codes[0]}`);
          } else if (rows.length && rows.every((r) => !/^2/.test(String(r.status)))) {
            a.ok = false; a.why = `http ${rows[0].status}`;
            a.evidence.push("answered per the service log with a non-2xx status");
          } else {
            a.why = rows.length ? "answered per the service log, but the envelope cannot be attributed" : "no answer in the service log";
            a.evidence.push("service log");
          }
        }
        const seqUnserv = unservable.filter((a) => a.sequential);
        const tos = timeoutCount(text), cfs = connectFailCount(text);
        for (const a of unservable) {
          if (a.ok !== null || a.evidence.length) continue;
          if (seqUnserv.length === unservable.length && tos === unservable.length) {
            a.ok = false; a.why = "timed out"; a.executed = true;
            a.evidence.push(`not answered per the service log; the only unreachable address(es) and the result shows ${tos} timeout(s)`);
          } else if (seqUnserv.length === unservable.length && cfs === unservable.length) {
            a.ok = false; a.why = "could not connect"; a.executed = true;
            a.evidence.push(`not answered per the service log; the only unreachable address(es) and the result shows ${cfs} connection failure(s)`);
          } else {
            a.why = "not answered per the service log; the failure text cannot be attributed to this request";
            a.evidence.push("service log");
          }
        }
      } else {
        for (const a of open) {
          a.why = `${list.length} requests in one command; ${rows.length} answered per the service log; outcomes cannot be separated${unknownReach.length ? " (reachability of some addresses unknown)" : ""}`;
        }
      }
    }
    for (const a of list) {
      if (a.ok === null && !a.why) a.why = `${list.length} requests in one command; outcome not separable`;
      if (a.conditional && a.executed === null) a.why += "; execution conditional and unconfirmed";
      if (a.background && a.executed === null) a.why += "; backgrounded";
    }
  }

  const out = perCall.flatMap(({ list }) => list).sort((a, b) => a.message_index - b.message_index || a.call_id.localeCompare(b.call_id) || a.request_index - b.request_index);
  Object.defineProperty(out, "problems", { value: problems, enumerable: false });
  return out;
}

/**
 * The verdict.
 *
 * The last attempt decides. Everything before it is history: a run that failed
 * and retried succeeded, and a run that succeeded and then broke it did not.
 * "Last" is a fact about execution, not about the text: requests in one
 * command run in shell order only when nothing backgrounds or loops them, and
 * calls issued together in one model message have no last one — then only
 * agreement among them decides.
 */
export function verify(captureEvents, opts = {}) {
  const tried = attempts(captureEvents, opts);
  const problems = tried.problems ?? [];
  const base = { attempts: tried, problems, acceptance_version: ACCEPTANCE_VERSION };

  if (tried.length === 0) {
    return {
      verdict: ERROR,
      reason: `no request whose query is the task marker (${TASK_MARKER}) — the task was `
        + "never carried out, which is not the same as carrying it out and failing",
      ...base,
    };
  }

  const lastMsg = Math.max(...tried.map((a) => a.message_index));
  const group = tried.filter((a) => a.message_index === lastMsg);
  const earlier = tried.filter((a) => a.message_index !== lastMsg);
  const tally = (list) => ({ ok: list.filter((a) => a.ok === true).length, failed: list.filter((a) => a.ok === false).length, unknown: list.filter((a) => a.ok === null).length });
  const final_batch = tally(group);
  const note = (last) => earlier.length === 0
    ? ""
    : last.ok
      ? ` after ${earlier.filter((a) => a.ok === false).length} earlier failure(s)`
      : ` despite ${earlier.filter((a) => a.ok === true).length} earlier success(es)`;

  const oneCall = new Set(group.map((a) => a.call_id)).size === 1;
  const ordered = oneCall && group.every((a) => a.sequential);
  if (ordered) {
    const last = group[group.length - 1];
    if (last.ok === null) {
      return { verdict: ERROR, reason: `the final attempt's outcome could not be read (${last.why}); an unreadable result is not a failure and must not be scored as one`, final_batch, ...base };
    }
    return {
      verdict: last.ok ? PASS : FAIL,
      reason: `the final attempt at ${last.host}:${last.port} ${last.ok ? "succeeded" : "failed"} (${last.why})${note(last)}`,
      final_batch, ...base,
    };
  }

  // no single last attempt: several calls issued together, or requests with no order
  if (final_batch.unknown === 0 && (final_batch.failed === 0 || final_batch.ok === 0)) {
    const ok = final_batch.failed === 0;
    const how = oneCall ? "with no execution order" : "issued together in one model message";
    return {
      verdict: ok ? PASS : FAIL,
      reason: `the final ${group.length} requests (${how}) all ${ok ? "succeeded" : "failed"} (${[...new Set(group.map((a) => `${a.host}:${a.port} ${a.why}`))].join("; ")})${note(group[group.length - 1])}`,
      final_batch, ...base,
    };
  }
  return {
    verdict: ERROR,
    reason: `the final ${group.length} requests were ${oneCall ? "run with no execution order (background or loop)" : "issued together in one model message (concurrent tool calls)"}: `
      + `${final_batch.ok} ok, ${final_batch.failed} failed, ${final_batch.unknown} unknown — there is no single last attempt, so the rule cannot be applied`
      + (group.some((a) => a.ok === null) ? `; unknown: ${group.filter((a) => a.ok === null).map((a) => `${a.host}:${a.port} (${a.why})`).join("; ")}` : ""),
    final_batch, ...base,
  };
}

export function render({ verdict, reason, attempts: tried, problems = [] }) {
  const lines = [`${verdict}  ${reason}`, ""];
  if (tried.length === 0) {
    lines.push(`  no request whose query is the task marker (${TASK_MARKER}) appears in the capture`);
  } else {
    lines.push(`  ${tried.length} attempt(s) at the target:`);
    for (const a of tried) {
      const mark = a.ok === true ? "ok  " : a.ok === false ? "fail" : "?   ";
      lines.push(`    ${mark} msg[${a.message_index}] ${a.call_id.slice(-8)}#${a.request_index} ${a.host}:${a.port}  ${a.why}${a.evidence?.length ? `  [${a.evidence.join("; ")}]` : ""}`);
    }
  }
  if (problems.length) { lines.push("", `  ${problems.length} request(s) could not be read as attempts:`); for (const p of problems) lines.push(`    - ${p}`); }
  return lines.join("\n");
}

// ── CLI ───────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const capturePaths = args.filter((a) => !a.startsWith("--"));
  if (capturePaths.length === 0) {
    console.error("usage: node verify.mjs <capture.jsonl ...> [--json] [--service-log=F] [--reachability=F]");
    process.exit(2);
  }
  const opt = (name) => (args.find((a) => a.startsWith(`--${name}=`)) ?? "").slice(name.length + 3) || null;
  const serviceLog = opt("service-log");
  const reachPath = opt("reachability");
  const opts = {
    serviceRows: serviceLog ? parseJsonl(readFileSync(serviceLog, "utf8")) : [],
    reachability: reachPath ? JSON.parse(readFileSync(reachPath, "utf8")) : null,
  };
  const result = verify(capturePaths.flatMap((p) => parseJsonl(readFileSync(p, "utf8"))), opts);
  console.log(args.includes("--json") ? JSON.stringify(result, null, 2) : render(result));
  process.exit(result.verdict === PASS ? 0 : result.verdict === FAIL ? 1 : 2);
}
