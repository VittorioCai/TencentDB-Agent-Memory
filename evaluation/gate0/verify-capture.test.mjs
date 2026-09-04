import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVerdict,
  channelForCommand,
  classifyFetch,
  detectAssetBlocks,
  detectReflectionLeak,
  extractSystemText,
  pairToolCalls,
  parseBashToolResult,
  parseCapture,
  renderReport,
  summarizeBridgeRows,
} from "./verify-capture.mjs";

/** Build an http.request capture event around a request body. */
function requestEvent(body, summary = {}) {
  return {
    schemaVersion: "gate0-probe-v1",
    event: "http.request",
    requestId: "req-1",
    method: "POST",
    path: "/chat/completions",
    body: { bytes: 1, truncated: false, json: body },
    summary: { toolUseCount: 0, toolResultCount: 0, ...summary },
  };
}

/** A CodeBuddy Bash tool result, in the exact shape both captures contain. */
function bashResult({ command, stdout = "(empty)", stderr = "(empty)", exitCode = 0 }) {
  return `Command: ${command}\nStdout: ${stdout}\nStderr: ${stderr}\nExit Code: ${exitCode}\nSignal: (none)`;
}

const SKILL_SEARCH = "curl -sfk -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/search "
  + "-H 'content-type: application/json' -d '{\"query\":\"部署\"}'";

/** One OpenAI-shaped call/result pair. */
function callPair(id, command, result) {
  return [
    { role: "assistant", tool_calls: [{ id, function: { name: "Bash", arguments: JSON.stringify({ command }) } }] },
    { role: "tool", tool_call_id: id, content: result },
  ];
}

test("extracts the system prompt from OpenAI and Anthropic shapes", () => {
  assert.equal(
    extractSystemText({ messages: [{ role: "system", content: "<skill_tools>x</skill_tools>" }] }),
    "<skill_tools>x</skill_tools>",
  );
  assert.equal(extractSystemText({ system: "<tdai_memory_tools>y" }), "<tdai_memory_tools>y");
  assert.equal(extractSystemText({ messages: [{ role: "user", content: "hi" }] }), "");
});

test("detects injected asset blocks and asset-reflection leakage", () => {
  const systemText = "<skill_tools>a</skill_tools>\n<knowledge_tools>b</knowledge_tools>";
  assert.deepEqual(detectAssetBlocks(systemText).sort(), ["knowledge_tools", "skill_tools"]);
  assert.equal(detectReflectionLeak(systemText), false);
  assert.equal(detectReflectionLeak(`${systemText}\n<asset_reflection>`), true);
});

test("parses a Bash result into command, stdout, stderr and exit code", () => {
  const parsed = parseBashToolResult(bashResult({
    command: SKILL_SEARCH,
    stdout: '{"code":0,"message":"ok","data":{"items":[]}}',
  }));

  assert.match(parsed.command, /skill-bridge/);
  assert.equal(parsed.stdout, '{"code":0,"message":"ok","data":{"items":[]}}');
  assert.equal(parsed.stderr, "");
  assert.equal(parsed.exitCode, 0);
});

test("stdout carrying its own section-header lines does not break the split", () => {
  // Real asset content is markdown and may contain a line starting with `Command:`.
  const parsed = parseBashToolResult(bashResult({
    command: SKILL_SEARCH,
    stdout: '{"content":"Signal: none\\nCommand: run the migration\\nStderr: check it"}',
    exitCode: 0,
  }));

  assert.match(parsed.command, /^curl/);
  assert.match(parsed.stdout, /run the migration/);
  assert.equal(parsed.exitCode, 0);
  assert.equal(classifyFetch(parsed).ok, true);
});

test("non-Bash tool results are not parsed and never count as a fetch", () => {
  assert.equal(parseBashToolResult('["src/a.ts:1:skill-bridge"]'), null);
  assert.equal(parseBashToolResult("   1→const x = 1;"), null);
  assert.equal(classifyFetch(null).ok, false);
});

test("a connection timeout is a failure even though the command echo looks right", () => {
  // The exact regression: exit 28 after 75 s used to read as a successful fetch,
  // because the echoed `Command:` line contains the bridge URL.
  const outcome = classifyFetch(parseBashToolResult(bashResult({
    command: "curl -sSk -X POST http://172.21.0.4:8096/skill-bridge/v3/tools/list -d '{}'",
    stdout: "(empty)",
    stderr: "curl: (28) Failed to connect to 172.21.0.4 port 8096 after 75002 ms: Couldn't connect to server",
    exitCode: 28,
  })));

  assert.equal(outcome.ok, false);
  assert.match(outcome.reason, /curl \(28\)/);
});

test("an application-level error body is a failure despite exit 0", () => {
  const outcome = classifyFetch(parseBashToolResult(bashResult({
    command: SKILL_SEARCH,
    stdout: '{"code":40001,"message":"session not initialized"}',
    exitCode: 0,
  })));

  assert.equal(outcome.ok, false);
  assert.match(outcome.reason, /code=40001/);
});

test("channels are selected by URL, so prose mentioning an endpoint selects nothing", () => {
  assert.equal(channelForCommand("curl http://127.0.0.1:8096/skill-bridge/v3/skill/search"), "skill");
  assert.equal(channelForCommand("curl http://127.0.0.1:8096/memory-bridge/v3/atomic/search"), "tdaiMemory");
  assert.equal(channelForCommand("curl http://127.0.0.1:8424/v3/tools/list"), "knowledge");

  assert.equal(channelForCommand("先查记忆库（memory-bridge HTTP API）"), null);
  assert.equal(channelForCommand("tools/list / tools/call ... knowledge_id 必填"), null);
});

test("tool results are paired back to the call that issued them", () => {
  const pairs = pairToolCalls({
    messages: [
      ...callPair("call_1", SKILL_SEARCH, bashResult({ command: SKILL_SEARCH, stdout: '{"code":0}' })),
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "tu_1", name: "Grep", input: { pattern: "skill-bridge" } }],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: "clickhouse.ts: skill-bridge" }] },
    ],
  });

  assert.equal(pairs.length, 2);
  assert.match(pairs.find((pair) => pair.id === "call_1").command, /skill-bridge/);
  assert.equal(channelForCommand(pairs.find((pair) => pair.id === "tu_1").command), null);
});

test("a Grep result quoting this file's own pattern no longer passes a channel", () => {
  // The third false positive: the verifier passed because the model grepped for
  // the verifier, and the source line it printed matched the verifier's regex.
  const verdict = buildVerdict([
    requestEvent({
      messages: [
        { role: "system", content: "<knowledge_tools>" },
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "tu_1", name: "Grep", input: { pattern: "tools/list" } }],
        },
        {
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: "tu_1",
            content: 'verify-capture.mjs:24: pattern: /tools\\/(?:list|call)|knowledge_id/i',
          }],
        },
      ],
    }),
  ]);

  const row = verdict.matrix.find((entry) => entry.row === "Knowledge via Bash curl");
  assert.equal(row.pass, false);
  assert.match(row.detail, /never exercised/);
});

test("an asset whose own text discusses the endpoints does not pass a channel", () => {
  // The second false positive: the skill body said "先查记忆库（memory-bridge HTTP API）".
  const verdict = buildVerdict([
    requestEvent({
      messages: [
        { role: "system", content: "<tdai_memory_tools>" },
        ...callPair("call_1", SKILL_SEARCH, bashResult({
          command: SKILL_SEARCH,
          stdout: '{"code":0,"data":{"content":"先查记忆库（memory-bridge HTTP API），再查 tools/list"}}',
        })),
      ],
    }),
  ]);

  assert.equal(verdict.matrix.find((entry) => entry.row === "TDAI memory via Bash curl").pass, false);
  assert.equal(verdict.matrix.find((entry) => entry.row === "Knowledge via Bash curl").pass, false);
  assert.equal(verdict.matrix.find((entry) => entry.row === "Skill via Bash curl").pass, true);
});

test("a curl that is issued but times out counts as intent, not fetched", () => {
  const command = "curl -sSk http://172.21.0.4:8096/memory-bridge/v3/atomic/search";
  const verdict = buildVerdict([
    requestEvent({
      messages: [
        { role: "system", content: "<tdai_memory_tools>" },
        ...callPair("call_1", command, bashResult({
          command,
          stderr: "curl: (28) Failed to connect to 172.21.0.4 port 8096 after 75002 ms",
          exitCode: 28,
        })),
      ],
    }),
  ]);

  const row = verdict.matrix.find((entry) => entry.row === "TDAI memory via Bash curl");
  assert.equal(row.pass, false);
  assert.match(row.detail, /curl issued but never succeeded/);
  assert.equal(verdict.schemaFreezeAllowed, false);
});

test("a command the harness refused is distinguished from a command that failed", () => {
  const denied = "Error: Permission to use Bash has been denied because this tool requires approval "
    + "but permission prompts are not available in non-interactive mode.";

  assert.match(classifyFetch(parseBashToolResult(denied), denied).reason, /blocked by the harness/);
  assert.match(classifyFetch(parseBashToolResult("[]"), "[]").reason, /not a Bash command result/);
});

test("every distinct failure reason is reported, not just the first", () => {
  const denied = "Error: Permission to use Bash has been denied because this tool requires approval.";
  const timeout = "curl -sSk http://172.21.0.4:8096/skill-bridge/v3/skill/search";

  const verdict = buildVerdict([
    requestEvent({
      messages: [
        { role: "system", content: "<skill_tools>" },
        ...callPair("call_1", SKILL_SEARCH, denied),
        ...callPair("call_2", timeout, bashResult({
          command: timeout,
          stderr: "curl: (28) Failed to connect to 172.21.0.4 port 8096 after 75002 ms",
          exitCode: 28,
        })),
      ],
    }),
  ]);

  const row = verdict.matrix.find((entry) => entry.row === "Skill via Bash curl");
  assert.equal(row.pass, false);
  assert.match(row.detail, /blocked by the harness/);
  assert.match(row.detail, /curl \(28\)/);
});

test("checks that had nothing to run against report n/a, never PASS", () => {
  const verdict = buildVerdict([requestEvent({ messages: [{ role: "system", content: "<skill_tools>" }] })]);

  for (const id of ["evidence-source", "wire-bridge-agreement"]) {
    const check = verdict.checks.find((entry) => entry.id === id);
    assert.equal(check.status, "n/a");
    assert.equal(check.pass, false);
  }
  assert.equal(verdict.schemaFreezeAllowed, false);
  assert.match(renderReport(verdict), /\| wire-bridge-agreement \| n\/a \|/);
});

test("summarizes tool_call_logs rows by bridge source", () => {
  const { bySource, modelIntents } = summarizeBridgeRows([
    { kind: "model_intent", initiated_tool: "Bash", upstream_status: 0 },
    { kind: "bridge_call", bridge_source: "skill-bridge", executed_endpoint: "search", upstream_status: 200, reject_reason: "" },
    { kind: "bridge_call", bridge_source: "skill-bridge", executed_endpoint: "get-by-name", upstream_status: 200, reject_reason: "" },
    { kind: "bridge_call", bridge_source: "memory-bridge", executed_endpoint: "", upstream_status: 401, reject_reason: "session_not_initialized" },
  ]);

  assert.equal(modelIntents, 1);
  assert.equal(bySource.get("skill-bridge").ok, 2);
  assert.deepEqual([...bySource.get("skill-bridge").endpoints].sort(), ["get-by-name", "search"]);
  assert.equal(bySource.get("memory-bridge").ok, 0);
  assert.equal(bySource.get("memory-bridge").rejected, 1);
});

test("a rejected bridge_call is not a fetch even though a row exists", () => {
  const verdict = buildVerdict(
    [requestEvent({ messages: [{ role: "system", content: "<tdai_memory_tools>" }] })],
    [{ kind: "bridge_call", bridge_source: "memory-bridge", upstream_status: 401, reject_reason: "session_not_initialized" }],
  );

  const row = verdict.matrix.find((entry) => entry.row === "TDAI memory via Bash curl");
  assert.equal(row.pass, false);
  assert.equal(row.evidence, "bridge");
  assert.match(row.detail, /none 2xx/);
});

test("capture text alone cannot authorize a schema freeze for a bridge channel", () => {
  const verdict = buildVerdict([
    requestEvent(
      {
        messages: [
          { role: "system", content: "<skill_tools><tdai_memory_tools><knowledge_tools>" },
          ...callPair("call_1", SKILL_SEARCH, bashResult({ command: SKILL_SEARCH, stdout: '{"code":0}' })),
        ],
      },
      { toolUseCount: 1, toolResultCount: 1 },
    ),
  ]);

  const evidence = verdict.checks.find((entry) => entry.id === "evidence-source");
  assert.equal(evidence.pass, false);
  assert.match(evidence.detail, /no tool_call_logs supplied/);
  assert.equal(verdict.schemaFreezeAllowed, false);
});

test("a wire-level fetch with no matching bridge row is reported as an instrument fault", () => {
  const verdict = buildVerdict(
    [requestEvent({
      messages: [
        { role: "system", content: "<skill_tools>" },
        ...callPair("call_1", SKILL_SEARCH, bashResult({ command: SKILL_SEARCH, stdout: '{"code":0}' })),
      ],
    })],
    [{ kind: "bridge_call", bridge_source: "skill-bridge", upstream_status: 500, reject_reason: "" }],
  );

  const agreement = verdict.checks.find((entry) => entry.id === "wire-bridge-agreement");
  assert.equal(agreement.pass, false);
  assert.match(agreement.detail, /the capture judge is wrong/);
});

test("a bridge row the capture never saw is reported as a hole in the tap", () => {
  const verdict = buildVerdict(
    [requestEvent({ messages: [{ role: "system", content: "<skill_tools>" }] })],
    [{ kind: "bridge_call", bridge_source: "skill-bridge", executed_endpoint: "search", upstream_status: 200, reject_reason: "" }],
  );

  const agreement = verdict.checks.find((entry) => entry.id === "wire-bridge-agreement");
  assert.equal(agreement.pass, false);
  assert.match(agreement.detail, /the tap has a hole/);
});

test("a channel whose sink produced no rows is a gap, never bridge evidence", () => {
  const verdict = buildVerdict(
    [requestEvent({ messages: [{ role: "system", content: "<knowledge_tools>" }] })],
    [{ kind: "bridge_call", bridge_source: "skill-bridge", upstream_status: 200, reject_reason: "" }],
  );

  // Knowledge does have a sink (`knowledge-service`), but it emitted nothing here.
  // "Sink switched off" and "channel never called" are indistinguishable from the
  // verdict's side, so both are named rather than assumed benign.
  assert.equal(verdict.matrix.find((entry) => entry.row === "Knowledge via Bash curl").evidence, "wire");
  assert.deepEqual(
    verdict.gaps.map((gap) => gap.id).sort(),
    ["knowledge-observability", "tdaiMemory-observability"],
  );
  assert.match(verdict.gaps.find((gap) => gap.id === "knowledge-observability").detail, /knowledge-service/);
  assert.match(renderReport(verdict), /Known observability gaps/);
});

test("knowledge-service rows decide the knowledge channel at the bridge tier", () => {
  const verdict = buildVerdict(
    [requestEvent({ messages: [{ role: "system", content: "<knowledge_tools>" }] })],
    [{
      kind: "bridge_call",
      bridge_source: "knowledge-service",
      executed_endpoint: "tools/call/wiki_search",
      upstream_status: 200,
      reject_reason: "",
    }],
  );

  // The knowledge service bypasses the proxy but keeps its own ClickHouse sink,
  // so bypassing the proxy is not the same as being unobservable.
  const row = verdict.matrix.find((entry) => entry.row === "Knowledge via Bash curl");
  assert.equal(row.evidence, "bridge");
  assert.equal(row.pass, true);
  assert.equal(verdict.gaps.some((gap) => gap.id === "knowledge-observability"), false);
});

test("asset-reflection on the wire fails P9 and blocks schema freeze", () => {
  const verdict = buildVerdict([
    requestEvent({ messages: [{ role: "system", content: "<skill_tools><asset_reflection>" }] }),
  ]);

  const p9 = verdict.checks.find((entry) => entry.id === "P9");
  assert.equal(p9.pass, false);
  assert.match(p9.detail, /polluted/);
  assert.equal(verdict.schemaFreezeAllowed, false);
});

test("transport errors and truncated bodies fail capture integrity", () => {
  const truncated = requestEvent({ messages: [] });
  truncated.body.truncated = true;

  const verdict = buildVerdict([truncated, { event: "http.error", error: "boom" }]);
  const integrity = verdict.checks.find((entry) => entry.id === "capture-integrity");

  assert.equal(integrity.pass, false);
  assert.match(integrity.detail, /truncated bodies=1/);
  assert.match(integrity.detail, /transport errors=1/);
});

test("three bridge-backed channels complete observability", () => {
  const knowledge = "curl -sfk -X POST http://127.0.0.1:8424/v3/tools/list -d '{\"knowledge_id\":\"kn-1\"}'";
  const memory = "curl -sfk -X POST http://127.0.0.1:8096/memory-bridge/v3/atomic/search -d '{}'";

  const verdict = buildVerdict(
    [
      requestEvent(
        {
          messages: [
            { role: "system", content: "<skill_tools><tdai_memory_tools><knowledge_tools>" },
            ...callPair("call_1", SKILL_SEARCH, bashResult({ command: SKILL_SEARCH, stdout: '{"code":0}' })),
            ...callPair("call_2", memory, bashResult({ command: memory, stdout: '{"code":0,"data":{}}' })),
            ...callPair("call_3", knowledge, bashResult({ command: knowledge, stdout: '{"tools":[]}' })),
          ],
        },
        { toolUseCount: 3, toolResultCount: 3 },
      ),
      { event: "http.response", status: 200 },
    ],
    [
      { kind: "model_intent", initiated_tool: "Bash", upstream_status: 0 },
      { kind: "bridge_call", bridge_source: "skill-bridge", executed_endpoint: "search", upstream_status: 200, reject_reason: "" },
      { kind: "bridge_call", bridge_source: "memory-bridge", executed_endpoint: "atomic/search", upstream_status: 200, reject_reason: "" },
      { kind: "bridge_call", bridge_source: "knowledge-service", executed_endpoint: "tools/call/wiki_search", upstream_status: 200, reject_reason: "" },
    ],
  );

  assert.equal(verdict.matrixComplete, true);
  assert.equal(verdict.schemaFreezeAllowed, true);
  assert.deepEqual(verdict.gaps, []);

  const report = renderReport(verdict);
  assert.match(report, /observability complete/);
  // The verdict must not claim the schema is ready: this gate checks observability,
  // not the provenance field set that a freeze also requires.
  assert.match(report, /provenance fields/);
  assert.match(report, /tool_call_logs/);
  assert.match(report, /model_intent rows: 1/);
});

test("a wire-only knowledge fetch no longer authorizes a freeze", () => {
  const knowledge = "curl -sfk -X POST http://127.0.0.1:8424/v3/tools/list -d '{\"knowledge_id\":\"kn-1\"}'";
  const memory = "curl -sfk -X POST http://127.0.0.1:8096/memory-bridge/v3/atomic/search -d '{}'";

  // Same run as above with the knowledge sink switched off. Before the knowledge
  // service had a sink this was the best obtainable evidence and was allowed to
  // freeze the schema; now it is capture text deciding a channel that can do better.
  const verdict = buildVerdict(
    [
      requestEvent(
        {
          messages: [
            { role: "system", content: "<skill_tools><tdai_memory_tools><knowledge_tools>" },
            ...callPair("call_1", SKILL_SEARCH, bashResult({ command: SKILL_SEARCH, stdout: '{"code":0}' })),
            ...callPair("call_2", memory, bashResult({ command: memory, stdout: '{"code":0,"data":{}}' })),
            ...callPair("call_3", knowledge, bashResult({ command: knowledge, stdout: '{"tools":[]}' })),
          ],
        },
        { toolUseCount: 3, toolResultCount: 3 },
      ),
      { event: "http.response", status: 200 },
    ],
    [
      { kind: "bridge_call", bridge_source: "skill-bridge", executed_endpoint: "search", upstream_status: 200, reject_reason: "" },
      { kind: "bridge_call", bridge_source: "memory-bridge", executed_endpoint: "atomic/search", upstream_status: 200, reject_reason: "" },
    ],
  );

  assert.equal(verdict.schemaFreezeAllowed, false);
  const evidenceSource = verdict.checks.find((entry) => entry.id === "evidence-source");
  assert.equal(evidenceSource.status, "fail");
  assert.match(evidenceSource.detail, /Knowledge via Bash curl/);
});

test("parseCapture skips malformed lines instead of throwing", () => {
  const events = parseCapture('{"event":"http.request"}\nnot json\n\n{"event":"http.response"}');
  assert.deepEqual(events.map((event) => event.event), ["http.request", "http.response"]);
});
