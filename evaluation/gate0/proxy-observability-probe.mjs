import { appendFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SENSITIVE_KEY = /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[-_]?key|token|access[-_]?token|refresh[-_]?token|auth[-_]?token|password|secret|.*[-_]secret)$/i;
const SENSITIVE_HEADER = /authorization|cookie|key|token|secret|password/i;
const HOP_BY_HOP_HEADER = /^(?:connection|keep-alive|proxy-authenticate|proxy-authorization|te|trailer|transfer-encoding|upgrade|host|content-length)$/i;
const DEFAULT_MAX_CAPTURE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_REQUEST_BYTES = 32 * 1024 * 1024;

function sanitizeString(value) {
  return value
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk|ck)[-_][A-Za-z0-9._-]{6,}/g, "[REDACTED]");
}

export function redactHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      SENSITIVE_HEADER.test(key) ? "[REDACTED]" : sanitizeString(String(value)),
    ]),
  );
}

export function sanitizePayload(value, key = "") {
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") return sanitizeString(value);
  if (Array.isArray(value)) return value.map((item) => sanitizePayload(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        sanitizePayload(childValue, childKey),
      ]),
    );
  }
  return value;
}

function collectSchemaPaths(value, path, paths) {
  if (Array.isArray(value)) {
    for (const item of value) collectSchemaPaths(item, `${path}[]`, paths);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      collectSchemaPaths(child, path ? `${path}.${key}` : key, paths);
    }
    return;
  }
  const type = value === null ? "null" : typeof value;
  paths.add(`${path}:${type}`);
}

export function summarizeJsonBody(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  let toolUseCount = 0;
  let toolResultCount = 0;

  const messageSummaries = messages.map((message) => {
    const content = Array.isArray(message?.content) ? message.content : [];
    const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
    const contentTypes = typeof message?.content === "string"
      ? ["text"]
      : content.map((block) => typeof block?.type === "string" ? block.type : typeof block);
    const blockToolNames = content
      .filter((block) => block?.type === "tool_use" && typeof block?.name === "string")
      .map((block) => block.name);
    const nativeToolNames = toolCalls
      .filter((call) => typeof call?.function?.name === "string")
      .map((call) => call.function.name);
    const toolResultIds = content
      .filter((block) => block?.type === "tool_result" && typeof block?.tool_use_id === "string")
      .map((block) => block.tool_use_id);

    if (message?.role === "tool" && typeof message?.tool_call_id === "string") {
      toolResultIds.push(message.tool_call_id);
    }

    toolUseCount += blockToolNames.length + nativeToolNames.length;
    toolResultCount += toolResultIds.length;

    return {
      role: typeof message?.role === "string" ? message.role : "unknown",
      contentTypes,
      toolNames: [...blockToolNames, ...nativeToolNames],
      toolResultIds,
    };
  });

  const schemaPaths = new Set();
  collectSchemaPaths(body, "", schemaPaths);

  return {
    topLevelKeys: body && typeof body === "object" ? Object.keys(body).sort() : [],
    messages: messageSummaries,
    toolUseCount,
    toolResultCount,
    schemaPaths: [...schemaPaths].sort(),
  };
}

function headersToObject(headers) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.join(", ") : String(value ?? ""),
    ]),
  );
}

function captureBody(buffer, contentType, maxCaptureBytes) {
  const truncated = buffer.length > maxCaptureBytes;
  const captured = buffer.subarray(0, maxCaptureBytes).toString("utf8");
  const body = { bytes: buffer.length, truncated };

  if (!truncated && contentType.toLowerCase().includes("json")) {
    try {
      body.json = sanitizePayload(JSON.parse(captured));
      return body;
    } catch {
      // Keep malformed or streaming JSON as text so the forwarding path remains transparent.
    }
  }

  body.text = sanitizeString(captured);
  return body;
}

async function readRequestBody(request, maxRequestBytes) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxRequestBytes) throw new Error("request_body_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function appendEvent(outputFile, event) {
  await mkdir(dirname(outputFile), { recursive: true });
  await appendFile(outputFile, `${JSON.stringify(event)}\n`, { mode: 0o600 });
}

function buildForwardHeaders(requestHeaders) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(requestHeaders)) {
    if (HOP_BY_HOP_HEADER.test(key) || value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  headers.set("accept-encoding", "identity");
  return headers;
}

function copyResponseHeaders(upstreamHeaders, response) {
  upstreamHeaders.forEach((value, key) => {
    if (HOP_BY_HOP_HEADER.test(key) || key.toLowerCase() === "content-encoding") return;
    response.setHeader(key, value);
  });
}

export function createProbeServer({
  targetUrl,
  outputFile,
  maxCaptureBytes = DEFAULT_MAX_CAPTURE_BYTES,
  maxRequestBytes = DEFAULT_MAX_REQUEST_BYTES,
}) {
  const target = new URL(targetUrl);

  return createServer(async (request, response) => {
    if (request.url === "/__probe/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ok", target: target.origin, outputFile }));
      return;
    }

    const requestId = randomUUID();
    const requestHeaders = headersToObject(request.headers);

    try {
      const requestBody = await readRequestBody(request, maxRequestBytes);
      const requestContentType = requestHeaders["content-type"] ?? "";
      const capturedRequestBody = captureBody(requestBody, requestContentType, maxCaptureBytes);
      const requestJson = capturedRequestBody.json;
      const targetRequestUrl = new URL(request.url ?? "/", target).toString();

      await appendEvent(outputFile, {
        schemaVersion: "gate0-probe-v1",
        event: "http.request",
        requestId,
        timestamp: new Date().toISOString(),
        method: request.method ?? "GET",
        path: request.url ?? "/",
        targetUrl: targetRequestUrl,
        headers: redactHeaders(requestHeaders),
        body: capturedRequestBody,
        ...(requestJson && typeof requestJson === "object"
          ? { summary: summarizeJsonBody(requestJson) }
          : {}),
      });

      const upstream = await fetch(targetRequestUrl, {
        method: request.method,
        headers: buildForwardHeaders(request.headers),
        body: request.method === "GET" || request.method === "HEAD" ? undefined : requestBody,
        redirect: "manual",
      });

      response.statusCode = upstream.status;
      copyResponseHeaders(upstream.headers, response);

      const capturedChunks = [];
      let capturedBytes = 0;
      let responseBytes = 0;
      if (upstream.body) {
        for await (const chunk of upstream.body) {
          const buffer = Buffer.from(chunk);
          responseBytes += buffer.length;
          if (capturedBytes < maxCaptureBytes) {
            const remaining = maxCaptureBytes - capturedBytes;
            const part = buffer.subarray(0, remaining);
            capturedChunks.push(part);
            capturedBytes += part.length;
          }
          response.write(buffer);
        }
      }

      const capturedResponse = Buffer.concat(capturedChunks);
      const responseContentType = upstream.headers.get("content-type") ?? "";
      const responseBody = captureBody(capturedResponse, responseContentType, maxCaptureBytes);
      responseBody.bytes = responseBytes;
      responseBody.truncated = responseBytes > maxCaptureBytes;

      await appendEvent(outputFile, {
        schemaVersion: "gate0-probe-v1",
        event: "http.response",
        requestId,
        timestamp: new Date().toISOString(),
        method: request.method ?? "GET",
        path: request.url ?? "/",
        status: upstream.status,
        headers: redactHeaders(headersToObject(Object.fromEntries(upstream.headers.entries()))),
        body: responseBody,
      });
      response.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await appendEvent(outputFile, {
        schemaVersion: "gate0-probe-v1",
        event: "http.error",
        requestId,
        timestamp: new Date().toISOString(),
        method: request.method ?? "GET",
        path: request.url ?? "/",
        error: message,
      }).catch(() => {});
      if (!response.headersSent) response.writeHead(message === "request_body_too_large" ? 413 : 502);
      response.end(message);
    }
  });
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const host = process.env.PROBE_HOST ?? "127.0.0.1";
  const port = Number(process.env.PROBE_PORT ?? "18097");
  const targetUrl = process.env.PROBE_TARGET_URL ?? "http://127.0.0.1:8096";
  const outputFile = resolve(
    process.env.PROBE_OUTPUT_FILE ?? "evaluation/gate0/artifacts/gate0-proxy-capture.jsonl",
  );
  const server = createProbeServer({ targetUrl, outputFile });

  server.listen(port, host, () => {
    process.stdout.write(`Gate 0 probe listening on http://${host}:${port}\n`);
    process.stdout.write(`Forwarding to ${targetUrl}\n`);
    process.stdout.write(`Capture file: ${outputFile}\n`);
  });
}
