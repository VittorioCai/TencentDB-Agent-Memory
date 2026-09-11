# 开发闭环第二任务 `exit-line-collect`:运行报告(脚本生成)

生成于 2026-09-11T18:08:14Z;清单 `evaluation/tasks/exit-line-collect/devloop-runs.json`;运行 4 次(正式样本 2,作废 1)。
笔记 skl-pXLc38dex6Zt(eval-tool-result-exit-line v2,仓库只存 sha256 1e85dcf5dcf7…);v1 于 2026-09-11T17:55:11Z 退役(值已进 git 历史),本任务所有运行都在 v2 上。
判据版本:repo-2026-09-11d;起点提交 141c044(与 exit-code-fix 相同),任务文本 sha256 f32af00888d3…。

## 这份数字测的是什么,不是什么

- 测的是**迁移**:笔记正文写的是 `evaluation/tasks/bridge-addr/verify.mjs` 的退出行拼写,本任务的缺陷在 `evaluation/attribution/collect-artifacts.mjs`。有笔记组里"检索到笔记 → 新增带判别值的测试 → 参考测试通过"三件事同时成立才算迁移成功;缺任何一件按缺的那件记。
- 副本里已有正确实现可参照(evaluation/gate0/verify-capture.mjs、evaluation/gate0/verify-capture.test.mjs、evaluation/runner/memory-channel.test.mjs、evaluation/tasks/bridge-addr/verify.multi-target.test.mjs、evaluation/tasks/bridge-name/verify.test.mjs),笔记的作用是缩短定位而非提供唯一答案。
- 消费者用户是 c(零记录),与第一任务的 b 不同;两个用户仍由同一个人操作。闸门看到的 `distinct_consumers` / `distinct_tasks` 是关系计数,不是独立的人数。
- 无笔记 / 有笔记各 2 / 0 次,只用于演示,不是性能对照。模型自报的测试结果不采信;判决只读副本。

## 每次运行

| 组 | run | 消费者(用户) | 笔记状态@开跑 | 判决 | 参考测试 | 检索次数 / 笔记返回 | 送达事件 | used / needs_review | 尝试值 | 改动文件 | 记忆通道 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| smoke(作废) | 20260911T175839Z-devloop-smoke | agt-hyv1cffnme(usr-8ypylzex49) | candidate v2 team | ? | ? | ? / 未知 | 未知 | ? / ? | 无 | 无 | 未知 |
| smoke(不计) | 20260911T180035Z-devloop-smoke | agt-hyy95lvov6(usr-8ypylzex49) | candidate v2 team | PASS | 6/6 | 4 / 否 | 无 | 0 / 0 | none: collect-artifacts.test.mjs carries no bt- marker | M evaluation/attribution/collect-artifacts.mjs; A evaluation/attribution/collect-artifacts.test.mjs | 是 |
| no-note | 20260911T180413Z-devloop-no-note | agt-hy5bxf99k6(usr-8ypylzex49) | candidate v2 team | PASS | 6/6 | 8 / 否 | 无 | 0 / 0 | none: collect-artifacts.test.mjs carries no bt- marker | M evaluation/attribution/collect-artifacts.mjs; A evaluation/attribution/collect-artifacts.test.mjs | 是 |
| no-note | 20260911T180614Z-devloop-no-note | agt-hy8ov81zak(usr-8ypylzex49) | candidate v2 team | PASS | 6/6 | 4 / 否 | 无 | 0 / 0 | none: collect-artifacts.test.mjs carries no bt- marker | M evaluation/attribution/collect-artifacts.mjs; A evaluation/attribution/collect-artifacts.test.mjs | 是 |

## 验收明细

- **20260911T175839Z-devloop-smoke**(smoke,作废):? — ?
- **20260911T180035Z-devloop-smoke**(smoke):PASS — reference test passed (6/6); no new identified failure in the controlled suite (560 tests over 40 original test file(s) plus the reference); 3 baseline failure(s) still failing; note: the model's own tests (1 added or rewritten file(s)): 3/3 pass (recorded, not a verdict input)
  受控套件:560 项,失败 3,新增失败 0,基线失败仍在 3/3;原测试 40/40 在,改写 0,新增 1;模型自测 3/3(只记不判)
  尝试:none: collect-artifacts.test.mjs carries no bt- marker ok=true call=call_00_ET_m8NXO0Zz0qZ2MOB8Fxb84906 added test file evaluation/attribution/collect-artifacts.test.mjs has no marker in its name or test titles
  检索词:"解析工具结果 退出状态 exit_code capture 归因", "工具结果格式 exit status 正则 解析", "capture 解析 工具调用 测试 归因 evaluation", "CodeBuddy tool result exit code 格式"
  成本:turns 19, responses_with_usage 19, wall_seconds 90, system_prompt_chars 22225, prompt_tokens 1434383, completion_tokens 9352, total_tokens 1443735, cached_tokens 1349248, reasoning_tokens 4399
- **20260911T180413Z-devloop-no-note**(no-note):PASS — reference test passed (6/6); no new identified failure in the controlled suite (560 tests over 40 original test file(s) plus the reference); 3 baseline failure(s) still failing; note: the model's own tests (1 added or rewritten file(s)): 2/2 pass (recorded, not a verdict input)
  受控套件:560 项,失败 3,新增失败 0,基线失败仍在 3/3;原测试 40/40 在,改写 0,新增 1;模型自测 2/2(只记不判)
  尝试:none: collect-artifacts.test.mjs carries no bt- marker ok=true call=call_00_ET_Dzocj1CnVdQtsZpcJvqT3113 added test file evaluation/attribution/collect-artifacts.test.mjs has no marker in its name or test titles
  检索词:"CodeBuddy 工具结果 退出状态 exit code 解析 capture 归因", "provenance capture tool result exit status parsing regression", "工具结果格式 Exit code Stderr 退出码 null", "collect artifacts operation list failed call classification exit status envelope format"
  成本:turns 29, responses_with_usage 29, wall_seconds 121, system_prompt_chars 22229, prompt_tokens 1673891, completion_tokens 15072, total_tokens 1688963, cached_tokens 1611520, reasoning_tokens 7944
- **20260911T180614Z-devloop-no-note**(no-note):PASS — reference test passed (6/6); no new identified failure in the controlled suite (560 tests over 40 original test file(s) plus the reference); 3 baseline failure(s) still failing; note: the model's own tests (1 added or rewritten file(s)): 1/1 pass (recorded, not a verdict input)
  受控套件:560 项,失败 3,新增失败 0,基线失败仍在 3/3;原测试 40/40 在,改写 0,新增 1;模型自测 1/1(只记不判)
  尝试:none: collect-artifacts.test.mjs carries no bt- marker ok=true call=call_00_ET_frvmSOR7RRP8aXdUzVUw3422 added test file evaluation/attribution/collect-artifacts.test.mjs has no marker in its name or test titles
  检索词:"工具结果 退出状态 exit_code capture 归因 collect artifacts", "CodeBuddy 工具结果 解析 退出码", "governance eval gate probe attribution devloop"
  成本:turns 19, responses_with_usage 19, wall_seconds 86, system_prompt_chars 22229, prompt_tokens 1162969, completion_tokens 9301, total_tokens 1172270, cached_tokens 1095808, reasoning_tokens 4521

## 迁移:笔记写的是另一个文件,这里用上了吗

有笔记组尚未运行;无笔记组 2 次,通过 2,判别值出现 0 次。

## 闸门对 v2 的判定:两个任务、两个消费者用户

本版本上的运行:本任务 2 次(用户 c),第一任务 0 次(无);旧版本的结果行按版本绑定不计入(闸门报 other_version)。
- 观察 2026-09-11T17:56:52Z[after rotation to v2 (value burned by the 2026-09-11 records); before any run]:status candidate v2,gate pending(decided_at 2026-09-11T17:56:50.752Z),evidence_revision 6

## 计数(只描述这些运行)

- 正式样本 2:无笔记 2(PASS 2),有笔记 0(PASS 0);作废 1,试跑 2。
- 有笔记组送达 0、采用且通过 0、采用待复核 0;无笔记组判别值出现 0。
- 记忆通道:3 次干净,0 次有借入,1 次不可判。

## 剩余缺点

- 两个任务共享起点提交与笔记,任务文本各自只描述症状;第二任务的症状描述(exit_code 总是 null)比第一任务更接近缺陷位置,迁移难度因此偏低
- 样本各 2 次、单模型(deepseek-v4-flash)、单操作者;有笔记组的判别值是采用证据,不是收益证据
- 副本里已有正确实现可参照;笔记缩短定位,不是唯一答案
- 闸门的 distinct_consumers=2 / distinct_tasks=2 是关系计数;两个用户由同一人操作,独立性不成立
