import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";

async function loadProbe() {
  return import("./proxy-observability-probe.mjs").catch(() => ({}));
}

test("redacts credentials while preserving observable payload structure", async () => {
  const { redactHeaders, sanitizePayload } = await loadProbe();

  assert.equal(typeof redactHeaders, "function");
  assert.equal(typeof sanitizePayload, "function");

  assert.deepEqual(
    redactHeaders({
      authorization: "Bearer sk-secret",
      "x-api-key": "sk-secret",
      "x-tdai-user-key": "opaque-user-key",
      "x-tdai-user-token": "opaque-user-token",
      "content-type": "application/json",
    }),
    {
      authorization: "[REDACTED]",
      "x-api-key": "[REDACTED]",
      "x-tdai-user-key": "[REDACTED]",
      "x-tdai-user-token": "[REDACTED]",
      "content-type": "application/json",
    },
  );

  assert.deepEqual(
    sanitizePayload({
      api_key: "sk-secret",
      nested: { token: "abc", message: "use Bearer sk-secret" },
    }),
    {
      api_key: "[REDACTED]",
      nested: { token: "[REDACTED]", message: "use Bearer [REDACTED]" },
    },
  );
});

test("summarizes native and Bash tool-result message shapes", async () => {
  const { summarizeJsonBody } = await loadProbe();

  assert.equal(typeof summarizeJsonBody, "function");

  const summary = summarizeJsonBody({
    model: "deepseek-v4-flash",
    messages: [
      {
        role: "assistant",
        content: [
          { type: "text", text: "checking" },
          { type: "tool_use", id: "tool-1", name: "Bash", input: { command: "curl ..." } },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "tool-1", content: "{\"code\":0}" }],
      },
      {
        role: "assistant",
        tool_calls: [{ id: "call-2", function: { name: "read_file", arguments: "{}" } }],
      },
      { role: "tool", tool_call_id: "call-2", content: "file contents" },
    ],
  });

  assert.equal(summary.toolUseCount, 2);
  assert.equal(summary.toolResultCount, 2);
  assert.deepEqual(summary.messages[0].contentTypes, ["text", "tool_use"]);
  assert.deepEqual(summary.messages[1].toolResultIds, ["tool-1"]);
  assert.deepEqual(summary.messages[2].toolNames, ["read_file"]);
  assert.deepEqual(summary.messages[3].toolResultIds, ["call-2"]);
  assert.ok(summary.schemaPaths.includes("messages[].content[].tool_use_id:string"));
  assert.ok(summary.schemaPaths.includes("messages[].tool_calls[].function.name:string"));
});

test("forwards real HTTP traffic and writes a redacted request/response capture", async (t) => {
  const { createProbeServer } = await loadProbe();
  assert.equal(typeof createProbeServer, "function");

  const upstream = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    assert.equal(request.url, "/codebuddy/default/v1/chat/completions?trace=1");
    assert.equal(request.headers.authorization, "Bearer sk-live-secret");
    assert.equal(JSON.parse(raw).api_key, "sk-live-secret");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, token: "server-secret" }));
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => upstream.close());

  const directory = await mkdtemp(join(tmpdir(), "topic4-probe-"));
  const outputFile = join(directory, "capture.jsonl");
  const upstreamAddress = upstream.address();
  const probe = createProbeServer({
    targetUrl: `http://127.0.0.1:${upstreamAddress.port}`,
    outputFile,
  });
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  t.after(() => probe.close());

  const probeAddress = probe.address();
  const response = await fetch(
    `http://127.0.0.1:${probeAddress.port}/codebuddy/default/v1/chat/completions?trace=1`,
    {
      method: "POST",
      headers: {
        authorization: "Bearer sk-live-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        api_key: "sk-live-secret",
        messages: [{ role: "tool", tool_call_id: "call-1", content: "result" }],
      }),
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, token: "server-secret" });

  const events = (await readFile(outputFile, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(events.length, 2);
  assert.equal(events[0].event, "http.request");
  assert.equal(events[0].headers.authorization, "[REDACTED]");
  assert.equal(events[0].body.json.api_key, "[REDACTED]");
  assert.equal(events[0].summary.toolResultCount, 1);
  assert.equal(events[1].event, "http.response");
  assert.equal(events[1].body.json.token, "[REDACTED]");
});
