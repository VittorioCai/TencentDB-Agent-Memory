# 开发闭环第二任务 `exit-line-collect`:运行报告(脚本生成)

生成于 2026-09-11T23:37:09Z;清单 `evaluation/tasks/exit-line-collect/devloop-runs.json`;运行 13 次(正式样本 6,作废 7)。
笔记 skl-pXLc38dex6Zt(eval-tool-result-exit-line v2,仓库只存 sha256 1e85dcf5dcf7…);v1 于 2026-09-11T17:55:11Z 退役(值已进 git 历史),本任务所有运行都在 v2 上。
判据版本:repo-2026-09-11d;起点提交 141c044(与 exit-code-fix 相同),任务文本 sha256 f32af00888d3…。

## 这份数字测的是什么,不是什么

- 测的是**迁移**:笔记正文写的是 `evaluation/tasks/bridge-addr/verify.mjs` 的退出行拼写,本任务的缺陷在 `evaluation/attribution/collect-artifacts.mjs`。有笔记组里"检索到笔记 → 新增带判别值的测试 → 参考测试通过"三件事同时成立才算迁移成功;缺任何一件按缺的那件记。
- 副本里已有正确实现可参照(evaluation/gate0/verify-capture.mjs、evaluation/gate0/verify-capture.test.mjs、evaluation/runner/memory-channel.test.mjs、evaluation/tasks/bridge-addr/verify.multi-target.test.mjs、evaluation/tasks/bridge-name/verify.test.mjs),笔记的作用是缩短定位而非提供唯一答案。
- 消费者用户是 c(零记录),与第一任务的 b 不同;两个用户仍由同一个人操作。闸门看到的 `distinct_consumers` / `distinct_tasks` 是关系计数,不是独立的人数。
- 无笔记 / 有笔记各 2 / 4 次,只用于演示,不是性能对照。模型自报的测试结果不采信;判决只读副本。

## 每次运行

| 组 | run | 消费者(用户) | 会话绑定的任务实体 | 笔记状态@开跑 | 判决 | 参考测试 | 检索次数 / 笔记返回 | 送达事件 | used / needs_review | 尝试值 | 改动文件 | 记忆通道 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| smoke(作废) | 20260911T175839Z-devloop-smoke | agt-hyv1cffnme(usr-8ypylzex49) | ? | candidate v2 team | ? | ? | ? / 未知 | 未知 | ? / ? | 无 | 无 | 未知 |
| smoke(作废) | 20260911T180035Z-devloop-smoke | agt-hyy95lvov6(usr-8ypylzex49) | task-5e6xp4mrrw | candidate v2 team | PASS | 6/6 | 4 / 否 | 无 | 0 / 0 | none: collect-artifacts.test.mjs carries no bt- marker | M evaluation/attribution/collect-artifacts.mjs; A evaluation/attribution/collect-artifacts.test.mjs | 是 |
| no-note(作废) | 20260911T180413Z-devloop-no-note | agt-hy5bxf99k6(usr-8ypylzex49) | task-5e6xp4mrrw | candidate v2 team | PASS | 6/6 | 8 / 否 | 无 | 0 / 0 | none: collect-artifacts.test.mjs carries no bt- marker | M evaluation/attribution/collect-artifacts.mjs; A evaluation/attribution/collect-artifacts.test.mjs | 是 |
| no-note(作废) | 20260911T180614Z-devloop-no-note | agt-hy8ov81zak(usr-8ypylzex49) | task-5e6xp4mrrw | candidate v2 team | PASS | 6/6 | 4 / 否 | 无 | 0 / 0 | none: collect-artifacts.test.mjs carries no bt- marker | M evaluation/attribution/collect-artifacts.mjs; A evaluation/attribution/collect-artifacts.test.mjs | 是 |
| note(作废) | 20260911T184529Z-devloop-note | agt-h013oal8pr(usr-8ypylzex49) | task-5e6xp4mrrw | approved v2 team | PASS | 6/6 | 2 / 是 | 无 | 0 / 0 | bt-78yk9r3bfrm | M evaluation/attribution/collect-artifacts.mjs; A evaluation/attribution/collect-artifacts.test.mjs | 是 |
| note(作废) | 20260911T184634Z-devloop-note | agt-h03w2w957t(usr-8ypylzex49) | task-5e6xp4mrrw | approved v2 team | PASS | 6/6 | 3 / 是 | 无 | 0 / 0 | none: collect-artifacts.test.mjs carries no bt- marker | M evaluation/attribution/collect-artifacts.mjs; A evaluation/attribution/collect-artifacts.test.mjs | 是 |
| note(作废) | 20260911T185010Z-devloop-note | agt-h09w1egyxz(usr-8ypylzex49) | ? | approved v2 team | PASS | 6/6 | 2 / 是 | 无 | ? / ? | bt-78yk9r3bfrm | A evaluation/attribution/collect-artifacts.exit-status.bt-78yk9r3bfrm.test.mjs; M evaluation/attribution/collect-artifacts.mjs | 未知 |
| note | 20260911T185119Z-devloop-note | agt-h1bt18emo7(usr-8ypylzex49) | task-5e6xp4mrrw | approved v2 team | PASS | 6/6 | 2 / 是 | fetched 1, injected 1, recalled 1 | 2 / 2 | bt-78yk9r3bfrm | A evaluation/attribution/collect-artifacts.exit-status.bt-78yk9r3bfrm.test.mjs; M evaluation/attribution/collect-artifacts.mjs | 是 |
| note | 20260911T185430Z-devloop-note | agt-h1g433x4jd(usr-8ypylzex49) | task-5e6xp4mrrw | approved v2 team | PASS | 6/6 | 2 / 是 | fetched 1, injected 1, recalled 1 | 0 / 2 | bt-78yk9r3bfrm | M evaluation/attribution/collect-artifacts.mjs; A evaluation/attribution/collect-artifacts.test.mjs | 是 |
| note | 20260911T185811Z-devloop-note | agt-h1m9wf3gw2(usr-8ypylzex49) | task-h1k7xruuhb | approved v2 team | PASS | 6/6 | 2 / 是 | fetched 1, injected 1, recalled 1 | 1 / 1 | bt-78yk9r3bfrm | A evaluation/attribution/collect-artifacts.exit-status.test.mjs; M evaluation/attribution/collect-artifacts.mjs | 是 |
| note | 20260911T185927Z-devloop-note | agt-h1pdy43iwu(usr-8ypylzex49) | task-h1k7xruuhb | approved v2 team | PASS | 6/6 | 2 / 是 | fetched 1, injected 1, recalled 1 | 2 / 2 | bt-78yk9r3bfrm | M evaluation/attribution/collect-artifacts.mjs; A evaluation/attribution/collect-artifacts.test.mjs | 是 |
| no-note | 20260911T190408Z-devloop-no-note | agt-h1w6wgvhfu(usr-8ypylzex49) | task-h1k7xruuhb | candidate v2 team | PASS | 6/6 | 3 / 否 | 无 | 0 / 0 | none: collect-artifacts.test.mjs carries no bt- marker | M evaluation/attribution/collect-artifacts.mjs; A evaluation/attribution/collect-artifacts.test.mjs | 是 |
| no-note | 20260911T190605Z-devloop-no-note | agt-h10fmja5kp(usr-8ypylzex49) | task-h1k7xruuhb | candidate v2 team | PASS | 6/6 | 5 / 否 | 无 | 0 / 0 | none: collect-artifacts.test.mjs carries no bt- marker | M evaluation/attribution/collect-artifacts.mjs; A evaluation/attribution/collect-artifacts.test.mjs | 是 |

## 验收明细

- **20260911T175839Z-devloop-smoke**(smoke,作废):? — ?
- **20260911T180035Z-devloop-smoke**(smoke,作废):PASS — reference test passed (6/6); no new identified failure in the controlled suite (560 tests over 40 original test file(s) plus the reference); 3 baseline failure(s) still failing; note: the model's own tests (1 added or rewritten file(s)): 3/3 pass (recorded, not a verdict input)
  受控套件:560 项,失败 3,新增失败 0,基线失败仍在 3/3;原测试 40/40 在,改写 0,新增 1;模型自测 3/3(只记不判)
  尝试:none: collect-artifacts.test.mjs carries no bt- marker ok=true call=call_00_ET_m8NXO0Zz0qZ2MOB8Fxb84906 added test file evaluation/attribution/collect-artifacts.test.mjs has no marker in its name or test titles
  检索词:"解析工具结果 退出状态 exit_code capture 归因", "工具结果格式 exit status 正则 解析", "capture 解析 工具调用 测试 归因 evaluation", "CodeBuddy tool result exit code 格式"
  成本:turns 19, responses_with_usage 19, wall_seconds 90, system_prompt_chars 22225, prompt_tokens 1434383, completion_tokens 9352, total_tokens 1443735, cached_tokens 1349248, reasoning_tokens 4399
- **20260911T180413Z-devloop-no-note**(no-note,作废):PASS — reference test passed (6/6); no new identified failure in the controlled suite (560 tests over 40 original test file(s) plus the reference); 3 baseline failure(s) still failing; note: the model's own tests (1 added or rewritten file(s)): 2/2 pass (recorded, not a verdict input)
  受控套件:560 项,失败 3,新增失败 0,基线失败仍在 3/3;原测试 40/40 在,改写 0,新增 1;模型自测 2/2(只记不判)
  尝试:none: collect-artifacts.test.mjs carries no bt- marker ok=true call=call_00_ET_Dzocj1CnVdQtsZpcJvqT3113 added test file evaluation/attribution/collect-artifacts.test.mjs has no marker in its name or test titles
  检索词:"CodeBuddy 工具结果 退出状态 exit code 解析 capture 归因", "provenance capture tool result exit status parsing regression", "工具结果格式 Exit code Stderr 退出码 null", "collect artifacts operation list failed call classification exit status envelope format"
  成本:turns 29, responses_with_usage 29, wall_seconds 121, system_prompt_chars 22229, prompt_tokens 1673891, completion_tokens 15072, total_tokens 1688963, cached_tokens 1611520, reasoning_tokens 7944
- **20260911T180614Z-devloop-no-note**(no-note,作废):PASS — reference test passed (6/6); no new identified failure in the controlled suite (560 tests over 40 original test file(s) plus the reference); 3 baseline failure(s) still failing; note: the model's own tests (1 added or rewritten file(s)): 1/1 pass (recorded, not a verdict input)
  受控套件:560 项,失败 3,新增失败 0,基线失败仍在 3/3;原测试 40/40 在,改写 0,新增 1;模型自测 1/1(只记不判)
  尝试:none: collect-artifacts.test.mjs carries no bt- marker ok=true call=call_00_ET_frvmSOR7RRP8aXdUzVUw3422 added test file evaluation/attribution/collect-artifacts.test.mjs has no marker in its name or test titles
  检索词:"工具结果 退出状态 exit_code capture 归因 collect artifacts", "CodeBuddy 工具结果 解析 退出码", "governance eval gate probe attribution devloop"
  成本:turns 19, responses_with_usage 19, wall_seconds 86, system_prompt_chars 22229, prompt_tokens 1162969, completion_tokens 9301, total_tokens 1172270, cached_tokens 1095808, reasoning_tokens 4521
- **20260911T184529Z-devloop-note**(note,作废):PASS — reference test passed (6/6); no new identified failure in the controlled suite (560 tests over 40 original test file(s) plus the reference); 3 baseline failure(s) still failing; note: the model's own tests (1 added or rewritten file(s)): 3/3 pass (recorded, not a verdict input)
  受控套件:560 项,失败 3,新增失败 0,基线失败仍在 3/3;原测试 40/40 在,改写 0,新增 1;模型自测 3/3(只记不判)
  尝试:bt-78yk9r3bfrm ok=true call=call_00_iuIEC02HqQXZbrI2ZeZ84255 bt-78yk9r3bfrm in the test title of the added test file evaluation/attribution/collect-artifacts.test.mjs; written by call call_00_iuIEC02HqQXZbrI2ZeZ84255 (Write, message 17)
  检索词:"attribution collect artifacts exit_code 工具结果 解析"
  成本:turns 15, responses_with_usage 15, wall_seconds 65, system_prompt_chars 22223, prompt_tokens 601508, completion_tokens 6668, total_tokens 608176, cached_tokens 562048, reasoning_tokens 3356
- **20260911T184634Z-devloop-note**(note,作废):PASS — reference test passed (6/6); no new identified failure in the controlled suite (560 tests over 40 original test file(s) plus the reference); 3 baseline failure(s) still failing; note: the model's own tests (1 added or rewritten file(s)): 4/4 pass (recorded, not a verdict input)
  受控套件:560 项,失败 3,新增失败 0,基线失败仍在 3/3;原测试 40/40 在,改写 0,新增 1;模型自测 4/4(只记不判)
  尝试:none: collect-artifacts.test.mjs carries no bt- marker ok=true call=call_00_vsaLdKkM0q5coUzRS5Hm1769 added test file evaluation/attribution/collect-artifacts.test.mjs has no marker in its name or test titles
  检索词:"CodeBuddy 工具结果 退出状态 exit_code 解析 归因 capture"
  成本:turns 15, responses_with_usage 15, wall_seconds 72, system_prompt_chars 22223, prompt_tokens 699732, completion_tokens 8889, total_tokens 708621, cached_tokens 652416, reasoning_tokens 5275
- **20260911T185010Z-devloop-note**(note,作废):PASS — reference test passed (6/6); no new identified failure in the controlled suite (560 tests over 40 original test file(s) plus the reference); 3 baseline failure(s) still failing; note: the model's own tests (1 added or rewritten file(s)): 1/1 pass (recorded, not a verdict input)
  受控套件:560 项,失败 3,新增失败 0,基线失败仍在 3/3;原测试 40/40 在,改写 0,新增 1;模型自测 1/1(只记不判)
  尝试:bt-78yk9r3bfrm ok=true call=call_00_ET_MxGUXg00xcbT1CBb3LQ70832 bt-78yk9r3bfrm in the file name and test title of the added test file evaluation/attribution/collect-artifacts.exit-status.bt-78yk9r3bfrm.test.mjs; written by call call_00_ET_MxGUXg00xcbT1CBb3LQ70832 (Write, message 21)
  检索词:"collect-artifacts capture exit_code 工具结果 退出状态 归因"
- **20260911T185119Z-devloop-note**(note):PASS — reference test passed (6/6); no new identified failure in the controlled suite (560 tests over 40 original test file(s) plus the reference); 3 baseline failure(s) still failing; note: the model's own tests (1 added or rewritten file(s)): 2/2 pass (recorded, not a verdict input)
  受控套件:560 项,失败 3,新增失败 0,基线失败仍在 3/3;原测试 40/40 在,改写 0,新增 1;模型自测 2/2(只记不判)
  尝试:bt-78yk9r3bfrm ok=true call=call_00_CVWhmo1kFCv8Dfj2NfOQ0304 bt-78yk9r3bfrm in the file name and test title of the added test file evaluation/attribution/collect-artifacts.exit-status.bt-78yk9r3bfrm.test.mjs; written by call call_00_CVWhmo1kFCv8Dfj2NfOQ0304 (Write, message 49)
  结果行:validated ← Write /private/tmp/topic4-sessions/20260911T185119Z-devloop-note.1pXe/session/evaluation/attribu — the call it fed succeeded (reference test passed on the changed copy) and the run's acceptance passed (reference test passed on the changed copy)
  结果行:needs_review ← Bash cd /private/tmp/topic4-sessions/20260911T185119Z-devloop-note.1pXe/session && node --test  — the token appeared in an operation that was not an acceptance attempt, so no outcome can be tied to it
  used 行:needs_review — token bt-78yk9r3bfrm; the token appears in a search command — the model was looking for it, not using it
  used 行:used — token bt-78yk9r3bfrm; content of v2 entered the context at message 6, before this operation at message 49
  used 行:used — token bt-78yk9r3bfrm; content of v2 entered the context at message 6, before this operation at message 55
  used 行:needs_review — token bt-78yk9r3bfrm; the token first reached the model at message 6 via Command: curl -sSk -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/get-by-name -H 'content-type: application/json' -H 'x-tdai-service-id: defau
  检索词:"capture 工具结果 退出状态 exit_code 归因 解析"
  成本:turns 27, responses_with_usage 27, wall_seconds 138, system_prompt_chars 22223, prompt_tokens 1474584, completion_tokens 19984, total_tokens 1494568, cached_tokens 1423872, reasoning_tokens 14000
- **20260911T185430Z-devloop-note**(note):PASS — reference test passed (6/6); no new identified failure in the controlled suite (560 tests over 40 original test file(s) plus the reference); 3 baseline failure(s) still failing; note: the model's own tests (1 added or rewritten file(s)): 5/5 pass (recorded, not a verdict input)
  受控套件:560 项,失败 3,新增失败 0,基线失败仍在 3/3;原测试 40/40 在,改写 0,新增 1;模型自测 5/5(只记不判)
  尝试:bt-78yk9r3bfrm ok=true call=call_00_wFQ86d95Szp0AQZgfwbP6195 bt-78yk9r3bfrm in the test title of the added test file evaluation/attribution/collect-artifacts.test.mjs; written by call call_00_wFQ86d95Szp0AQZgfwbP6195 (Write, message 44)
  used 行:needs_review — token bt-78yk9r3bfrm; the token appears in a search command — the model was looking for it, not using it
  used 行:needs_review — token bt-78yk9r3bfrm; the token first reached the model at message 6 via Command: curl -sSk -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/get-by-name -H 'content-type: application/json' -H 'x-tdai-service-id: defau
  检索词:"exit code 工具结果 capture 归因 artifact 解析"
  成本:turns 24, responses_with_usage 24, wall_seconds 89, system_prompt_chars 22223, prompt_tokens 1091239, completion_tokens 9580, total_tokens 1100819, cached_tokens 1044352, reasoning_tokens 4704
- **20260911T185811Z-devloop-note**(note):PASS — reference test passed (6/6); no new identified failure in the controlled suite (560 tests over 40 original test file(s) plus the reference); 3 baseline failure(s) still failing; note: the model's own tests (1 added or rewritten file(s)): 3/3 pass (recorded, not a verdict input)
  受控套件:560 项,失败 3,新增失败 0,基线失败仍在 3/3;原测试 40/40 在,改写 0,新增 1;模型自测 3/3(只记不判)
  尝试:bt-78yk9r3bfrm ok=true call=call_00_hnMQhIVj58bS6Lu9pHse9735 bt-78yk9r3bfrm in the test title of the added test file evaluation/attribution/collect-artifacts.exit-status.test.mjs; written by call call_00_hnMQhIVj58bS6Lu9pHse9735 (Write, message 24)
  结果行:validated ← Write /private/tmp/topic4-sessions/20260911T185811Z-devloop-note.XQBz/session/evaluation/attribu — the call it fed succeeded (reference test passed on the changed copy) and the run's acceptance passed (reference test passed on the changed copy)
  used 行:used — token bt-78yk9r3bfrm; content of v2 entered the context at message 6, before this operation at message 24
  used 行:needs_review — token bt-78yk9r3bfrm; the token first reached the model at message 6 via Command: curl -sSk -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/get-by-name -H 'content-type: application/json' -H 'x-tdai-service-id: defau
  检索词:"collect-artifacts exit_code 工具结果 退出状态 归因"
  成本:turns 19, responses_with_usage 19, wall_seconds 75, system_prompt_chars 22563, prompt_tokens 810304, completion_tokens 7347, total_tokens 817651, cached_tokens 766848, reasoning_tokens 3237
- **20260911T185927Z-devloop-note**(note):PASS — reference test passed (6/6); no new identified failure in the controlled suite (560 tests over 40 original test file(s) plus the reference); 3 baseline failure(s) still failing; note: the model's own tests (1 added or rewritten file(s)): 5/5 pass (recorded, not a verdict input)
  受控套件:560 项,失败 3,新增失败 0,基线失败仍在 3/3;原测试 40/40 在,改写 0,新增 1;模型自测 5/5(只记不判)
  尝试:bt-78yk9r3bfrm ok=true call=call_00_Lf2EC7uc1RWloW24iwxR5255 bt-78yk9r3bfrm in the test title of the added test file evaluation/attribution/collect-artifacts.test.mjs; written by call call_00_Lf2EC7uc1RWloW24iwxR5255 (Write, message 33)
  结果行:validated ← Write /private/tmp/topic4-sessions/20260911T185927Z-devloop-note.57Bp/session/evaluation/attribu — the call it fed succeeded (reference test passed on the changed copy) and the run's acceptance passed (reference test passed on the changed copy)
  结果行:needs_review ← Write /Users/vittoriocai/.codebuddy/projects/private-tmp-topic4-sessions-20260911T185927Z-devloo — the token appeared in an operation that was not an acceptance attempt, so no outcome can be tied to it
  used 行:needs_review — token bt-78yk9r3bfrm; the token appears in a search command — the model was looking for it, not using it
  used 行:used — token bt-78yk9r3bfrm; content of v2 entered the context at message 9, before this operation at message 33
  used 行:used — token bt-78yk9r3bfrm; content of v2 entered the context at message 9, before this operation at message 49
  used 行:needs_review — token bt-78yk9r3bfrm; the token first reached the model at message 9 via Command: curl -sSk -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/get-by-name -H 'content-type: application/json' -H 'x-tdai-service-id: defau
  检索词:"CodeBuddy 工具结果 退出状态 exit_code 解析 capture 归因"
  成本:turns 22, responses_with_usage 22, wall_seconds 100, system_prompt_chars 22563, prompt_tokens 1084582, completion_tokens 12401, total_tokens 1096983, cached_tokens 1036288, reasoning_tokens 6859
- **20260911T190408Z-devloop-no-note**(no-note):PASS — reference test passed (6/6); no new identified failure in the controlled suite (560 tests over 40 original test file(s) plus the reference); 3 baseline failure(s) still failing; note: the model's own tests (1 added or rewritten file(s)): 3/3 pass (recorded, not a verdict input)
  受控套件:560 项,失败 3,新增失败 0,基线失败仍在 3/3;原测试 40/40 在,改写 0,新增 1;模型自测 3/3(只记不判)
  尝试:none: collect-artifacts.test.mjs carries no bt- marker ok=true call=call_00_XLlRp6qsSlziWQh2Bxkj7921 added test file evaluation/attribution/collect-artifacts.test.mjs has no marker in its name or test titles
  检索词:"工具结果 退出状态 exit code 解析 capture 归因", "capture 会话 工具结果 解析 测试"
  成本:turns 27, responses_with_usage 27, wall_seconds 116, system_prompt_chars 22569, prompt_tokens 1741258, completion_tokens 15190, total_tokens 1756448, cached_tokens 1672704, reasoning_tokens 8993
- **20260911T190605Z-devloop-no-note**(no-note):PASS — reference test passed (6/6); no new identified failure in the controlled suite (560 tests over 40 original test file(s) plus the reference); 3 baseline failure(s) still failing; note: the model's own tests (1 added or rewritten file(s)): 3/3 pass (recorded, not a verdict input)
  受控套件:560 项,失败 3,新增失败 0,基线失败仍在 3/3;原测试 40/40 在,改写 0,新增 1;模型自测 3/3(只记不判)
  尝试:none: collect-artifacts.test.mjs carries no bt- marker ok=true call=call_00_ET_evIMYcaQcPWZ6XYapJYd0370 added test file evaluation/attribution/collect-artifacts.test.mjs has no marker in its name or test titles
  检索词:"parse exit status tool result exit_code collect artifacts", "capture tool result 退出状态 exit code 归因 attribution", "Bash tool result envelope Command Stdout Stderr Signal parse format"
  成本:turns 23, responses_with_usage 23, wall_seconds 99, system_prompt_chars 22569, prompt_tokens 1152306, completion_tokens 13519, total_tokens 1165825, cached_tokens 1099648, reasoning_tokens 7450

## 迁移:笔记写的是另一个文件,这里用上了吗

有笔记组 4 次:送达 4,新增测试带判别值且验收通过 4,带判别值但关联不上写入调用或验收未过 0,功能验收通过 4。无笔记组 2 次:通过 2,判别值出现 0 次(判别值随机,无笔记组出现次数必须为 0 才说明标记来自笔记)。
其中 1 次(20260911T185430Z-devloop-note)验收器判"采用"(标记在新增测试里、绑到写入调用),但使用判定器把该次使用记为 needs_review(原因见验收明细的 used 行:标记在被记入的取用之前就经另一条 get-by-name 到达模型,使用与哪次送达绑定不能唯一确定)——没有结果行,不同步、闸门不计。这是审阅定的规则(关联不上就待复核),不是漏判。
按这几次运行:笔记在另一个文件的同类缺陷上被用到了(4/4),标记只在有笔记组出现。这说明的是实现路径受笔记影响,不是"没有笔记做不出来"——无笔记组通过 2/2。

## 闸门对 v2 的判定:两个任务、两个消费者用户

本版本上的运行:本任务 6 次(用户 c),第一任务 1 次(20260911T184746Z-devloop-note note PASS);旧版本的结果行按版本绑定不计入(闸门报 other_version)。
闸门的 `distinct_tasks` 数的是结果行上的产品任务实体 id(会话绑定的任务,来自 proxy 的强制身份),不是评测任务目录。本任务的样本绑定过的实体:task-5e6xp4mrrw、task-h1k7xruuhb;本任务自己的实体 task-h1k7xruuhb 于 2026-09-11T18:56:57Z 由用户 usr-8ypylzex49 创建(product-task.json),在此之前的运行绑定的是第一任务的实体 task-5e6xp4mrrw。
- 观察 2026-09-11T17:56:52Z[after rotation to v2 (value burned by the 2026-09-11 records); before any run]:status candidate v2,gate pending(decided_at 2026-09-11T17:56:50.752Z),evidence_revision 6
- 观察 2026-09-11T18:42:51Z[before the note arms on v2: is the note approved, is A's assessment on file]:status candidate v2,gate pending(decided_at 2026-09-11T18:20:18.980Z),evidence_revision 6
- 观察 2026-09-11T18:45:26Z[after the administrator set v2 approved (experimental intervention, 18:44:05Z), both assessments on file; before the note arms]:status approved v2,gate pending(decided_at 2026-09-11T18:20:18.980Z),evidence_revision 6
- 观察 2026-09-11T19:04:08Z[administrator set v2 back to candidate (19:03:08Z) for the no-note arm; evidence_revision 10]:status candidate v2,gate pending(decided_at 2026-09-11T18:20:18.980Z),evidence_revision 10
- 观察 2026-09-11T19:08:31Z[after apply (second task): status as Core holds it]:status approved v2,gate admit(decided_at 2026-09-11T19:08:30.973Z),evidence_revision 10
- 试算 2026-09-11T18:43:13Z[v2 with A's context-based assessment on file and no outcome yet: what the rule says and which review priority it gives](as_of 2026-09-11T18:30:00Z):decision **pending** → candidate;status candidate → candidate;cross_user_validated 0,distinct_consumers 0,distinct_tasks 0,corrected 0,untrusted_ignored 2,other_version 2;作者:其他资产 validated 29 / corrected 10,近期判错 1,上下文评估 medium(reading the exit status line of a CodeBuddy tool result: how the label is spelled and how an acceptance parser must read it);复核优先级 high
    - cold start: no outcome recorded for this asset yet; pending by default
    - no corrected(wrong/stale) record, so reject did not trigger
    - 2 row(s) on file are not trusted (not submitted by an admin or reviewer with call id, version and evidence) and were not read
    - 2 trusted call(s) are about other versions or contents of this asset and do not decide version 2 (b230f087c6)
    - author usr-n68ea5ythq has 1 other asset(s) judged wrong within 30 days (skl-sZFb3KatWY6m); review priority: high
- 试算 2026-09-11T18:54:56Z[v2 after one task-1 run (user B) and one task-2 run (user C) synced: what the rule sees before the last note run]:decision **admit** → approved;status approved → approved;cross_user_validated 2,distinct_consumers 2,distinct_tasks 1,corrected 0,untrusted_ignored 2,other_version 2;作者:其他资产 validated 29 / corrected 10,近期判错 1,上下文评估 medium(reading the exit status line of a CodeBuddy tool result: how the label is spelled and how an acceptance parser must read it)
    - rule admit: cross-person validated >= 1 (2 record(s)) and no corrected
    - reported signals: 2 call(s) from 4 trusted row(s), 1 distinct task(s), 2 distinct consumer(s); none is a threshold
    - 2 row(s) on file are not trusted (not submitted by an admin or reviewer with call id, version and evidence) and were not read
    - 2 trusted call(s) are about other versions or contents of this asset and do not decide version 2 (b230f087c6)
    - author usr-n68ea5ythq: 29 validated / 10 corrected on other assets (reported, not used)
    - context-based assessment on file: competence medium for "reading the exit status line of a CodeBuddy tool result: how the label is spelled and how an acceptance parser must read it" (reported, not used: the decision rests on outcomes)
- 试算 2026-09-11T19:01:40Z[v2 after the note arms: task 1 ×1 (user B, entity task-5e6xp4mrrw) and task 2 ×4 (user C; 2 under task-5e6xp4mrrw, 2 under task-h1k7xruuhb); before the no-note arm]:decision **admit** → approved;status approved → approved;cross_user_validated 4,distinct_consumers 2,distinct_tasks 2,corrected 0,untrusted_ignored 2,other_version 2;作者:其他资产 validated 29 / corrected 10,近期判错 1,上下文评估 medium(reading the exit status line of a CodeBuddy tool result: how the label is spelled and how an acceptance parser must read it)
    - rule admit: cross-person validated >= 1 (4 record(s)) and no corrected
    - reported signals: 4 call(s) from 6 trusted row(s), 2 distinct task(s), 2 distinct consumer(s); none is a threshold
    - 2 row(s) on file are not trusted (not submitted by an admin or reviewer with call id, version and evidence) and were not read
    - 2 trusted call(s) are about other versions or contents of this asset and do not decide version 2 (b230f087c6)
    - author usr-n68ea5ythq: 29 validated / 10 corrected on other assets (reported, not used)
    - context-based assessment on file: competence medium for "reading the exit status line of a CodeBuddy tool result: how the label is spelled and how an acceptance parser must read it" (reported, not used: the decision rests on outcomes)
- 试算 2026-09-11T19:08:30Z[all arms done on v2: task 1 note ×1 (B), task 2 note ×4 + no-note ×2 (C); before apply]:decision **admit** → approved;status candidate → candidate;cross_user_validated 4,distinct_consumers 2,distinct_tasks 2,corrected 0,untrusted_ignored 2,other_version 2;作者:其他资产 validated 29 / corrected 10,近期判错 1,上下文评估 medium(reading the exit status line of a CodeBuddy tool result: how the label is spelled and how an acceptance parser must read it)
    - rule admit: cross-person validated >= 1 (4 record(s)) and no corrected
    - reported signals: 4 call(s) from 6 trusted row(s), 2 distinct task(s), 2 distinct consumer(s); none is a threshold
    - 2 row(s) on file are not trusted (not submitted by an admin or reviewer with call id, version and evidence) and were not read
    - 2 trusted call(s) are about other versions or contents of this asset and do not decide version 2 (b230f087c6)
    - author usr-n68ea5ythq: 29 validated / 10 corrected on other assets (reported, not used)
    - context-based assessment on file: competence medium for "reading the exit status line of a CodeBuddy tool result: how the label is spelled and how an acceptance parser must read it" (reported, not used: the decision rests on outcomes)
- apply 2026-09-11T19:08:30Z[apply after the second task: the rule's own decision on the trusted cross-user validated rows of two users and two task entities]:decision **admit** → approved;status candidate → approved;cross_user_validated 4,distinct_consumers 2,distinct_tasks 2,corrected 0,untrusted_ignored 2,other_version 2;作者:其他资产 validated 29 / corrected 10,近期判错 1,上下文评估 medium(reading the exit status line of a CodeBuddy tool result: how the label is spelled and how an acceptance parser must read it)
    - rule admit: cross-person validated >= 1 (4 record(s)) and no corrected
    - reported signals: 4 call(s) from 6 trusted row(s), 2 distinct task(s), 2 distinct consumer(s); none is a threshold
    - 2 row(s) on file are not trusted (not submitted by an admin or reviewer with call id, version and evidence) and were not read
    - 2 trusted call(s) are about other versions or contents of this asset and do not decide version 2 (b230f087c6)
    - author usr-n68ea5ythq: 29 validated / 10 corrected on other assets (reported, not used)
    - context-based assessment on file: competence medium for "reading the exit status line of a CodeBuddy tool result: how the label is spelled and how an acceptance parser must read it" (reported, not used: the decision rests on outcomes)

## 计数(只描述这些运行)

- 正式样本 6:无笔记 2(PASS 2),有笔记 4(PASS 4);作废 7,试跑 2。
- 有笔记组送达 4、采用且通过 4、采用待复核 0;无笔记组判别值出现 0。
- 记忆通道:11 次干净,0 次有借入,2 次不可判。

## 成本(按组,cost.json 实测)

| 组 | 有 usage 的运行 | 均模型调用次数 | 均墙钟 s | 均 prompt tok | 均 total tok | 均 cached tok | 验收 PASS |
|---|---|---|---|---|---|---|---|
| no-note | 2/2 | 25.0 | 107.5 | 1446.8k | 1461.1k | 1386.2k | 2 |
| note | 4/4 | 23.0 | 100.5 | 1115.2k | 1127.5k | 1067.8k | 4 |

只用 cost.json 已有的字段(每次流式响应的 usage 块之和、会话墙钟;模型调用次数 = 带 usage 的响应数;工具调用数不在 cost.json 里,不另测)。这是两组运行的实际开销对比,不是闸门机制的成本模型——没有哪次运行单独隔离了闸门自身的开销。

## 剩余缺点

- 两个任务共享起点提交与笔记,任务文本各自只描述症状;第二任务的症状描述(exit_code 总是 null)比第一任务更接近缺陷位置,迁移难度因此偏低
- 样本各 2 次、单模型(deepseek-v4-flash)、单操作者;有笔记组的判别值是采用证据,不是收益证据
- 副本里已有正确实现可参照;笔记缩短定位,不是唯一答案
- 运行时镜像摘要在这些运行时没有冻结,而且已不可考:重建后拉到的上游 :latest(sha256:55fec3a6…)被证明不是当时的镜像(同一套挂载文件在它上面起不来,见 gate/artifacts/core-mount-accept-failure-20260912.log)。能确定的是运行时 = 当时镜像的其余文件 + 本分支挂载的 metadata 目录与 6 个 gateway/core 文件。回填与被覆盖清单见 devloop-runs.json 的 config_fixes;自 2026-09-11 起 selfcheck 把容器镜像摘要冻进 conditions.json
- 闸门的 distinct_consumers=2 / distinct_tasks=2 是关系计数;两个用户由同一人操作,独立性不成立
