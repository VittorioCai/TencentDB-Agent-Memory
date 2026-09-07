import test from "node:test";
import assert from "node:assert/strict";
import { availableSkillsOf, contextConfounders, nonPoolReadsOf, profileMemoryOf, summaryOf, systemPromptOf } from "./context-confounders.mjs";

const SYS = [
  "<skill_tools>…</skill_tools>",
  "<available_skills>",
  "- skill-bridge-http-access: Reach and query the team's skill bridge over HTTP",
  "- eval-bridge-endpoint-b: Team convention for reaching the skill bridge",
  "</available_skills>",
  "<tdai_profile_memory>",
  '<agent name="agt-b" role="self" agent_id="agt-b">',
  "<l3_core_memory>",
  "# Team Operating Doctrine",
  "- **Reach & conflicts**: probe every documented candidate under a bounded timeout (--max-time 15)",
  "- **Lookup**: never get-by-name (agent-scoped; cross-agent 404 by design)",
  "> **Last update**: 2026-09-06T00:04:12.511Z · **Scenes**: 1",
  "</l3_core_memory>",
  "<l2_scene_index>",
  "- `skill-bridge-验证.md` — SOP",
  "</l2_scene_index>",
  "</agent>",
  "</tdai_profile_memory>",
].join("\n");

const capture = (system) => [
  JSON.stringify({ event: "http.request", body: { json: { messages: [{ role: "system", content: system }, { role: "user", content: "go" }] } } }),
  JSON.stringify({ event: "http.response", body: {} }),
];

const pool = [{ asset_id: "skl-b", name: "eval-bridge-endpoint-b" }, { asset_id: "skl-a", name: "eval-bridge-endpoint-a" }];
const watch = [/probe every documented/i, /get-by-name/i];

test("the profile block is read for its agent, hash, last update and watched lines", () => {
  const p = profileMemoryOf(SYS, watch);
  assert.equal(p.present, true);
  assert.deepEqual(p.agents, [{ name: "agt-b", role: "self", agent_id: "agt-b" }]);
  assert.equal(p.l3.present, true);
  assert.equal(p.l3.last_update, "2026-09-06T00:04:12.511Z");
  assert.equal(p.l3.watch_hits.length, 2);
  assert.match(p.l3.watch_hits[0].text, /probe every documented candidate/);
  assert.equal(p.l2_index_entries, 1);
});

test("a prompt without the block says absent, and no prompt says null", () => {
  assert.equal(profileMemoryOf("<skill_tools/>", watch).present, false);
  assert.equal(profileMemoryOf(null, watch).present, null);
});

test("available skills are split into pool and non-pool", () => {
  assert.deepEqual(availableSkillsOf(SYS), ["skill-bridge-http-access", "eval-bridge-endpoint-b"]);
  const c = contextConfounders({ captureLines: capture(SYS), toolCallRows: [], pool, watch });
  assert.deepEqual(c.available_skills.not_in_pool, ["skill-bridge-http-access"]);
});

test("bridge reads outside the pool are listed by id or by name; pool reads are not", () => {
  const rows = [
    { kind: "bridge_call", executed_endpoint: "get-by-name", request_body: JSON.stringify({ skill_name: "skill-bridge-http-access" }), timestamp: "t1", upstream_status: 0 },
    { kind: "bridge_call", executed_endpoint: "get", request_body: JSON.stringify({ skill_id: "skl-b", include_content: true }), timestamp: "t2" },
    { kind: "bridge_call", executed_endpoint: "get", request_body: JSON.stringify({ skill_id: "skl-zzz" }), timestamp: "t3" },
    { kind: "bridge_call", executed_endpoint: "search", request_body: JSON.stringify({ query: "x" }) },
    { kind: "model_intent", initiated_tool: "Bash", request_body: "{\"command\":\"curl …\"}" },
  ];
  const reads = nonPoolReadsOf(rows, pool);
  assert.deepEqual(reads.map((r) => r.skill_name ?? r.skill_id), ["skill-bridge-http-access", "skl-zzz"]);
});

test("the summary carries counts, and nulls where the input was missing", () => {
  const c = contextConfounders({ captureLines: capture(SYS), toolCallRows: null, pool, watch });
  const s = summaryOf(c);
  assert.equal(s.profile_memory_present, true);
  assert.equal(s.l3_watch_hits, 2);
  assert.equal(s.non_pool_skills_in_listing, 1);
  assert.equal(s.non_pool_skill_reads, null);
  const none = summaryOf(contextConfounders({ captureLines: [], toolCallRows: [], pool, watch }));
  assert.equal(none.profile_memory_present, null);
  assert.equal(systemPromptOf([]), null);
});
