/**
 * Reading the HTTP requests out of a shell command the model wrote.
 *
 * One tool call is not one request. Batch 4 (2026-09-10) had a command that
 * dialled two addresses in sequence, a `for` loop that issued five searches
 * with a variable body, and calls wrapped in `$(date …)` timing. The acceptance
 * used to take the first URL in the text and one outcome for the whole call.
 * These tests pin what a parse must give back: every curl invocation, its own
 * URL / headers / body, whether those are literal, and the shell structure
 * around it — because `;` is an order, `&&` is a condition, `for` is an
 * unknown count and `&` is no order at all.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { curlInvocations, tokenizeShell } from "./shell-requests.mjs";

const B = "http://127.0.0.1:47318/skill-bridge/v3/skill/search";
const A = "http://10.244.7.19:8096/skill-bridge/v3/skill/search";

test("one curl: url, method, headers, body, and that they are literal", () => {
  const [c] = curlInvocations(`curl -sSk -X POST ${B} -H 'content-type: application/json' -H 'x-team-trace: bt-fixtureright' -d '{"query": "team-bridge-reachability"}'`);
  assert.equal(c.url, B);
  assert.equal(c.host, "127.0.0.1"); assert.equal(c.port, "47318"); assert.equal(c.path, "/skill-bridge/v3/skill/search");
  assert.equal(c.method, "POST");
  assert.equal(c.headers["x-team-trace"], "bt-fixtureright");
  assert.equal(c.body, '{"query": "team-bridge-reachability"}');
  assert.equal(c.body_literal, true); assert.equal(c.url_literal, true);
  assert.equal(c.in_loop, false); assert.equal(c.background, false); assert.equal(c.conditional, false);
});

test("two curls joined by ';' and by a newline are two invocations in shell order", () => {
  const cs = curlInvocations(`echo b; curl -s ${B} -d '{"query":"x"}'\necho a\ncurl -s ${A} -d '{"query":"y"}'`);
  assert.deepEqual(cs.map((c) => [c.host, c.after_op]), [["127.0.0.1", ";"], ["10.244.7.19", "\n"]]);
  assert.ok(cs.every((c) => c.sequential === true));
});

test("a backslash-newline continuation is one invocation", () => {
  const cs = curlInvocations(`curl -sSk -o /tmp/resp_b.txt -w 'HTTP=%{http_code}\\n' --max-time 12 \\\n  -X POST ${B} \\\n  -H 'x-team-trace: bt-x' \\\n  -d '{"query": "team-bridge-reachability"}'`);
  assert.equal(cs.length, 1);
  assert.equal(cs[0].out_file, "/tmp/resp_b.txt");
  assert.equal(cs[0].write_out, "HTTP=%{http_code}\\n");
  assert.equal(cs[0].max_time, 12);
  assert.equal(cs[0].headers["x-team-trace"], "bt-x");
});

test("inside a for loop the body carries a variable: not literal, and the count of executions is unknown", () => {
  const cs = curlInvocations(`for q in "a" "b c"; do echo "=== $q ==="; curl -sSk -X POST ${B} -d "{\\"query\\": \\"$q\\"}" | python3 -c 'pass'; done`);
  assert.equal(cs.length, 1);
  assert.equal(cs[0].in_loop, true);
  assert.equal(cs[0].body_literal, false);
  assert.equal(cs[0].piped, true);
});

test("a command substitution before the curl does not hide it, and -m is the timeout", () => {
  const cs = curlInvocations(`start=$(date +%s.%N)\ncurl -sSk -m 20 -X POST ${A} -H 'x-team-trace: bt-w' -d '{"query":"team-bridge-reachability"}' -w '\\nHTTP=%{http_code}'\nend=$(date +%s.%N)`);
  assert.equal(cs.length, 1);
  assert.equal(cs[0].max_time, 20);
  assert.equal(cs[0].url_literal, true);
});

test("'&&' makes the second curl conditional; '||' after a curl does not make that curl conditional", () => {
  const [a, b] = curlInvocations(`curl -s ${A} -d '{"query":"q"}' && curl -s ${B} -d '{"query":"q"}'`);
  assert.equal(a.conditional, false);
  assert.equal(b.conditional, true); assert.equal(b.after_op, "&&");
  const [c] = curlInvocations(`curl -s ${B} -d '{"query":"q"}' || echo failed`);
  assert.equal(c.conditional, false);
});

test("a backgrounded curl has no order", () => {
  const [a, b] = curlInvocations(`curl -s ${A} -d '{"query":"q"}' & curl -s ${B} -d '{"query":"q"}'; wait`);
  assert.equal(a.background, true); assert.equal(a.sequential, false);
  assert.equal(b.background, false);
});

test("combined short flags do not swallow the url; attached -o value is read", () => {
  const [c] = curlInvocations(`curl -sSkL -o/tmp/x.txt ${B} -d '{"query":"q"}'`);
  assert.equal(c.url, B);
  assert.equal(c.out_file, "/tmp/x.txt");
});

test("a curl inside if…fi is conditional", () => {
  const [c] = curlInvocations(`if curl -sf ${B} -d '{"query":"q"}'; then echo ok; fi`);
  assert.equal(c.conditional, true);
});

test("a command with no curl yields nothing, even when it mentions the url", () => {
  assert.deepEqual(curlInvocations(`python3 -c 'import requests; requests.post("${B}")'`), []);
});

test("the tokenizer keeps quoted text whole and marks unexpanded variables as not literal", () => {
  const t = tokenizeShell(`-d "{\\"q\\": \\"$q\\"}" -H 'a: b c'`).filter((x) => x.type === "word");
  assert.deepEqual(t.map((x) => x.value), ["-d", '{"q": "$q"}', "-H", "a: b c"]);
  assert.deepEqual(t.map((x) => x.literal), [true, false, true, true]);
});
