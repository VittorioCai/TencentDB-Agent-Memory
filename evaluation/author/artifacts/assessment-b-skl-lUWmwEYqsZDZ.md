# Author assessment — usr-4u07qc2kuj — reading team skills through the skill bridge by name across agents

assessed 2026-09-07T20:01:59.703Z · evidence cutoff 2026-09-06T08:47:33.000Z · model deepseek-v4-flash · pack bd0ab2c72016 (179/292 records shown; classes {"assistant_report":41,"user_instruction":41,"derived_memory":31,"proxy_observed":178,"authored_text":1})

**Competence: unknown** — 被评估资产 skl-lUWmwEYqsZDZ 上没有业务结果;该作者在其他资产上另有 1 条业务结果(1 成功 / 0 纠错),属历史记录,与本次评估的领域不同,不参与定级 (model said unknown)
**Asset claim check: silent** (model said supports)

Derived summary: competence unknown: 被评估资产 skl-lUWmwEYqsZDZ 上没有业务结果;该作者在其他资产上另有 1 条业务结果(1 成功 / 0 纠错),属历史记录,与本次评估的领域不同,不参与定级. asset claim silent. 3 claim(s) kept, 2 dropped (skill).

Model summary (as said): The agent consistently exercised the HTTP skill bridge, including get-by-name on its own skill and /skill/get by skill_id after team searches, and the skill text it owns explicitly documents that get-by-name is own-agent scoped and returns 40401 for another agent's skill, recommending search + get-by-skill_id. However, at the cutoff there is no harness-verified application-level outcome confirming the 40401 behavior in an actual response body; all recorded bridge responses are transport-level 200s (or unpaired 403s). Competence is therefore not determinable from verified results, though the operational pattern and authored instructions support the asset's stated approach.

Related evidence (v3): wrote_this_version usr-4u07qc2kuj / agent agt-5e0y4l8a7a; sessions 8; operations 40; results 0; production link UNPROVEN (adjacency between records not verified); gaps: 结果:截止时刻前该资产上没有受信结果

## Surviving claims (4)
- [claim · execution_result · success] The person's search command for 'convention address reach skill bridge' was answered by the bridge endpoint with HTTP status 200 (transport-level success; application body is not shown).
  - call:c082942675850287 (proxy_observed) — "2026-09-06 06:00:29.184 bridge_call search status=200 {"query":"convention address reach skill bridge""
- [claim · observed_operation] The person's session issued a get-by-name request for skill-bridge-http-access using URL http://127.0.0.1:8096; the bridge answered with HTTP status 200.
  - call:38d8b59d76dd06fb, call:48d6a3fa800e4126 (proxy_observed) — "curl -sSk -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/get-by-name -H 'content-type: application/json' -H 'x-tdai-service-id: default' -H 'x-conversation-id: f2bf3856-ba09-466d-9f36-4ea379b10d3a' -d '{"skill_name": "skill-bridge-http-access", "include_content": true, "include_manifest": true}'"
- [claim · observed_operation] The person's session issued a POST to the /skill/get endpoint (the cross-agent read method recommended in the authored skill) targeting skill skl-sZFb3KatWY6m, and the paired bridge call returned HTTP 200.
  - call:90f7cd79b2034e2b, call:0059f14f9dc6d9fa (proxy_observed) — "curl -sSk -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/get"
- [claim · coverage_unknown] These records contain only transport-level proxy statuses and no harness-verified application-body outcome, so no record independently verifies that a get-by-name call actually returned the 40401 SKILL_NOT_FOUND code at or before the cutoff.

## Dropped by the check (2)
- [claim · environment_applicability] The agent-owned skill text at skl-lUWmwEYqsZDZ@2 records 127.0.0.1:8096 as the bridge endpoint and states get-by-name is scoped to the caller's own agent, returning 40401 SKILL_NOT_FOUND for another agent's skill, so search-then-get-by-skill_id is the documented behavior. — skill:skl-lUWmwEYqsZDZ@2 is the asset's own text; it cannot support or contradict its own claim (skill:skl-lUWmwEYqsZDZ@2)
- [asset_claim_check · environment_applicability] asset claim check: supports — skill:skl-lUWmwEYqsZDZ@2 is the asset's own text; it cannot support or contradict its own claim (skill:skl-lUWmwEYqsZDZ@2)
