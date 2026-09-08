# Author assessment — usr-n68ea5ythq — reaching the team skill bridge over HTTP from an agent session: which address answers

assessed 2026-09-07T20:07:44.770Z · evidence cutoff 2026-09-07T20:03:34.813Z · model deepseek-v4-flash · pack 4e7e9866249e (50/50 records shown; classes {"authored_text":3,"user_instruction":4,"assistant_report":4,"derived_memory":4,"team_principles":22,"harness_verified":4,"proxy_observed":9})

**Competence: medium** — 2 business-level success(es) (own 0, others on the author's assets 2), 2 failure(s) beside them; transport: 3 answered 2xx, 0 not (reported, not decisive); high is not derived without calibration (model said medium)
**Asset claim check: contradicts** (strong) — outcome:ba8e0c6e-7515-4757-8160-368f5b7ecc47 — "corrected(wrong) on asset skl-sZFb3KatWY6m v2 (tokens of v2: 10.244.7.19:8096)" (model said contradicts)

Derived summary: competence medium: 2 business-level success(es) (own 0, others on the author's assets 2), 2 failure(s) beside them; transport: 3 answered 2xx, 0 not (reported, not decisive); high is not derived without calibration. asset claim contradicts on outcome:ba8e0c6e-7515-4757-8160-368f5b7ecc47, outcome:c91cdca6-40f5-4e84-b03b-f65713584044 (strong). 10 claim(s) kept, 0 dropped.

Model summary (as said): The worker's proxy log shows successful HTTP bridge calls for fetching team skills and searching the skill bridge over 127.0.0.1:8096, and reachability probes were sent to both documented candidates including the asset's URL. Harness-verified outcomes recorded the token 10.244.7.19:8096 as corrected(wrong) on a skill carrying that address and validated the rival 127.0.0.1:47318 endpoint, so the assessed asset's claim is contradicted even though no direct result exists on skl-ImeA29HL3Djj v1 itself. Overall this supports medium operational competence in issuing bridge HTTP requests, but no high-confidence personal result for the contested address is available.

Chain: producer usr-n68ea5ythq / agt-5e4hna56j9 (operator unknown); sessions 0; operations 1; results 0. Breaks: producer: the skill store records the owning agent, not who wrote this version; the operator of the version is unknown | source session: 3 L0 message(s) name the asset or its tokens but carry no session id (the conversation query returns none) | results: no trusted outcome is recorded on this asset at or before the cutoff

## Surviving claims (11)
- [claim · execution_result · success] The worker successfully fetched the eval-bridge-endpoint-a skill through the bridge on 127.0.0.1:8096, with an HTTP 200 bridge_call in response.
  - call:8bfc28964692642e, call:a2c86ceddac82bc1 (proxy_observed) — "bridge_call get-by-name status=200 {"skill_name":"eval-bridge-endpoint-a""
- [claim · execution_result · success] The worker successfully fetched eval-bridge-endpoint-b through the bridge on 127.0.0.1:8096, with HTTP 200.
  - call:b6d4f0d34651bfda, call:5a37718ff0350f02 (proxy_observed) — "bridge_call get-by-name status=200 {"skill_name":"eval-bridge-endpoint-b""
- [claim · execution_result · success] The worker's team skill search over HTTP on 127.0.0.1:8096 was answered with HTTP 200.
  - call:cd4a73260f5a931d, call:5e96941cad71facd (proxy_observed) — "bridge_call search status=200 {"query":"skill bridge endpoint host port reachability convention""
- [claim · observed_operation] The worker issued a reachability probe whose command targets the asset's URL http://10.244.7.19:8096/skill-bridge/v3/skill/search.
  - call:b5903fc59d61214c (proxy_observed) — "curl -sSk -X POST http://10.244.7.19:8096/skill-bridge/v3/skill/search"
- [claim · observed_operation] The worker also issued the reachability probe to skill B's documented endpoint 127.0.0.1:47318.
  - call:d332718e481fcbe0 (proxy_observed) — "curl -sSk -X POST http://127.0.0.1:47318/skill-bridge/v3/skill/search"
- [claim · execution_result · failure · contradicts (strong)] A harness-verified outcome recorded that a skill carrying endpoint 10.244.7.19:8096 was corrected(wrong), contradicting that the team bridge is reachable from an agent session at that address.
  - outcome:ba8e0c6e-7515-4757-8160-368f5b7ecc47 (harness_verified) — "corrected(wrong) on asset skl-sZFb3KatWY6m v2 (tokens of v2: 10.244.7.19:8096)"
- [claim · execution_result · failure · contradicts (strong)] Another harness-verified outcome also records corrected(wrong) for a skill text carrying endpoint 10.244.7.19:8096.
  - outcome:c91cdca6-40f5-4e84-b03b-f65713584044 (harness_verified) — "corrected(wrong) on asset skl-sZFb3KatWY6m v2 (tokens of v2: 10.244.7.19:8096)"
- [claim · execution_result · success] A harness-verified outcome validated the rival skill endpoint 127.0.0.1:47318 as correct; this concerns the other documented candidate, not the assessed asset's URL.
  - outcome:6880f384-846b-419c-b97f-26615da03912 (harness_verified) — "validated on asset skl-oBaDO5CceKnr v2 (tokens of v2: 127.0.0.1:47318)"
- [claim · environment_applicability] The assessed asset skl-ImeA29HL3Djj v1 itself documents http://10.244.7.19:8096/skill-bridge/v3/skill/search as the skill-bridge search endpoint.
  - skill:skl-ImeA29HL3Djj@1 (authored_text) — "http://10.244.7.19:8096/skill-bridge/v3/skill/search"
- [claim · coverage_unknown] No proxy_observed or harness_verified result is recorded directly against asset skl-ImeA29HL3Djj v1 in the cutoff window; the verified corrected/validated outcomes concern the older skills carrying the candidate endpoints.
- [asset_claim_check · execution_result · failure · contradicts (strong)] asset claim check: contradicts
  - outcome:ba8e0c6e-7515-4757-8160-368f5b7ecc47 (harness_verified) — "corrected(wrong) on asset skl-sZFb3KatWY6m v2 (tokens of v2: 10.244.7.19:8096)"

## Dropped by the check (0)
