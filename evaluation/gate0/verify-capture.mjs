import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Gate 0 capture verifier — turns the manual capture matrix in README.md into an
 * automatic verdict over a `gate0-*-capture.jsonl` produced by
 * `proxy-observability-probe.mjs`, optionally cross-checked against the proxy's
 * own `tool_call_logs` rows exported from ClickHouse.
 *
 * ## Why this file was rewritten
 *
 * The first version decided "channel X was fetched" by running a regex over the
 * concatenated text of every tool result. Every one of its PASS verdicts was a
 * false positive, for three distinct reasons visible in the captures:
 *
 *   1. A CodeBuddy Bash result echoes the command back before its output
 *      (`Command: curl .../skill-bridge/...` then `Stdout: ...`). Matching the
 *      whole result therefore matches the *request*, not the response — so a
 *      curl that timed out after 75 s still read as "fetched".
 *   2. An asset whose own text discusses these endpoints matches too. The skill
 *      `agentmemory-knowledge-tools-bridge-routing` says "tools/list / tools/call
 *      ... knowledge_id 必填" in its description, which satisfied the knowledge
 *      pattern without a single knowledge call being made.
 *   3. A Grep result carrying this very file's source matched its own pattern
 *      literal. The verifier passed because the model grepped for the verifier.
 *
 * ## What replaced it
 *
 * Two evidence tiers, and the report always says which one decided a row:
 *
 *   - **bridge** (authoritative) — a service writes a `kind='bridge_call'` row to
 *     `tool_call_logs` with `upstream_status` / `elapsed_ms` / `reject_reason`.
 *     This is produced by the service itself, never passes through the model, and
 *     cannot be talked into existence. Two services write into the one table and
 *     are told apart by `source_tag`: the proxy (`skill-bridge`, `memory-bridge`)
 *     and the knowledge service (`knowledge-service`). Knowledge calls bypass the
 *     proxy entirely — they go straight to port 8424 — but the knowledge service
 *     has its own ClickHouse sink, off by default via
 *     `KNOWLEDGE_CLICKHOUSE_ENABLED`. Bypassing the proxy is therefore not the
 *     same as being unobservable.
 *   - **wire** (weaker) — reconstructed from the capture by pairing each tool
 *     result back to the tool call that issued it via `tool_call_id`, deciding
 *     the channel from the *issued URL* only, and reading the outcome from the
 *     result's `Exit Code` / `Stderr` / `Stdout` sections rather than from the
 *     echoed command. A channel falls back to this tier whenever its sink
 *     produced no rows for the run.
 *
 * When both tiers are available they are compared. A disagreement fails the run:
 * a wire-level "fetched" with no matching 2xx bridge row means the wire judge is
 * lying again, and a bridge row the capture missed means the tap has a hole.
 * A falsely optimistic instrument is more dangerous than a pessimistic one.
 *
 * See the evidence model spec for the `fetched` state this approximates, and
 * the engineering log for how each false
 * positive was found.
 */

/**
 * Asset channels.
 *
 * `urlPattern` is matched against the *issued command* and must look like a URL,
 * so prose that merely mentions an endpoint cannot select a channel.
 * `bridgeSource` is the `tool_call_logs.bridge_source` value the owning service
 * writes for this channel, or `null` when the channel has no system-side sink at
 * all. `tier` is the best tier the channel can reach; a channel whose sink emitted
 * nothing for a run still falls back to `wire` and is reported as a gap.
 */
export const ASSET_CHANNELS = [
  {
    key: "skill",
    label: "Skill via Bash curl",
    tier: "bridge",
    bridgeSource: "skill-bridge",
    urlPattern: /https?:\/\/[^\s'"\\]*\/skill-bridge\//i,
  },
  {
    key: "tdaiMemory",
    label: "TDAI memory via Bash curl",
    tier: "bridge",
    bridgeSource: "memory-bridge",
    urlPattern: /https?:\/\/[^\s'"\\]*\/memory-bridge\//i,
  },
  {
    key: "knowledge",
    label: "Knowledge via Bash curl",
    tier: "bridge",
    bridgeSource: "knowledge-service",
    urlPattern: /https?:\/\/[^\s'"\\]*\/tools\/(?:list|call)\b/i,
  },
];

/** Asset tool blocks injected into the system prompt. */
export const ASSET_BLOCKS = ["skill_tools", "tdai_memory_tools", "knowledge_tools", "available_skills"];

function textOf(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/** Collect the system prompt text from either OpenAI or Anthropic shaped bodies. */
export function extractSystemText(body) {
  const parts = [];
  if (typeof body?.system === "string") parts.push(body.system);
  else if (Array.isArray(body?.system)) parts.push(textOf(body.system));
  for (const message of Array.isArray(body?.messages) ? body.messages : []) {
    if (message?.role === "system") parts.push(textOf(message.content));
  }
  return parts.join("\n");
}

/**
 * Split a CodeBuddy Bash tool result into its sections.
 *
 * The shape is stable across both captures:
 *
 *   Command: curl -sfk -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/search ...
 *   Stdout: {"code":0,...}
 *   Stderr: (empty)
 *   Exit Code: 0
 *   Signal: (none)
 *
 * Boundaries are found from the outside in rather than by scanning for section
 * headers line by line, because `Stdout` carries arbitrary asset content that may
 * itself contain a line starting with `Command:` or `Signal:`.
 *
 * Returns `null` for anything that is not a Bash result (Grep output, file reads,
 * plain text), which is what keeps unrelated tool results out of the judgment.
 */
export function parseBashToolResult(text) {
  if (typeof text !== "string" || !text.startsWith("Command:")) return null;

  let exitCode = null;
  let tailStart = text.length;
  for (const match of text.matchAll(/\nExit Code: (-?\d+)(?:\n|$)/g)) {
    exitCode = Number.parseInt(match[1], 10);
    tailStart = match.index;
  }

  const stdoutAt = text.indexOf("\nStdout:");
  const stderrAt = text.lastIndexOf("\nStderr:", tailStart);
  const hasStderr = stderrAt >= 0 && stderrAt > stdoutAt;

  const commandEnd = stdoutAt >= 0 ? stdoutAt : hasStderr ? stderrAt : tailStart;
  const stdoutEnd = hasStderr ? stderrAt : tailStart;

  const clean = (value) => {
    const trimmed = value.trim();
    return trimmed === "(empty)" ? "" : trimmed;
  };

  return {
    command: text.slice("Command:".length, commandEnd).trim(),
    stdout: stdoutAt >= 0 ? clean(text.slice(stdoutAt + "\nStdout:".length, stdoutEnd)) : "",
    stderr: hasStderr ? clean(text.slice(stderrAt + "\nStderr:".length, tailStart)) : "",
    exitCode: Number.isNaN(exitCode) ? null : exitCode,
  };
}

/**
 * Decide whether a parsed Bash result represents a successful asset fetch.
 *
 * Judged only on the response side: process exit status, curl's own error line,
 * and the bridge's `code` field. The echoed command is never consulted.
 */
export function classifyFetch(result, raw = "") {
  if (!result) {
    // The command never ran: the harness refused the tool before the shell saw it.
    // Distinct from a timeout, and the failure mode behind the very first Gate 0
    // run, where every asset curl was denied in non-interactive mode.
    if (/^Error: Permission to use (\w+) has been denied/.test(raw)) {
      return { ok: false, reason: "tool blocked by the harness before it ran" };
    }
    return { ok: false, reason: "not a Bash command result" };
  }

  const curlError = /curl: \((\d+)\)\s*([^\n]*)/.exec(result.stderr);
  if (curlError) {
    return { ok: false, reason: `curl (${curlError[1]}) ${curlError[2]}`.trim() };
  }
  if (result.exitCode !== null && result.exitCode !== 0) {
    return { ok: false, reason: `command exited ${result.exitCode}` };
  }
  if (result.stdout.length === 0) {
    return { ok: false, reason: "exit 0 but no response body" };
  }

  const code = /"code"\s*:\s*(-?\d+)/.exec(result.stdout);
  if (code && code[1] !== "0") {
    return { ok: false, reason: `bridge replied code=${code[1]}` };
  }
  return { ok: true, reason: code ? "exit 0, body code=0" : "exit 0, non-empty body" };
}

/** Which channel an issued command targets, decided from its URL. */
export function channelForCommand(command) {
  if (typeof command !== "string") return null;
  for (const channel of ASSET_CHANNELS) {
    if (channel.urlPattern.test(command)) return channel.key;
  }
  return null;
}

/**
 * Pair every tool result in a request body back to the call that issued it.
 *
 * Handles the OpenAI shape (`tool_calls[].id` ↔ `role:"tool"` + `tool_call_id`)
 * and the Anthropic shape (`tool_use.id` ↔ `tool_result.tool_use_id`). The pairing
 * key is what makes the judgment sound: an unrelated Grep result can no longer
 * satisfy a bridge channel, because it is not attached to a call that issued a
 * bridge URL.
 */
export function pairToolCalls(body) {
  const issued = new Map();
  const results = [];

  for (const message of Array.isArray(body?.messages) ? body.messages : []) {
    for (const call of Array.isArray(message?.tool_calls) ? message.tool_calls : []) {
      if (call?.id) issued.set(call.id, textOf(call?.function?.arguments));
    }
    if (message?.role === "tool" && message?.tool_call_id) {
      results.push({ id: message.tool_call_id, result: textOf(message?.content) });
    }

    const content = Array.isArray(message?.content) ? message.content : [];
    for (const block of content) {
      if (block?.type === "tool_use" && block?.id) issued.set(block.id, textOf(block?.input));
      else if (block?.type === "tool_result" && block?.tool_use_id) {
        results.push({ id: block.tool_use_id, result: textOf(block?.content) });
      }
    }
  }

  return results.map((entry) => ({ ...entry, command: issued.get(entry.id) ?? null }));
}

/** Which asset tool blocks are present in a system prompt. */
export function detectAssetBlocks(systemText) {
  return ASSET_BLOCKS.filter((name) => systemText.includes(`<${name}>`));
}

/**
 * P9 — asset-reflection must never reach the wire during measured runs: it is a
 * cacheStrategy=none system suffix, so emitting it shifts the KV-cache prefix and
 * pollutes token/cost/latency metrics (see the evaluation protocol).
 */
export function detectReflectionLeak(systemText) {
  return systemText.includes("<asset_reflection>");
}

/**
 * Reduce `tool_call_logs` rows (ClickHouse `FORMAT JSONEachRow`) into per-source
 * bridge-call outcomes.
 *
 * A row counts as a successful fetch only when the proxy actually reached the
 * upstream: `reject_reason` empty (a non-empty one means the proxy early-returned
 * and `upstream_status` holds the rejection status it sent back to the client)
 * and `upstream_status` in the 2xx range.
 */
export function summarizeBridgeRows(rows) {
  const bySource = new Map();
  let modelIntents = 0;

  for (const row of Array.isArray(rows) ? rows : []) {
    if (row?.kind === "model_intent") {
      modelIntents += 1;
      continue;
    }
    if (row?.kind !== "bridge_call") continue;

    const source = String(row.bridge_source ?? "");
    const status = Number(row.upstream_status ?? 0);
    const rejected = String(row.reject_reason ?? "").length > 0;

    const entry = bySource.get(source)
      ?? { calls: 0, ok: 0, rejected: 0, failed: 0, endpoints: new Set(), statuses: new Set() };
    entry.calls += 1;
    entry.statuses.add(status);
    if (rejected) entry.rejected += 1;
    else if (status >= 200 && status < 300) {
      entry.ok += 1;
      entry.endpoints.add(String(row.executed_endpoint ?? "") || "?");
    } else entry.failed += 1;
    bySource.set(source, entry);
  }

  return { bySource, modelIntents };
}

/**
 * Reduce capture events — and, when available, proxy-side `tool_call_logs` rows —
 * into a Gate 0 verdict.
 *
 * @param {object[]} events capture events from the probe
 * @param {object[]|null} toolCallRows `tool_call_logs` rows, or null when the
 *   proxy's ClickHouse sink was off for this run
 */
export function buildVerdict(events, toolCallRows = null) {
  const requests = events.filter((event) => event?.event === "http.request");
  const responses = events.filter((event) => event?.event === "http.response");
  const errors = events.filter((event) => event?.event === "http.error");

  const channels = Object.fromEntries(
    ASSET_CHANNELS.map((channel) => [
      channel.key,
      { ...channel, issued: false, wireFetched: false, wireFailures: new Map() },
    ]),
  );
  const blocksSeen = new Set();
  const judged = new Set();
  let reflectionLeaks = 0;
  let completionTurns = 0;
  let nativeToolUse = 0;
  let nativeToolResult = 0;
  let truncatedBodies = 0;

  for (const request of requests) {
    const body = request?.body?.json;
    if (request?.body?.truncated) truncatedBodies += 1;
    if (!body || typeof body !== "object") continue;

    if (Array.isArray(body.messages)) completionTurns += 1;

    const systemText = extractSystemText(body);
    for (const name of detectAssetBlocks(systemText)) blocksSeen.add(name);
    if (detectReflectionLeak(systemText)) reflectionLeaks += 1;

    nativeToolUse += request?.summary?.toolUseCount ?? 0;
    nativeToolResult += request?.summary?.toolResultCount ?? 0;

    // The conversation is resent in full on every turn, so the same tool_call_id
    // recurs across requests. Judge each one once.
    for (const pair of pairToolCalls(body)) {
      if (judged.has(pair.id)) continue;
      judged.add(pair.id);

      const key = channelForCommand(pair.command);
      if (!key) continue;
      const channel = channels[key];
      channel.issued = true;

      const outcome = classifyFetch(parseBashToolResult(pair.result), pair.result);
      if (outcome.ok) channel.wireFetched = true;
      // Every distinct failure is kept: the first one is rarely the informative
      // one. A harness denial early in a run would otherwise hide the 75 s
      // connection timeout that came after it.
      else channel.wireFailures.set(outcome.reason, (channel.wireFailures.get(outcome.reason) ?? 0) + 1);
    }
  }

  const telemetry = toolCallRows ? summarizeBridgeRows(toolCallRows) : null;

  for (const channel of Object.values(channels)) {
    const stats = telemetry && channel.bridgeSource ? telemetry.bySource.get(channel.bridgeSource) : undefined;
    channel.bridge = stats ?? null;
    channel.bridgeFetched = Boolean(stats && stats.ok > 0);

    if (channel.bridge) {
      channel.evidence = "bridge";
      channel.pass = channel.bridgeFetched;
    } else {
      channel.evidence = "wire";
      channel.pass = channel.wireFetched;
    }
  }

  const describe = (channel) => {
    if (channel.evidence === "bridge") {
      const { ok, calls, rejected, failed, endpoints } = channel.bridge;
      return ok > 0
        ? `tool_call_logs: ${ok}/${calls} bridge_call 2xx (${[...endpoints].sort().join(", ")})`
        : `tool_call_logs: ${calls} bridge_call, none 2xx (rejected=${rejected}, failed=${failed})`;
    }
    if (channel.wireFetched) return "capture: curl exit 0 with a non-error body (wire-level `fetched`)";
    if (channel.issued) {
      const reasons = [...channel.wireFailures]
        .sort((a, b) => b[1] - a[1])
        .map(([reason, count]) => (count > 1 ? `${reason} (×${count})` : reason))
        .join("; ");
      return `capture: curl issued but never succeeded — ${reasons}`;
    }
    return "channel never exercised in this capture";
  };

  const matrix = [
    {
      row: "Normal CodeBuddy turn",
      pass: completionTurns > 0,
      detail: `${completionTurns} request(s) carrying a messages array`,
    },
    {
      row: "Native CodeBuddy tool",
      pass: nativeToolUse > 0 && nativeToolResult > 0,
      detail: `tool_use=${nativeToolUse}, tool_result=${nativeToolResult}`,
    },
    ...Object.values(channels).map((channel) => ({
      row: channel.label,
      pass: channel.pass,
      evidence: channel.evidence,
      detail: describe(channel),
    })),
  ];

  // Wire and bridge must tell the same story. Either direction of disagreement is
  // an instrument fault, not a data point.
  const disagreements = Object.values(channels)
    .filter((channel) => channel.bridge)
    .flatMap((channel) => {
      if (channel.wireFetched && !channel.bridgeFetched) {
        return [`${channel.label}: capture claims fetched, no 2xx bridge_call row — the capture judge is wrong`];
      }
      if (!channel.wireFetched && channel.bridgeFetched) {
        return [`${channel.label}: ${channel.bridge.ok} 2xx bridge_call row(s) the capture never saw — the tap has a hole`];
      }
      return [];
    });

  // A bridge-tier channel passed on capture evidence alone. That is exactly the
  // judgment that produced three false positives, so it cannot authorize a freeze.
  const unbackedChannels = Object.values(channels)
    .filter((channel) => channel.tier === "bridge" && channel.pass && channel.evidence !== "bridge")
    .map((channel) => channel.label);

  const checks = [
    {
      id: "P9",
      pass: reflectionLeaks === 0,
      detail: reflectionLeaks === 0
        ? "no <asset_reflection> block on the wire"
        : `${reflectionLeaks} request(s) carried <asset_reflection> — cost metrics would be polluted`,
    },
    {
      id: "capture-integrity",
      pass: truncatedBodies === 0 && errors.length === 0,
      detail: `truncated bodies=${truncatedBodies}, transport errors=${errors.length}`,
    },
    {
      id: "asset-blocks-injected",
      pass: blocksSeen.size > 0,
      // Passing on one block out of four would hide the case this names: an
      // injector that degraded to nothing. `knowledge_tools` in particular is only
      // rendered for knowledge bound in meta and already `ready`, so a draft or
      // unbound resource leaves the model unable to discover the channel at all —
      // even while the channel itself is fully observable. Absent blocks are
      // reported rather than folded into the PASS.
      detail: blocksSeen.size > 0
        ? [...blocksSeen].sort().join(", ")
          + (blocksSeen.size < ASSET_BLOCKS.length
            ? ` (not injected: ${ASSET_BLOCKS.filter((name) => !blocksSeen.has(name)).sort().join(", ")})`
            : "")
        : "no asset tool block observed in any system prompt",
    },
    // These two are the point of the rewrite, so neither may report PASS when it
    // had nothing to check with. An unrun check that renders as PASS is the same
    // falsely-reassuring signal the regex judge used to emit.
    {
      id: "evidence-source",
      status: telemetry === null ? "n/a" : unbackedChannels.length === 0 ? "pass" : "fail",
      detail: telemetry === null
        ? "no tool_call_logs supplied — bridge channels cannot be established from capture text alone"
        : unbackedChannels.length === 0
          ? "every bridge channel decided by proxy-side tool_call_logs"
          : `decided by capture text alone: ${unbackedChannels.join("; ")}`,
    },
    {
      id: "wire-bridge-agreement",
      status: telemetry === null ? "n/a" : disagreements.length === 0 ? "pass" : "fail",
      detail: telemetry === null
        ? "not checked — needs tool_call_logs to compare against"
        : disagreements.length === 0
          ? "capture and tool_call_logs agree on every bridge channel"
          : disagreements.join(" | "),
    },
  ].map((check) => ({
    ...check,
    status: check.status ?? (check.pass ? "pass" : "fail"),
    pass: (check.status ?? (check.pass ? "pass" : "fail")) === "pass",
  }));

  // Reported, never silently passed: any channel that fell back to `wire` was
  // decided by the method this file exists to distrust. A null `bridgeSource` means
  // no sink exists; a non-null one with no rows means the sink was off or the
  // channel was never called. Those two are indistinguishable from here, so both
  // are named rather than assumed benign — the failure this gate guards against is
  // a run that renders "not checked" as "fine".
  const gaps = Object.values(channels)
    .filter((channel) => channel.evidence === "wire")
    .map((channel) => ({
      id: `${channel.key}-observability`,
      detail: channel.bridgeSource
        ? `${channel.label} produced no \`${channel.bridgeSource}\` rows in tool_call_logs — `
          + "its sink was off or the channel was never called, so this row rests on capture text alone"
        : `${channel.label} has no system-side sink at all, so this row rests on capture text alone`,
    }));

  const matrixComplete = matrix.every((entry) => entry.pass);
  // `n/a` blocks the freeze as firmly as `fail`: not knowing is not the same as
  // being fine, and this gate exists to stop the second kind of mistake.
  const checksPass = checks.every((entry) => entry.status === "pass");

  return {
    totals: { requests: requests.length, responses: responses.length, errors: errors.length },
    telemetry: telemetry
      ? {
        modelIntents: telemetry.modelIntents,
        bridges: Object.fromEntries(
          [...telemetry.bySource].map(([source, stats]) => [
            source,
            { ...stats, endpoints: [...stats.endpoints].sort(), statuses: [...stats.statuses].sort() },
          ]),
        ),
      }
      : null,
    matrix,
    checks,
    gaps,
    matrixComplete,
    schemaFreezeAllowed: matrixComplete && checksPass,
  };
}

/** Render a verdict as a Markdown report. */
export function renderReport(verdict) {
  const mark = (pass) => (pass ? "PASS" : "FAIL");
  const lines = [
    "# Gate 0 capture verdict",
    "",
    `requests=${verdict.totals.requests} responses=${verdict.totals.responses} errors=${verdict.totals.errors}`,
    "",
  ];

  if (verdict.telemetry) {
    lines.push(
      "## Proxy-side telemetry (tool_call_logs)",
      "",
      "| bridge_source | calls | 2xx | rejected | other | endpoints |",
      "|---|---|---|---|---|---|",
      ...Object.entries(verdict.telemetry.bridges).map(([source, stats]) =>
        `| ${source || "(empty)"} | ${stats.calls} | ${stats.ok} | ${stats.rejected} | ${stats.failed} | ${stats.endpoints.join(", ")} |`),
      "",
      `model_intent rows: ${verdict.telemetry.modelIntents}`,
      "",
    );
  } else {
    lines.push(
      "No tool_call_logs supplied — bridge channels fall back to capture text, which is",
      "not sufficient to freeze the schema. Export rows with `export-tool-call-logs.sh`.",
      "",
    );
  }

  lines.push(
    "## Capture matrix",
    "",
    "| Row | Result | Evidence | Detail |",
    "|---|---|---|---|",
    ...verdict.matrix.map((entry) =>
      `| ${entry.row} | ${mark(entry.pass)} | ${entry.evidence ?? "-"} | ${entry.detail} |`),
    "",
    "## Checks",
    "",
    "| Check | Result | Detail |",
    "|---|---|---|",
    ...verdict.checks.map((entry) =>
      `| ${entry.id} | ${entry.status === "n/a" ? "n/a" : mark(entry.pass)} | ${entry.detail} |`),
    "",
  );

  if (verdict.gaps.length > 0) {
    lines.push(
      "## Known observability gaps",
      "",
      ...verdict.gaps.map((gap) => `- **${gap.id}** — ${gap.detail}`),
      "",
    );
  }

  lines.push(
    // Scope note: this verifier decides observability only — whether each channel
    // can be seen at all, and by which tier. Freezing the evidence-event schema
    // additionally requires the producer/actor provenance field set
    // (see the evidence model spec), which no capture can
    // establish. Saying "schema may be frozen" here once overstated what was
    // checked; the gate now reports what it actually verified.
    verdict.schemaFreezeAllowed
      ? "Verdict: observability complete and checks clean. Schema freeze additionally "
        + "requires the provenance fields in 02-evidence-model.md section 2."
      : "Verdict: observability incomplete — not ready to freeze the evidence-event schema.",
  );

  return lines.join("\n");
}

/** Parse a JSONL file, skipping unparsable lines. */
export function parseCapture(text) {
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const file = resolve(process.argv[2] ?? "evaluation/gate0/artifacts/gate0-upstream-capture.jsonl");
  const logFile = process.argv[3] ?? process.env.GATE0_TOOL_CALL_LOG;

  const events = parseCapture(await readFile(file, "utf8"));
  const rows = logFile ? parseCapture(await readFile(resolve(logFile), "utf8")) : null;

  const verdict = buildVerdict(events, rows);
  process.stdout.write(`${renderReport(verdict)}\n`);
  process.exit(verdict.schemaFreezeAllowed ? 0 : 1);
}
