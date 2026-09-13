# 作者评估(资产结果概况)— usr-4u07qc2kuj — reading team skills through the skill bridge by name across agents

assessed 2026-09-07T20:01:59.703Z · evidence cutoff 2026-09-06T08:47:33.000Z · model deepseek-v4-flash · pack bd0ab2c72016 (179/292 records shown (recheck: the selection的分类明细在原评估里))

**本资产结果概况:unknown** — 被评估资产 skl-lUWmwEYqsZDZ 上没有业务结果;该作者在其他资产上另有 1 条业务结果(1 成功 / 0 纠错),属历史记录,与本次评估的领域不同,不参与定级(模型自己说 unknown)
这是**被评估资产上已有结果的概况,不是经过验证的人的能力**;定级只用资产 skl-lUWmwEYqsZDZ 上的结果(该资产:0 次验证通过 / 0 次纠错);该作者在其他资产上另有 1 / 0 次,属历史,不参与定级。
**Asset claim check: silent** (model said supports)
  - 说明:statement of absence; not evidence

**程序核到哪一步**:程序核对的是:引用的记录存在、引文在记录里、结构化结果与声明的类型一致、与被评估资产的绑定关系。声明里自由文本的语义与适用范围(例如「作者不具备某能力」「在任何环境都不成立」)不在核对范围内——每条保留的声明都附了程序从记录造的 fact_sentence,模型原话在 model_statement 里,按推断读。

Derived summary: competence unknown: 被评估资产 skl-lUWmwEYqsZDZ 上没有业务结果;该作者在其他资产上另有 1 条业务结果(1 成功 / 0 纠错),属历史记录,与本次评估的领域不同,不参与定级. asset claim silent. 3 claim(s) kept, 2 dropped (skill).

Model summary (as said, 语义未核验): The agent consistently exercised the HTTP skill bridge, including get-by-name on its own skill and /skill/get by skill_id after team searches, and the skill text it owns explicitly documents that get-by-name is own-agent scoped and returns 40401 for another agent's skill, recommending search + get-by-skill_id. However, at the cutoff there is no harness-verified application-level outcome confirming the 40401 behavior in an actual response body; all recorded bridge responses are transport-level 200s (or unpaired 403s). Competence is therefore not determinable from verified results, though the operational pattern and authored instructions support the asset's stated approach.

Related evidence (v3): wrote_this_version usr-4u07qc2kuj / agent agt-5e0y4l8a7a; sessions 8; operations 40; results 0; production link unproven; gaps: 结果:截止时刻前该资产上没有受信结果

## Surviving claims (4)
- [claim · execution_result · success] 记录事实(程序生成):proxy 观察 call:c082942675850287,kind=bridge_call,upstream_status=200
  - 模型表述(语义未核验):The person's search command for 'convention address reach skill bridge' was answered by the bridge endpoint with HTTP status 200 (transport-level success; application body is not shown).
  - call:c082942675850287 (proxy_observed) — "2026-09-06 06:00:29.184 bridge_call search status=200 {"query":"convention address reach skill bridge""
- [claim · observed_operation] 记录事实(程序生成):proxy 观察 call:38d8b59d76dd06fb,kind=model_intent,没有观察到上游响应(model_intent)
  - 模型表述(语义未核验):The person's session issued a get-by-name request for skill-bridge-http-access using URL http://127.0.0.1:8096; the bridge answered with HTTP status 200.
  - call:38d8b59d76dd06fb (proxy_observed) — "curl -sSk -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/get-by-name -H 'content-type: application/json' -H 'x-tdai-service-id: default' -H 'x-conversation-id: f2bf3856-ba09-466d-9f36-4ea379b10d3a' -d '{"skill_name": "skill-bridge-http-access", "include_content": true, "include_manifest": true}'"
- [claim · observed_operation] 记录事实(程序生成):proxy 观察 call:90f7cd79b2034e2b,kind=model_intent,没有观察到上游响应(model_intent)
  - 模型表述(语义未核验):The person's session issued a POST to the /skill/get endpoint (the cross-agent read method recommended in the authored skill) targeting skill skl-sZFb3KatWY6m, and the paired bridge call returned HTTP 200.
  - call:90f7cd79b2034e2b (proxy_observed) — "curl -sSk -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/get"
- [claim · coverage_unknown] 记录事实(程序生成):(这条记录没有可造句的结构化事实)
  - 模型表述(语义未核验):These records contain only transport-level proxy statuses and no harness-verified application-body outcome, so no record independently verifies that a get-by-name call actually returned the 40401 SKILL_NOT_FOUND code at or before the cutoff.
  - 说明:statement of absence; not evidence

## Dropped by the check (2)
- [claim · environment_applicability] The agent-owned skill text at skl-lUWmwEYqsZDZ@2 records 127.0.0.1:8096 as the bridge endpoint and states get-by-name is scoped to the caller's own agent, returning 40401 SKILL_NOT_FOUND for another agent's skill, so search-then-get-by-skill_id is the documented behavior. — skill:skl-lUWmwEYqsZDZ@2 is the asset's own text; it cannot support or contradict its own claim (skill:skl-lUWmwEYqsZDZ@2)
- [asset_claim_check · environment_applicability] asset claim check: supports — skill:skl-lUWmwEYqsZDZ@2 is the asset's own text; it cannot support or contradict its own claim (skill:skl-lUWmwEYqsZDZ@2)
