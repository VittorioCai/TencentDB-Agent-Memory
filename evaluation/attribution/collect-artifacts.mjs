/**
 * Artifact collection — the places where a discriminative token could land.
 *
 * A token found "somewhere in the run" cannot support a `used` claim. What is
 * needed is a specific operation: this tool call, at this point in the session,
 * with this result. So everything collected here carries three things:
 *
 *   message_index  where it sits in the session's message sequence. This is what
 *                  ordering is judged on, and it is not the same as time: a
 *                  model can emit several tool calls in one message, so two
 *                  calls share a timestamp while the second was written before
 *                  the first one's result existed. Using the timestamp there
 *                  reads "the content arrived at 10:01 and the call is stamped
 *                  10:01" as influence, when the model had not seen a thing.
 *   seq            position among this session's calls, for display.
 *   call_id      which result belongs to which call. A command and its output
 *                must stay attached: the command carries what was asked for and
 *                the output carries what came back, and the two answer different
 *                questions.
 *   locus        where to look to see it again — request id, message index,
 *                call id, or file and hunk. An event whose evidence cannot be
 *                reopened is an assertion, not a record.
 *
 * `occurred_at` is the timestamp of the earliest captured request that carried
 * the message. Messages accumulate across turns, so the last request holds them
 * all; the first one to contain a message is when it happened.
 *
 * A diff hunk has no position at all. A diff is the end state of a run, not an
 * event within it, so it gets `message_index: null` and `ordering:
 * "end_of_run"` — and "after everything" is *not* good enough to establish that
 * an asset was read first. A run that edits a file and then reads the asset
 * leaves the same diff as one that reads first and then edits. The judge
 * therefore refuses to promote on a diff hunk alone; the edit operation that
 * produced the change is what carries a position, and that is what gets judged.
 *
 * Usage:
 *   node evaluation/attribution/collect-artifacts.mjs <capture.jsonl ...> \
 *     [--task=<task.md>] [--diff=<file.diff>] [--pre=<path>=<file> ...] [--json]
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  normalizeSessionKey,
  parseJsonl,
  splitCommandAndOutput,
  commandEndpoint,
  isListingAction,
} from "../provenance/build-events.mjs";

/** Commands that run a check rather than change something. */
const TEST_COMMAND = /\b(npm|pnpm|yarn)\s+(run\s+)?test\b|\bnode\s+--test\b|\bpytest\b|\bgo\s+test\b|\bcargo\s+test\b|\bvitest\b|\bjest\b|verify[\w-]*\.sh\b/;

function textOf(content) {
  return typeof content === "string" ? content : JSON.stringify(content ?? "");
}

/** Tool results in one captured request, each with the message index it sat at. */
function toolResults(body) {
  const out = [];
  const msgs = Array.isArray(body?.messages) ? body.messages : [];
  msgs.forEach((message, index) => {
    if (message?.role === "tool") out.push({ index, text: textOf(message.content) });
    for (const block of Array.isArray(message?.content) ? message.content : []) {
      if (block?.type === "tool_result") out.push({ index, text: textOf(block.content) });
    }
  });
  return out;
}

/**
 * Walk one captured request's messages, emitting a record per tool call and per
 * tool result, in message order.
 */
function messagesOf(body) {
  const out = [];
  const msgs = Array.isArray(body?.messages) ? body.messages : [];
  msgs.forEach((message, index) => {
    if (Array.isArray(message?.tool_calls)) {
      for (const tc of message.tool_calls) {
        out.push({
          index,
          role: "call",
          call_id: String(tc?.id ?? ""),
          tool_name: String(tc?.function?.name ?? tc?.name ?? ""),
          text: String(tc?.function?.arguments ?? JSON.stringify(tc?.input ?? "")),
        });
      }
    }
    // Anthropic-shaped blocks carry tool_use / tool_result inside content.
    const blocks = Array.isArray(message?.content) ? message.content : [];
    for (const block of blocks) {
      if (block?.type === "tool_use") {
        out.push({
          index, role: "call",
          call_id: String(block.id ?? ""),
          tool_name: String(block.name ?? ""),
          text: JSON.stringify(block.input ?? ""),
        });
      } else if (block?.type === "tool_result") {
        out.push({
          index, role: "result",
          call_id: String(block.tool_use_id ?? ""),
          tool_name: "",
          text: textOf(block.content),
        });
      }
    }
    if (message?.role === "tool") {
      out.push({
        index, role: "result",
        call_id: String(message.tool_call_id ?? ""),
        tool_name: "",
        text: textOf(message.content),
      });
    }
  });
  return out;
}

/** Exit status and stderr, read out of a shell tool result envelope. */
export function outcomeOf(resultText) {
  const s = String(resultText ?? "");
  const code = /(?:^|\n)Exit code:\s*(\d+)/.exec(s);
  const stderr = /(?:^|\n)Stderr:\s*([\s\S]*)$/.exec(s);
  return {
    exit_code: code ? Number(code[1]) : null,
    stderr: stderr ? stderr[1].trim().slice(0, 400) : "",
  };
}

/**
 * Split a unified diff into hunks, each keeping the file and line range it
 * touches — "the token is in the diff" is not a location, "the token is in
 * src/proxy.ts lines 40-58" is.
 */
export function diffHunks(diffText) {
  const hunks = [];
  let file = "";
  let current = null;
  for (const line of String(diffText ?? "").split("\n")) {
    const plus = /^\+\+\+ [ab]\/(.+)$/.exec(line);
    if (plus) { file = plus[1]; current = null; continue; }
    const at = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (at) {
      current = {
        file,
        start: Number(at[1]),
        end: Number(at[1]) + (at[2] ? Number(at[2]) : 1) - 1,
        lines: [],
      };
      hunks.push(current);
      continue;
    }
    if (current && /^[+ -]/.test(line)) current.lines.push(line);
  }
  return hunks.map((h) => ({ ...h, text: h.lines.join("\n") }));
}

/**
 * Collect every operation in a run, ordered, with calls and results paired.
 *
 * Messages repeat across turns as the conversation grows. A call is recorded
 * once, at the turn it first appeared, so the sequence reflects when things
 * happened rather than how many times they were re-sent.
 */
export function collectArtifacts({ captureEvents = [], taskDescription = "", preChangeFiles = {}, diff = "" }) {
  const bySession = new Map();

  const requests = captureEvents
    .filter((e) => e?.event === "http.request" && Array.isArray(e?.body?.json?.messages))
    .sort((a, b) => String(a.timestamp ?? "").localeCompare(String(b.timestamp ?? "")));

  for (const event of requests) {
    const sessionKey = normalizeSessionKey(
      event?.headers?.["x-conversation-id"] ?? event?.headers?.["X-Conversation-Id"] ?? "",
    );
    if (!bySession.has(sessionKey)) bySession.set(sessionKey, { calls: new Map(), results: new Map() });
    const store = bySession.get(sessionKey);
    const requestId = String(event.requestId ?? "");
    const timestamp = String(event.timestamp ?? "");

    for (const m of messagesOf(event.body.json)) {
      // Key on the call id where there is one. Without it a message can still
      // be identified by where it sits, which is stable across turns because
      // messages are only ever appended.
      const key = m.call_id || `${m.role}@${m.index}`;
      const target = m.role === "call" ? store.calls : store.results;
      if (target.has(key)) continue; // already seen in an earlier turn
      target.set(key, {
        ...m,
        first_seen_at: timestamp,
        locus: `request(${requestId}):msg[${m.index}]${m.call_id ? `:${m.call_id}` : ""}`,
      });
    }
  }

  // What the model was *offered* without fetching: the body of every search /
  // list result. A discriminative token that appears in one of these reached
  // the model as a snippet, not through a full-content read — so a later use of
  // it cannot be told apart from having read the snippet. Kept with the message
  // index it arrived at, so the judge can screen only what preceded an
  // operation. Confirmed necessary by the real run: `47318` came back in 13
  // search snippets while `10.244.7.19` came back in none.
  const offeredBySession = new Map();
  for (const event of requests) {
    const sessionKey = normalizeSessionKey(
      event?.headers?.["x-conversation-id"] ?? event?.headers?.["X-Conversation-Id"] ?? "",
    );
    for (const { index, text } of toolResults(event.body.json)) {
      const { command, output } = splitCommandAndOutput(text);
      const endpoint = commandEndpoint(command);
      if (!endpoint || !isListingAction(endpoint) || !output) continue;
      if (!offeredBySession.has(sessionKey)) offeredBySession.set(sessionKey, new Map());
      const byIndex = offeredBySession.get(sessionKey);
      // First arrival of a given result is when it was offered.
      if (!byIndex.has(index)) byIndex.set(index, { message_index: index, endpoint, text: output });
    }
  }

  const sessions = [];
  for (const [sessionKey, store] of bySession) {
    const operations = [];
    const ordered = [...store.calls.values()].sort((a, b) => a.index - b.index);

    ordered.forEach((call, seq) => {
      const result = store.results.get(call.call_id) ?? null;
      const { command, output } = splitCommandAndOutput(result?.text ?? "");
      operations.push({
        seq,
        kind: TEST_COMMAND.test(call.text) ? "test_command" : "tool_call",
        // The position the model wrote this call at. Ordering is judged on it,
        // never on the timestamp — see the note at the top of this file.
        message_index: call.index,
        occurred_at: call.first_seen_at || null,
        ordering: "observed",
        call_id: call.call_id,
        tool_name: call.tool_name,
        locus: `${call.locus}:arguments`,
        // The arguments are where a token the model *acted on* appears — in the
        // mainline scenario the bridge address is inside the curl command here,
        // not in anything that came back.
        text: call.text,
        result: result
          ? {
              message_index: result.index,
              locus: result.locus,
              // Kept apart deliberately: the echoed command says what was asked
              // for and the output says what came back. Scanning them as one
              // blob is how a call that timed out with empty output still
              // matched every pattern in its own command.
              command_echo: command,
              output,
              ...outcomeOf(result.text),
            }
          : null,
      });
    });

    // A diff has no time of its own; it is what the run left behind.
    diffHunks(diff).forEach((h, i) => {
      operations.push({
        seq: operations.length + i,
        kind: "diff_hunk",
        // No position and no time. "After everything" cannot show the asset was
        // read before the edit, because a run that edited first and read after
        // leaves exactly this diff.
        message_index: null,
        occurred_at: null,
        ordering: "end_of_run",
        call_id: "",
        tool_name: "",
        locus: `diff:${h.file}:${h.start}-${h.end}`,
        text: h.text,
        result: null,
      });
    });

    sessions.push({
      session_key: sessionKey,
      task_description: taskDescription,
      pre_change_files: preChangeFiles,
      diff,
      offered_content: [...(offeredBySession.get(sessionKey)?.values() ?? [])]
        .sort((a, b) => a.message_index - b.message_index),
      operations,
      test_commands: operations.filter((o) => o.kind === "test_command").map((o) => o.locus),
      tool_call_args: operations.filter((o) => o.kind !== "diff_hunk").map((o) => o.text),
    });
  }
  return sessions;
}

export function renderArtifacts(sessions) {
  const lines = ["# Collected artifacts", ""];
  if (sessions.length === 0) {
    lines.push("No session in the capture carried a tool call. Nothing to attribute against —");
    lines.push("**not** an empty result meaning nothing was used.");
    return lines.join("\n");
  }
  for (const s of sessions) {
    lines.push(`## ${s.session_key || "(no conversation id)"}`, "");
    lines.push(`  ${s.operations.length} operation(s), ${s.test_commands.length} of them checks`);
    lines.push(`  task description: ${s.task_description ? `${s.task_description.length} chars` : "not supplied"}`);
    lines.push(`  pre-change files: ${Object.keys(s.pre_change_files).length}`);
    lines.push("");
    for (const op of s.operations.slice(0, 25)) {
      const when = op.message_index == null ? op.ordering : `msg[${op.message_index}]`;
      const outcome = op.result
        ? (op.result.exit_code === null ? "" : ` exit=${op.result.exit_code}`)
        : " (no result)";
      lines.push(`  [${String(op.seq).padStart(2)}] ${op.kind.padEnd(12)} ${when}  ${op.tool_name || "-"}${outcome}`);
      lines.push(`       ${op.locus}`);
    }
    if (s.operations.length > 25) lines.push(`  … ${s.operations.length - 25} more`);
    lines.push("");
  }
  return lines.join("\n");
}

// ── CLI ───────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const flag = (n) => args.filter((a) => a.startsWith(`--${n}=`)).map((a) => a.slice(n.length + 3));
  const capturePaths = args.filter((a) => !a.startsWith("--"));
  if (capturePaths.length === 0) {
    console.error("usage: node collect-artifacts.mjs <capture.jsonl ...> [--task=f] [--diff=f] [--pre=path=file] [--json]");
    process.exit(2);
  }

  const preChangeFiles = {};
  for (const spec of flag("pre")) {
    const at = spec.indexOf("=");
    if (at < 0) { console.error(`--pre expects <path>=<file>, got ${spec}`); process.exit(2); }
    preChangeFiles[spec.slice(0, at)] = readFileSync(spec.slice(at + 1), "utf8");
  }

  const sessions = collectArtifacts({
    captureEvents: capturePaths.flatMap((p) => parseJsonl(readFileSync(p, "utf8"))),
    taskDescription: flag("task").map((p) => readFileSync(p, "utf8")).join("\n"),
    diff: flag("diff").map((p) => readFileSync(p, "utf8")).join("\n"),
    preChangeFiles,
  });

  const outPath = "evaluation/attribution/artifacts/run-artifacts.json";
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(sessions, null, 2), "utf8");

  if (args.includes("--json")) console.log(JSON.stringify(sessions, null, 2));
  else console.log(renderArtifacts(sessions), `\nWritten to ${outPath}`);
}
