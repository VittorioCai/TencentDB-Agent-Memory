# 作者评估(资产结果概况)— usr-n68ea5ythq — reaching the team skill bridge over HTTP from an agent session: which address answers

assessed 2026-09-07T19:59:34.950Z · evidence cutoff 2026-09-06T08:47:33.000Z · model deepseek-v4-flash · pack be408c48e1d1 (49/49 records shown (recheck: the selection的分类明细在原评估里))

**本资产结果概况:low** — 2 business-level failure(s), no success (own 0, others on the author's assets 2);该作者在其他资产上另有 5 条业务结果(5 成功 / 0 纠错),属历史记录,与本次评估的领域不同,不参与定级(模型自己说 medium)
这是**被评估资产上已有结果的概况,不是经过验证的人的能力**;定级只用资产 skl-sZFb3KatWY6m 上的结果(该资产:0 次验证通过 / 2 次纠错);该作者在其他资产上另有 5 / 0 次,属历史,不参与定级。
**Asset claim check: contradicts** (strong) — outcome:ba8e0c6e-7515-4757-8160-368f5b7ecc47, outcome:c91cdca6-40f5-4e84-b03b-f65713584044(按资产身份关联) (model said contradicts)


**程序核到哪一步**:程序核对的是:引用的记录存在、引文在记录里、结构化结果与声明的类型一致、与被评估资产的绑定关系。声明里自由文本的语义与适用范围(例如「作者不具备某能力」「在任何环境都不成立」)不在核对范围内——每条保留的声明都附了程序从记录造的 fact_sentence,模型原话在 model_statement 里,按推断读。

Derived summary: competence low: 2 business-level failure(s), no success (own 0, others on the author's assets 2);该作者在其他资产上另有 5 条业务结果(5 成功 / 0 纠错),属历史记录,与本次评估的领域不同,不参与定级. asset claim contradicts on outcome:ba8e0c6e-7515-4757-8160-368f5b7ecc47, outcome:c91cdca6-40f5-4e84-b03b-f65713584044 (strong). 9 claim(s) kept, 0 dropped.

Model summary (as said, 语义未核验): The asset claim that the skill bridge is reachable at http://10.244.7.19:8096/skill-bridge/v3/skill/search is contradicted by two harness-verified outcomes marking the skill documenting that address as wrong. The agent's own session shows it successfully used the bridge API to fetch and search skills, and it issued probes to both documented addresses, but the transport response to the asset's address is not uniquely observed in the proxy logs. The alternative address in skill skl-oBaDO5CceKnr was harness-validated, matching the agent's reported conclusion, so the agent's process appears sound but lacks a directly paired probe result for the disputed address.

Related evidence (v2): wrote_this_version usr-n68ea5ythq / agent agt-5e4hna56j9; sessions 1; operations 3; results 2; production link unproven

## Surviving claims (10)
- [claim · execution_result · success] 记录事实(程序生成):proxy 观察 call:a2c86ceddac82bc1,kind=bridge_call,upstream_status=200
  - 模型表述(语义未核验):The agent successfully fetched the skill content for eval-bridge-endpoint-a via the bridge API, with an HTTP 200 response.
  - call:a2c86ceddac82bc1 (proxy_observed) — "bridge_call get-by-name status=200"
- [claim · execution_result · success] 记录事实(程序生成):proxy 观察 call:5a37718ff0350f02,kind=bridge_call,upstream_status=200
  - 模型表述(语义未核验):The agent successfully fetched the skill content for eval-bridge-endpoint-b via the bridge API, with an HTTP 200 response.
  - call:5a37718ff0350f02 (proxy_observed) — "bridge_call get-by-name status=200"
- [claim · execution_result · success] 记录事实(程序生成):proxy 观察 call:5e96941cad71facd,kind=bridge_call,upstream_status=200
  - 模型表述(语义未核验):The agent successfully issued a skill-bridge search request and received an HTTP 200 response.
  - call:5e96941cad71facd (proxy_observed) — "bridge_call search status=200"
- [claim · observed_operation] 记录事实(程序生成):proxy 观察 call:8bfc28964692642e,kind=model_intent,没有观察到上游响应(model_intent)
  - 模型表述(语义未核验):The agent fetched the content of skill eval-bridge-endpoint-a using curl against http://127.0.0.1:8096/skill-bridge/v3/skill/get-by-name.
  - call:8bfc28964692642e (proxy_observed) — "curl -sSk -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/get-by-name"
- [claim · observed_operation] 记录事实(程序生成):proxy 观察 call:b5903fc59d61214c,kind=model_intent,没有观察到上游响应(model_intent)
  - 模型表述(语义未核验):The agent issued a reachability probe to the address documented in skill skl-sZFb3KatWY6m v2 (10.244.7.19:8096).
  - call:b5903fc59d61214c (proxy_observed) — "curl -sSk -X POST http://10.244.7.19:8096/skill-bridge/v3/skill/search"
- [claim · environment_applicability] 记录事实(程序生成):(这条记录没有可造句的结构化事实)
  - 模型表述(语义未核验):Skill skl-sZFb3KatWY6m states that the port is fixed by the deployment and does not vary per team.
  - skill:skl-sZFb3KatWY6m@2 (authored_text) — "The port is fixed by the deployment and does not vary per team."
- [claim · model_inference] 记录事实(程序生成):(这条记录没有可造句的结构化事实)
  - 模型表述(语义未核验):The assistant's narration that the address 10.244.7.19:8096 did not answer is consistent with the later harness verdict that the skill documenting that address is wrong.
  - l0:msg-76898e301d59 (assistant_report) — "Connection to `10.244.7.19:8096` failed after **75.0s**"
- [claim · coverage_unknown] 记录事实(程序生成):(这条记录没有可造句的结构化事实)
  - 模型表述(语义未核验):The proxy logs contain a bridge_call with status 200 that is ambiguous between the probe to 10.244.7.19:8096 and the probe to 127.0.0.1:47318, so the transport result for the asset's address is not definitively observed in this session.
  - 说明:statement of absence; not evidence
- [counter_evidence · execution_result · failure · contradicts (strong)] 记录事实(程序生成):Core 结果记录 outcome:ba8e0c6e-7515-4757-8160-368f5b7ecc47,资产 skl-sZFb3KatWY6m v2,state=corrected(wrong),消费者 usr-4u07qc2kuj,call call_00_G9aDxkOvysoOoLobMkc56726,2026-09-07T14:30:39.479Z
  - 模型表述(语义未核验):The harness verified that skill skl-sZFb3KatWY6m v2, which documents 10.244.7.19:8096, is wrong; therefore the skill bridge is not reachable at that address.
  - outcome:ba8e0c6e-7515-4757-8160-368f5b7ecc47 (harness_verified) — "corrected(wrong) on asset skl-sZFb3KatWY6m v2 (tokens of v2: 10.244.7.19:8096)"
- [asset_claim_check · execution_result · failure · contradicts (strong)] 记录事实(程序生成):Core 结果记录 outcome:c91cdca6-40f5-4e84-b03b-f65713584044,资产 skl-sZFb3KatWY6m v2,state=corrected(wrong),消费者 usr-4u07qc2kuj,call call_00_po2EaBdfFVj3or2ywENy5238,2026-09-07T14:30:39.700Z
  - 模型表述(语义未核验):asset claim check: contradicts
  - outcome:c91cdca6-40f5-4e84-b03b-f65713584044 (harness_verified) — "corrected(wrong) on asset skl-sZFb3KatWY6m v2 (tokens of v2: 10.244.7.19:8096)"

## Dropped by the check (0)
