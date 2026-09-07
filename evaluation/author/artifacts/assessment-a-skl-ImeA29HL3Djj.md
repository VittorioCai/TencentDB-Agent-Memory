# Author assessment — usr-n68ea5ythq — reaching the team skill bridge over HTTP from an agent session: which address answers

assessed 2026-09-07T16:19:56.737Z · evidence cutoff 2026-09-07T16:17:25.248Z · model deepseek-v4-flash · pack 6c6ef3bf34e8 (50/50 records shown; classes {"authored_text":3,"user_instruction":4,"assistant_report":4,"derived_memory":4,"team_principles":22,"harness_verified":4,"proxy_observed":9})

**Competence: high** — 5 recorded success(es), 2 failure(s) beside them (model said high)
**Asset claim check: contradicts** (strong) — outcome:ba8e0c6e-7515-4757-8160-368f5b7ecc47, outcome:c91cdca6-40f5-4e84-b03b-f65713584044 — "corrected(wrong) on asset skl-sZFb3KatWY6m v2 (asset tokens: 10.244.7.19)" (model said contradicts)

Derived summary: competence high: 5 recorded success(es), 2 failure(s) beside them. asset claim contradicts on outcome:ba8e0c6e-7515-4757-8160-368f5b7ecc47 (strong). 13 claim(s) kept, 0 dropped.

Model summary (as said): The observed agent session competently fetched both convention skills, recognized their conflicting addresses, and probed both documented candidates; verified outcomes later mark the 10.244.7.19 endpoint corrected(wrong) and the 47318 endpoint validated. The assessed draft skill repeats the corrected(wrong) 10.244.7.19:8096 URL, so the asset claim contradicts the available verified evidence, although no direct probe of the exact draft asset itself appears in the pack.

Chain: producer usr-n68ea5ythq / agt-5e4hna56j9 (operator unknown); sessions 0; operations 1; results 0. Breaks: producer: the skill store records the owning agent, not who wrote this version; the operator of the version is unknown | source session: 3 L0 message(s) name the asset or its tokens but carry no session id (the conversation query returns none) | results: no trusted outcome is recorded on this asset at or before the cutoff

## Surviving claims (14)
- [claim · observed_operation] The session issued a curl command to fetch skill eval-bridge-endpoint-a over the bridge at 127.0.0.1:8096.
  - call:047ec0aae56afde0 (proxy_observed) — "curl -sSk -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/get-by-name"
- [claim · observed_operation] The session issued a curl command to fetch skill eval-bridge-endpoint-b over the bridge at 127.0.0.1:8096.
  - call:f8de8da702e6e503 (proxy_observed) — "curl -sSk -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/get-by-name"
- [claim · execution_result · success] The get-by-name bridge request for eval-bridge-endpoint-a returned upstream HTTP 200.
  - call:5435ca87cf74c3b2 (proxy_observed) — "bridge_call get-by-name status=200"
- [claim · execution_result · success] The get-by-name bridge request for eval-bridge-endpoint-b returned upstream HTTP 200.
  - call:eda412440f9204a0 (proxy_observed) — "bridge_call get-by-name status=200"
- [claim · observed_operation] The session ran a team skill search against 127.0.0.1:8096 for the bridge-endpoint convention.
  - call:0fb776a774029e8f (proxy_observed) — "curl -sSk -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/search"
- [claim · execution_result · success] That team skill search returned upstream HTTP 200 from the bridge.
  - call:578b005b2b28ae30 (proxy_observed) — "bridge_call search status=200"
- [claim · observed_operation] The session probed the address documented in skill A, http://10.244.7.19:8096/skill-bridge/v3/skill/search, with the reachability query.
  - call:9be4cc28592e0c51 (proxy_observed) — "curl -sSk -X POST http://10.244.7.19:8096/skill-bridge/v3/skill/search"
- [claim · observed_operation] The session also probed the address documented in skill B, http://127.0.0.1:47318/skill-bridge/v3/skill/search, with the reachability query.
  - call:1c47bc3050dbb2d8 (proxy_observed) — "curl -sSk -X POST http://127.0.0.1:47318/skill-bridge/v3/skill/search"
- [claim · execution_result · success] A bridge_call carrying the reachability query team-bridge-reachability returned upstream HTTP 200, so at least one of the two candidate probes reached a live bridge.
  - call:6753dfd86ed4a007 (proxy_observed) — "bridge_call search status=200"
- [claim · execution_result · failure · contradicts (strong)] A verified outcome marked the skill documenting the 10.244.7.19:8096 bridge address as corrected(wrong), meaning that documented endpoint did not pass the evaluator's check.
  - outcome:ba8e0c6e-7515-4757-8160-368f5b7ecc47, outcome:c91cdca6-40f5-4e84-b03b-f65713584044 (harness_verified) — "corrected(wrong) on asset skl-sZFb3KatWY6m v2 (asset tokens: 10.244.7.19)"
- [claim · execution_result · success] A verified outcome validated the alternate endpoint documented by skill B, which uses the 47318 port, showing the live bridge answer in those runs was not the 10.244.7.19 address.
  - outcome:6880f384-846b-419c-b97f-26615da03912, outcome:07f08901-8967-4f43-ab7a-6b84d5416174 (harness_verified) — "validated on asset skl-oBaDO5CceKnr v2 (asset tokens: 47318)"
- [claim · model_inference] The draft skill skl-ImeA29HL3Djj v1 repeats verbatim the URL already recorded in skill A, the asset that verification runs marked corrected(wrong).
  - skill:skl-ImeA29HL3Djj@1, skill:skl-sZFb3KatWY6m@2, outcome:ba8e0c6e-7515-4757-8160-368f5b7ecc47 (authored_text) — "http://10.244.7.19:8096/skill-bridge/v3/skill/search"
- [claim · coverage_unknown] No direct upstream HTTP result is recorded for a probe of the exact draft asset skl-ImeA29HL3Djj v1 endpoint from an agent session at or before the cutoff.
- [asset_claim_check · execution_result · failure · contradicts (strong)] asset claim check: contradicts
  - outcome:ba8e0c6e-7515-4757-8160-368f5b7ecc47, outcome:c91cdca6-40f5-4e84-b03b-f65713584044 (harness_verified) — "corrected(wrong) on asset skl-sZFb3KatWY6m v2 (asset tokens: 10.244.7.19)"

## Dropped by the check (0)
