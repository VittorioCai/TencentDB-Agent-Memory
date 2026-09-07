# Author assessment — usr-4u07qc2kuj — reading team skills through the skill bridge by name across agents

assessed 2026-09-07T16:09:38.314Z · evidence cutoff 2026-09-06T08:47:33.000Z · model deepseek-v4-flash · pack d27a89e8ffe5 (157/271 records shown; classes {"user_instruction":45,"assistant_report":44,"derived_memory":31,"proxy_observed":151})

**Competence: high** — 3 recorded success(es) (model said medium)
**Asset claim check: supports** (strong) — call:2f8a03aaf89c51af, call:d146f6c92f5b0680 — "curl -sSk -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/search" (model said silent)

Derived summary: competence high: 3 recorded success(es). asset claim supports on call:d146f6c92f5b0680, call:5e983b9cd7a13f24 (strong). 5 claim(s) kept, 1 dropped (a model_inference claim cannot support or contradict the asset).

Model summary (as said): The agent repeatedly used the team-scope search and skill_id-based /skill/get routes on the 127.0.0.1:8096 bridge with HTTP 200 responses, aligning with the asset's recommended workflow. The specific 40401 SKILL_NOT_FOUND behavior for get-by-name is only present in assistant reports and source-unavailable derived memories, not in any harness-verified or body-level proxy result, and some get-by-name calls logged HTTP 200 at the transport level. Overall the agent shows a strong operational method for reading team skills by search and skill_id, but the asset's error-code assertion remains unverified by trusted outcomes.

Chain: producer usr-4u07qc2kuj / agt-5e0y4l8a7a (operator unknown); sessions 7; operations 40; results 0. Breaks: producer: the skill store records the owning agent, not who wrote this version; the operator of the version is unknown | results: no trusted outcome is recorded on this asset at or before the cutoff

## Surviving claims (6)
- [claim · execution_result · success · supports (strong)] The agent ran a team-scope search against the skill bridge at 127.0.0.1:8096 and the bridge logged HTTP 200 for the search.
  - call:2f8a03aaf89c51af, call:d146f6c92f5b0680 (proxy_observed) — "curl -sSk -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/search"
- [claim · execution_result · success · supports (strong)] The agent fetched another agent's skill by skill_id through POST /skill/get on the 127.0.0.1:8096 bridge, and the bridge logged HTTP 200 for that get.
  - call:df53daa33e1103db, call:5e983b9cd7a13f24 (proxy_observed) — "http://127.0.0.1:8096/skill-bridge/v3/skill/get"
- [claim · observed_operation] The assistant reported that get-by-name 404s for another agent's convention skills and that GET /skill/get by skill_id works; this is a narration, not a proxy-observed or harness-verified outcome.
  - l0:msg-cd345421e56e (assistant_report) — "`get-by-name` 404s on them, but `GET /skill/get` by skill_id works"
- [claim · execution_result · success] The agent's get-by-name requests to 127.0.0.1:8096 for skills owned by another agent logged HTTP 200 at the transport level, not an HTTP-level 404 or 403.
  - call:734c110224715931, call:3f18169a67726d8d, call:2768d3d969d1bf4e, call:635e25262515af3a (proxy_observed) — "http://127.0.0.1:8096/skill-bridge/v3/skill/get-by-name"
- [claim · coverage_unknown] The records contain no harness-verified outcome on asset skl-lUWmwEYqsZDZ and no proxy log body showing the string SKILL_NOT_FOUND; the claimed 40401 is attested only by assistant reports and derived memories with unavailable source.
- [counter_evidence · model_inference] Proxy-observed HTTP status for get-by-name calls to the 127.0.0.1:8096 bridge on another agent's skills was 200 on multiple occasions; because an application-level 40401 could appear inside a 200 body, these HTTP 200s do not establish or refute the asset's 40401 claim.
  - call:734c110224715931, call:3f18169a67726d8d, call:2768d3d969d1bf4e, call:635e25262515af3a (proxy_observed) — "http://127.0.0.1:8096/skill-bridge/v3/skill/get-by-name"

## Dropped by the check (1)
- [claim · model_inference] A derived-memory record (source unavailable) matches the asset's rule: on the 127.0.0.1:8096 bridge, POST /skill/get-by-name is agent-scoped and reading another agent's skill by name returns 404, while resolution by skill_id is possible. — a model_inference claim cannot support or contradict the asset (l1:m_1788645820841_4fbf556c)
