# Gate 0 Proxy observability probe

This probe is a transparent local HTTP tap. It forwards CodeBuddy traffic to the real
MemoryProxy and DeepSeek path; it does not generate or replace model responses.

**Where you put the tap decides what you can see.** Injection happens *inside* the Proxy,
so a tap on the client side observes only what CodeBuddy sent and never sees a single
injected asset block:

```text
CodeBuddy -> [probe here: sees 15523-char prompt, 0 asset blocks]  -> MemoryProxy :8096
          MemoryProxy -> [probe here: sees 27103-char prompt, all blocks] -> DeepSeek
```

Both readings are honest and only one is useful. Put the probe **upstream of the Proxy**,
between Proxy and the model:

```text
CodeBuddy -> MemoryProxy :8096 -> probe :18097 -> DeepSeek
             MemoryProxy -> MemoryCore / Memory Hub
```

Set `PROXY_UPSTREAM_URL=http://host.docker.internal:18097` in `deploy/global-images/.env`,
bind the probe to `0.0.0.0`, and point `PROBE_TARGET_URL` at the real model endpoint. The
client-side position is kept only for capturing what CodeBuddy itself emits.

The JSONL capture records redacted headers and bodies, JSON field paths, message roles,
and native OpenAI/Anthropic `tool_use` / `tool_result` shapes. Credentials are redacted,
and the artifact directory is ignored by Git.

## Test

From the repository root with Node 22 active:

```bash
node --test evaluation/gate0/proxy-observability-probe.test.mjs
```

## Run

Start the real three-service stack first, then run:

```bash
PROBE_TARGET_URL=http://127.0.0.1:8096 \
PROBE_PORT=18097 \
node evaluation/gate0/proxy-observability-probe.mjs
```

Health check:

```bash
curl -sS http://127.0.0.1:18097/__probe/health
```

For the Gate 0 capture run, use a temporary CodeBuddy custom model whose URL is the
probe rather than the Proxy directly:

```json
{
  "id": "deepseek-v4-flash",
  "name": "topic4-gate0-probe",
  "vendor": "openai",
  "apiKey": "<business-user sk-mem key>",
  "maxInputTokens": 128000,
  "url": "http://127.0.0.1:18097/codebuddy/default",
  "supportsToolCall": true,
  "supportsImages": false
}
```

Do not paste either the `sk-mem-*` key or the DeepSeek key into source files or chat.

## Gate 0 capture matrix

Run one real session that produces each of these paths:

| Path | What must appear in the capture |
|---|---|
| Normal CodeBuddy turn | `/codebuddy/default/v1/chat/completions`, session header, messages and tools fields |
| Native CodeBuddy tool | assistant tool call followed by a later `tool_result` / `role=tool` request |
| Skill via Bash curl | curl result returned in the later CodeBuddy request that reaches Proxy |
| Knowledge via Bash curl | `tools/list` or `tools/call` result returned in the later request |
| TDAI memory via Bash curl | memory-bridge result returned in the later request |

Skill and TDAI curl calls may go directly to Proxy `:8096`, and Knowledge calls may go
directly to the Knowledge service. The decisive Gate 0 question is whether CodeBuddy
places their Bash result in a subsequent model request; because that request goes through
MemoryProxy and then this tap, the JSONL sample directly answers whether Proxy can observe it.

The default outputs are:

```text
evaluation/gate0/artifacts/gate0-upstream-capture.jsonl   # probe between Proxy and model
evaluation/gate0/artifacts/gate0-proxy-capture.jsonl      # probe between CodeBuddy and Proxy
evaluation/gate0/artifacts/tool-call-logs.jsonl           # exported tool_call_logs rows
```

Pinned versions and image digests are tracked in
[`environment-manifest.json`](./environment-manifest.json). Update its route and Gate 0
fields only after the corresponding real check succeeds.

Completing this matrix with a real CodeBuddy session is necessary for a schema freeze but
not sufficient. The matrix answers observability only: whether each channel can be seen,
and by which evidence tier. It cannot establish that the event carries the fields the
evidence model requires. In particular the `producer_*` / `actor_*` provenance pair
(see the evidence model spec) is unobservable from any capture and
cannot be backfilled later, because asset ownership and versions move. Freeze only when
both hold.

## Verify the capture

The matrix above is checked automatically, against two independent sources. Export the
Proxy's own telemetry first, then run the verifier over both:

```bash
SINCE="2 HOUR" bash evaluation/gate0/export-tool-call-logs.sh

node evaluation/gate0/verify-capture.mjs \
  evaluation/gate0/artifacts/gate0-upstream-capture.jsonl \
  evaluation/gate0/artifacts/tool-call-logs.jsonl
```

It prints a Markdown verdict and exits non-zero until every matrix row and check passes.

### Why two sources

Each asset channel is decided at one of two evidence tiers, and the report always names
which one decided a row:

- **bridge** — a `kind='bridge_call'` row in `tool_call_logs` with `upstream_status` in the
  2xx range and an empty `reject_reason`. The Proxy writes this itself; it never passes
  through the model and cannot be talked into existence. Only `skill-bridge` and
  `memory-bridge` emit it.
- **wire** — reconstructed from the capture. Each `tool_result` is paired back to the call
  that issued it via `tool_call_id`; the channel is chosen from the **issued URL** only;
  and the outcome is read from the result's `Exit Code` / `Stderr` / `Stdout` sections.

The wire tier alone is not sufficient to freeze the schema. Deciding a channel by running a
regex over tool-result text produced three separate false positives, each of which reported
PASS for a channel that was never successfully called:

1. A CodeBuddy Bash result **echoes the command back** before its output, so matching the
   whole result matches the request. A curl that timed out after 75 s read as `fetched`.
2. An asset whose own text **discusses** these endpoints matched. The skill
   `agentmemory-knowledge-tools-bridge-routing` mentions `tools/list` and `knowledge_id` in
   its description, which satisfied the knowledge channel with zero knowledge calls.
3. A Grep result carrying **this repository's own source** matched the verifier's own
   pattern literal. The verifier passed because the model grepped for the verifier.

When both tiers are available they are compared, and either direction of disagreement fails
the run: a wire-level `fetched` with no 2xx bridge row means the capture judge is wrong; a
bridge row the capture never saw means the tap has a hole.

Knowledge calls do go straight to the Knowledge service and never traverse a Proxy bridge,
but that does not leave them unobservable: the Knowledge service has its own ClickHouse
sink writing the **same** `tool_call_logs` table with the same schema, tagged
`source_tag='knowledge'` and `bridge_source='knowledge-service'`. It is off by default and
`start-memory-hub.sh` did not forward its settings, which is why early runs saw no rows and
concluded none could exist. Enable it in `deploy/global-images/.env`:

```bash
KNOWLEDGE_CLICKHOUSE_ENABLED=1
KNOWLEDGE_CLICKHOUSE_URL=http://clickhouse:8123
KNOWLEDGE_CLICKHOUSE_DATABASE=context_proxy
KNOWLEDGE_CLICKHOUSE_USER=default
KNOWLEDGE_CLICKHOUSE_PASSWORD=local
```

then recreate the hub with `bash deploy/global-images/start-memory-hub.sh`. All three
channels then land in one table and are told apart by `source_tag` / `bridge_source`.

Two details when joining across the two writers. The Knowledge service takes `session_key`
from a bare `x-conversation-id`, while the Proxy prefixes it (`codebuddy:<id>`), so the
prefix must be normalized before any join. And its telemetry middleware runs after the
handler unconditionally, so rejected calls are recorded too — a 4xx row is negative
evidence, not a missing row.

A channel still falls back to `wire` whenever its sink produced no rows for a run, and that
is reported as an observability gap. "Sink switched off" and "channel never called" are
indistinguishable from the verdict's side, so neither is assumed benign.

### Check statuses

`PASS` / `FAIL` / `n/a`. A check with nothing to run against reports `n/a`, never `PASS`,
and `n/a` blocks the schema freeze exactly as firmly as `FAIL` — not knowing is not the same
as being fine. Running the verifier without a `tool_call_logs` export is therefore always
inconclusive by design.

Check P9 still applies: no `<asset_reflection>` block may reach the wire, because that
injector is `cacheStrategy=none` and shifts the KV-cache prefix, which would pollute token,
cost and latency metrics.

Unit tests:

```bash
node --test evaluation/gate0/verify-capture.test.mjs
```

## Two operational notes

**Routing bridge curls through the tap (optional, higher fidelity).** The curl recipes
baked into `<skill_tools>` / `<tdai_memory_tools>` use `injection.externalGatewayUrl`, or
fall back to the Proxy's own `host:port`. Pointing `externalGatewayUrl` at the probe makes
those curls traverse the tap directly instead of being observed only through their returned
payloads. Knowledge calls are separate: they go straight to the Knowledge service, so
capturing them needs a second probe instance in front of that port.

**The probe must be off during measured runs.** It adds a hop, and repointing
`externalGatewayUrl` changes prompt text, which moves the KV-cache prefix. Use it for Gate 0
schema discovery only, never during the A/B and ablation conditions.

## Scope boundary

The probe answers what crosses the wire; `tool_call_logs` answers what the Proxy actually
did. The verifier now consumes both, so the sink-side checks P2 and P4 through P8 in
the telemetry audit are no longer out of scope here.

Two prerequisites, both of which fail silently:

- **ClickHouse ships disabled** (`MemoryProxy/src/config.ts`, `clickhouse.enabled=false`).
  With it off, `tool_call_logs` / `usage_logs` / `session_init_logs` are simply never
  written. Set `PROXY_CLICKHOUSE_URL` in `deploy/global-images/.env` and restart the Proxy;
  the startup log must say `ClickHouse 埋点已启用`. Code containing telemetry calls does not
  mean data reached the disk.
- **A table having a column does not mean the column has values.** In `usage_logs`,
  `prompt_tokens` / `completion_tokens` / `cache_hit_tokens` / `cache_miss_tokens` carry real
  numbers, while `credit_saved`, `compress_tokens_saved`, `pre_compress_tokens`,
  `post_compress_tokens`, `credit` and `input_tokens` are all zero under this configuration.
  Verify any metric against real rows before citing it.

What remains genuinely outside this directory: the Knowledge service's own request log,
which is the only place a knowledge call can be confirmed system-side.
