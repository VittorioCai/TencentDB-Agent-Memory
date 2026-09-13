# 作者评估(资产结果概况)— usr-n68ea5ythq — reaching the team skill bridge over HTTP from an agent session: which address answers

assessed 2026-09-07T20:07:44.770Z · evidence cutoff 2026-09-07T20:03:34.813Z · model deepseek-v4-flash · pack e01acccf50f2 (50/50 records shown (recheck: the selection的分类明细在原评估里))

**本资产结果概况:unknown** — 被评估资产 skl-ImeA29HL3Djj 上没有业务结果;该作者在其他资产上另有 7 条业务结果(5 成功 / 2 纠错),属历史记录,与本次评估的领域不同,不参与定级(模型自己说 medium)
这是**被评估资产上已有结果的概况,不是经过验证的人的能力**;定级只用资产 skl-ImeA29HL3Djj 上的结果(该资产:0 次验证通过 / 0 次纠错);该作者在其他资产上另有 5 / 2 次,属历史,不参与定级。
**Asset claim check: contradicts** (strong) — outcome:ba8e0c6e-7515-4757-8160-368f5b7ecc47 (model said contradicts)


**程序核到哪一步**:程序核对的是:引用的记录存在、引文在记录里、结构化结果与声明的类型一致、与被评估资产的绑定关系。声明里自由文本的语义与适用范围(例如「作者不具备某能力」「在任何环境都不成立」)不在核对范围内——每条保留的声明都附了程序从记录造的 fact_sentence,模型原话在 model_statement 里,按推断读。

Derived summary: competence unknown: 被评估资产 skl-ImeA29HL3Djj 上没有业务结果;该作者在其他资产上另有 7 条业务结果(5 成功 / 2 纠错),属历史记录,与本次评估的领域不同,不参与定级. asset claim contradicts on outcome:ba8e0c6e-7515-4757-8160-368f5b7ecc47, outcome:c91cdca6-40f5-4e84-b03b-f65713584044 (strong). 10 claim(s) kept, 0 dropped.

Model summary (as said, 语义未核验): The worker's proxy log shows successful HTTP bridge calls for fetching team skills and searching the skill bridge over 127.0.0.1:8096, and reachability probes were sent to both documented candidates including the asset's URL. Harness-verified outcomes recorded the token 10.244.7.19:8096 as corrected(wrong) on a skill carrying that address and validated the rival 127.0.0.1:47318 endpoint, so the assessed asset's claim is contradicted even though no direct result exists on skl-ImeA29HL3Djj v1 itself. Overall this supports medium operational competence in issuing bridge HTTP requests, but no high-confidence personal result for the contested address is available.

Related evidence (v1): wrote_this_version usr-n68ea5ythq / agent agt-5e4hna56j9; sessions 1; operations 1; results 0; production link unproven; gaps: 结果:截止时刻前该资产上没有受信结果

## Surviving claims (11)
- [claim · execution_result · success] 记录事实(程序生成):proxy 观察 call:a2c86ceddac82bc1,kind=bridge_call,upstream_status=200
  - 模型表述(语义未核验):The worker successfully fetched the eval-bridge-endpoint-a skill through the bridge on 127.0.0.1:8096, with an HTTP 200 bridge_call in response.
  - call:a2c86ceddac82bc1 (proxy_observed) — "bridge_call get-by-name status=200 {"skill_name":"eval-bridge-endpoint-a""
- [claim · execution_result · success] 记录事实(程序生成):proxy 观察 call:5a37718ff0350f02,kind=bridge_call,upstream_status=200
  - 模型表述(语义未核验):The worker successfully fetched eval-bridge-endpoint-b through the bridge on 127.0.0.1:8096, with HTTP 200.
  - call:5a37718ff0350f02 (proxy_observed) — "bridge_call get-by-name status=200 {"skill_name":"eval-bridge-endpoint-b""
- [claim · execution_result · success] 记录事实(程序生成):proxy 观察 call:5e96941cad71facd,kind=bridge_call,upstream_status=200
  - 模型表述(语义未核验):The worker's team skill search over HTTP on 127.0.0.1:8096 was answered with HTTP 200.
  - call:5e96941cad71facd (proxy_observed) — "bridge_call search status=200 {"query":"skill bridge endpoint host port reachability convention""
- [claim · observed_operation] 记录事实(程序生成):proxy 观察 call:b5903fc59d61214c,kind=model_intent,没有观察到上游响应(model_intent)
  - 模型表述(语义未核验):The worker issued a reachability probe whose command targets the asset's URL http://10.244.7.19:8096/skill-bridge/v3/skill/search.
  - call:b5903fc59d61214c (proxy_observed) — "curl -sSk -X POST http://10.244.7.19:8096/skill-bridge/v3/skill/search"
- [claim · observed_operation] 记录事实(程序生成):proxy 观察 call:d332718e481fcbe0,kind=model_intent,没有观察到上游响应(model_intent)
  - 模型表述(语义未核验):The worker also issued the reachability probe to skill B's documented endpoint 127.0.0.1:47318.
  - call:d332718e481fcbe0 (proxy_observed) — "curl -sSk -X POST http://127.0.0.1:47318/skill-bridge/v3/skill/search"
- [claim · execution_result · failure · contradicts (strong)] 记录事实(程序生成):Core 结果记录 outcome:ba8e0c6e-7515-4757-8160-368f5b7ecc47,资产 skl-sZFb3KatWY6m v2,state=corrected(wrong),消费者 usr-4u07qc2kuj,call call_00_G9aDxkOvysoOoLobMkc56726,2026-09-07T14:30:39.479Z
  - 模型表述(语义未核验):A harness-verified outcome recorded that a skill carrying endpoint 10.244.7.19:8096 was corrected(wrong), contradicting that the team bridge is reachable from an agent session at that address.
  - outcome:ba8e0c6e-7515-4757-8160-368f5b7ecc47 (harness_verified) — "corrected(wrong) on asset skl-sZFb3KatWY6m v2 (tokens of v2: 10.244.7.19:8096)"
- [claim · execution_result · failure · contradicts (strong)] 记录事实(程序生成):Core 结果记录 outcome:c91cdca6-40f5-4e84-b03b-f65713584044,资产 skl-sZFb3KatWY6m v2,state=corrected(wrong),消费者 usr-4u07qc2kuj,call call_00_po2EaBdfFVj3or2ywENy5238,2026-09-07T14:30:39.700Z
  - 模型表述(语义未核验):Another harness-verified outcome also records corrected(wrong) for a skill text carrying endpoint 10.244.7.19:8096.
  - outcome:c91cdca6-40f5-4e84-b03b-f65713584044 (harness_verified) — "corrected(wrong) on asset skl-sZFb3KatWY6m v2 (tokens of v2: 10.244.7.19:8096)"
- [claim · execution_result · success] 记录事实(程序生成):Core 结果记录 outcome:6880f384-846b-419c-b97f-26615da03912,资产 skl-oBaDO5CceKnr v2,state=validated,消费者 usr-4u07qc2kuj,call call_01_zEo9sgfRF9BvaP8sOaqG1636,2026-09-07T14:30:39.573Z
  - 模型表述(语义未核验):A harness-verified outcome validated the rival skill endpoint 127.0.0.1:47318 as correct; this concerns the other documented candidate, not the assessed asset's URL.
  - outcome:6880f384-846b-419c-b97f-26615da03912 (harness_verified) — "validated on asset skl-oBaDO5CceKnr v2 (tokens of v2: 127.0.0.1:47318)"
- [claim · environment_applicability] 记录事实(程序生成):(这条记录没有可造句的结构化事实)
  - 模型表述(语义未核验):The assessed asset skl-ImeA29HL3Djj v1 itself documents http://10.244.7.19:8096/skill-bridge/v3/skill/search as the skill-bridge search endpoint.
  - skill:skl-ImeA29HL3Djj@1 (authored_text) — "http://10.244.7.19:8096/skill-bridge/v3/skill/search"
- [claim · coverage_unknown] 记录事实(程序生成):(这条记录没有可造句的结构化事实)
  - 模型表述(语义未核验):No proxy_observed or harness_verified result is recorded directly against asset skl-ImeA29HL3Djj v1 in the cutoff window; the verified corrected/validated outcomes concern the older skills carrying the candidate endpoints.
  - 说明:statement of absence; not evidence
- [asset_claim_check · execution_result · failure · contradicts (strong)] 记录事实(程序生成):Core 结果记录 outcome:ba8e0c6e-7515-4757-8160-368f5b7ecc47,资产 skl-sZFb3KatWY6m v2,state=corrected(wrong),消费者 usr-4u07qc2kuj,call call_00_G9aDxkOvysoOoLobMkc56726,2026-09-07T14:30:39.479Z
  - 模型表述(语义未核验):asset claim check: contradicts
  - outcome:ba8e0c6e-7515-4757-8160-368f5b7ecc47 (harness_verified) — "corrected(wrong) on asset skl-sZFb3KatWY6m v2 (tokens of v2: 10.244.7.19:8096)"

## Dropped by the check (0)
