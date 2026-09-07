# Author assessment — usr-4u07qc2kuj — reading team skills through the skill bridge by name across agents

assessed 2026-09-07T20:01:59.703Z · evidence cutoff 2026-09-06T08:47:33.000Z · model deepseek-v4-flash · pack fc1188c0f9c3 (179/299 records shown; classes {"user_instruction":45,"assistant_report":44,"derived_memory":31,"proxy_observed":178,"authored_text":1})

**Competence: unknown** — no business-level result; transport: 1 answered 2xx, 0 not (reported, not decisive) (model said unknown)
**Asset claim check: silent** (model said supports)

Derived summary: competence unknown: no business-level result; transport: 1 answered 2xx, 0 not (reported, not decisive). asset claim silent. 3 claim(s) kept, 2 dropped (skill).

Model summary (as said): The agent consistently exercised the HTTP skill bridge, including get-by-name on its own skill and /skill/get by skill_id after team searches, and the skill text it owns explicitly documents that get-by-name is own-agent scoped and returns 40401 for another agent's skill, recommending search + get-by-skill_id. However, at the cutoff there is no harness-verified application-level outcome confirming the 40401 behavior in an actual response body; all recorded bridge responses are transport-level 200s (or unpaired 403s). Competence is therefore not determinable from verified results, though the operational pattern and authored instructions support the asset's stated approach.

Chain: producer usr-4u07qc2kuj / agt-5e0y4l8a7a (operator unknown); sessions 7; operations 40; results 0. Breaks: producer: the skill store records the owning agent, not who wrote this version; the operator of the version is unknown | results: no trusted outcome is recorded on this asset at or before the cutoff

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
