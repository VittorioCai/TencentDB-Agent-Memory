# 开发闭环 `exit-code-fix`:运行报告(脚本生成)

生成命令:`node evaluation/tasks/exit-code-fix/report.mjs`;数据范围:`evaluation/tasks/exit-code-fix/devloop-runs.json` 列出的 3 次运行(正式样本 0 次,冒烟 1 次,作废留档 2 次);
判据版本:repo-2026-09-11b, repo-2026-09-11c;笔记 skl-pXLc38dex6Zt(eval-tool-result-exit-line v1,仓库只存 sha256 d3d4dd1bd6a4…)。

## 这份数字测的是什么,不是什么

- 测的是:同一缺陷任务在"笔记对消费者不可见(candidate)"与"笔记已准入(approved)"两种池状态下,各跑若干次,模型改出的仓库副本能否通过与两组完全相同的功能验收;笔记是否送达、是否被采用(新增测试的文件名/标题带笔记的判别值,并关联到写入它的调用)、采用后的结果判定;每次运行的消费者是否新建、记忆通道是否读到借入的记忆。
- 不是:两组的性能对照。样本极小,先无笔记后有笔记只用于闭环演示,不作为闸门或笔记收益的估计。
- 仓库内已有正确实现可参照(起点副本的 `evaluation/gate0/verify-capture.mjs` 正确读退出行并通用解析 curl 错误行,见 conditions.json 的 known_hints_in_tracked_files),**笔记的作用是缩短定位而非提供唯一答案**;无笔记组通过并不说明笔记无用,有笔记组通过也不说明是笔记的功劳——采用与否只看 attempts 与 used 事件。
- 判据保守在哪:验收只认验证器自带的参考测试与起点测试的原内容;模型自报的测试结果不采信;模型新增的测试另记不进判决。未知项:送达/采用事件缺失时记"?",不折成 0。

## 每次运行

| 序 | 组 | run_id | 消费者(新建) | proxy 解析到的 agent | 开跑时笔记状态 | 笔记送达事件 | 采用 used / 待复核 | 结果判定 | 验收 | 尝试值 | 改动文件 | 模型自测 | 记忆通道 ok | 起点后提交 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | smoke(冒烟) | 20260911T135759Z-devloop-smoke | agt-hnqxin11n9 | agt-hnqxin11n9 | candidate | 无 | 0 / 0 | 无 | PASS | none: no test file was added | M evaluation/tasks/bridge-addr/verify.mjs; M evaluation/tasks/bridge-addr/verify.test.mjs | 未加 | 是 | 0 |
| 1 | no-note(作废:任务文本改动前) | 20260911T140427Z-devloop-no-note | agt-hn1pxo9rcm | agt-hn1pxo9rcm | candidate | 无 | 0 / 0 | 无 | PASS | none: no test file was added; 1 test(s) added to existing file(s) carry no bt- marker | M evaluation/tasks/bridge-addr/verify.mjs; M evaluation/tasks/bridge-addr/verify.test.mjs | 22/22 | 是 | 0 |
| 2 | no-note(作废:任务文本改动前) | 20260911T140806Z-devloop-no-note | agt-hn7snfdspu | agt-hn7snfdspu | candidate | 无 | 0 / 0 | 无 | FAIL | none: no test file was added; 1 test(s) added to existing file(s) carry no bt- marker | M evaluation/tasks/bridge-addr/verify.mjs; M evaluation/tasks/bridge-addr/verify.test.mjs | 22/22 | 是 | 0 |

## 验收明细

| run_id | 参考测试 | 参考测试失败项 | 受控套件 | 新增失败 | 基线失败仍在 | 原测试缺失 / 被改写 / 模型新增 | 验收理由 |
|---|---|---|---|---|---|---|---|
| 20260911T135759Z-devloop-smoke | 7/7 | 无 | OK | 0 | 3/3 | 0 / 1 / 0 | reference test passed (7/7); no new identified failure in the controlled suite (561 tests over 40 original test file(s) plus the reference); 3 baseline failure(s) still failing; note: the model changed 1 original test file(s) (evaluation/tasks/bridge-addr/verify.test.mjs); the controlled suite ran their original content |
| 20260911T140427Z-devloop-no-note | 7/7 | 无 | OK | 0 | 3/3 | 0 / 1 / 0 | reference test passed (7/7); no new identified failure in the controlled suite (561 tests over 40 original test file(s) plus the reference); 3 baseline failure(s) still failing; note: the model changed 1 original test file(s) (evaluation/tasks/bridge-addr/verify.test.mjs); the controlled suite ran their original content; the model's own tests (1 added or rewritten file(s)): 22/22 pass (recorded, not a verdict input) |
| 20260911T140806Z-devloop-no-note | 6/7 | a non-zero exit status, as CodeBuddy spells it, is a failure | REGRESSED | 1 | 3/3 | 0 / 1 / 0 | the verifier's reference regression test does not pass (1 failing); note: the model changed 1 original test file(s) (evaluation/tasks/bridge-addr/verify.test.mjs); the controlled suite ran their original content; the model's own tests (1 added or rewritten file(s)): 22/22 pass (recorded, not a verdict input) |

参考测试(验证器自带,两组相同)共 7 例:大写退出行的超时(28)、大写退出行的非零退出码(52/56)、小写拼写仍可读、退出 0 + code 0 信封、退出 0 + 非零信封、退出 0 无输出保持不可读、stderr 里的连接失败。**笔记正文列出了 52/56,而任务文本只描述超时;因此有笔记组在"非零退出码"一例上的通过,包含"笔记披露了验收覆盖范围"的成分,不能只记为定位更快。** 根因修复(退出行的标签按两种拼写读,一行正则)同时覆盖超时与非零退出码两类情形;只把超时分支改成认大写、不改退出码读取的修复是治标,会在"非零退出码"一例上失败。本清单里:参考测试 7/7(根因修复)2 次(smoke 20260911T135759Z-devloop-smoke; no-note作废 20260911T140427Z-devloop-no-note);只过超时、不过非零退出码(治标)1 次(no-note作废 20260911T140806Z-devloop-no-note);其他参考失败 0 次。

## 消费者与记忆隔离

| run_id | 消费者 | 创建时足迹(profile/records/buffer) | proxy 配置 sha 前→后 | 备份 | 记忆读取次数 | 读回项 | 早于开跑 | 他 agent 的 | 无日期 | ok |
|---|---|---|---|---|---|---|---|---|---|---|
| 20260911T135759Z-devloop-smoke | agt-hnqxin11n9 | 0/0/0 | 76428b8b→52aa8777 | deploy/global-images/.proxy-config/config.yaml.bak-20260911T135759Z-devloop-smoke | 0 | 0 | 0 | 0 | 0 | 是 |
| 20260911T140427Z-devloop-no-note | agt-hn1pxo9rcm | 0/0/0 | 52aa8777→fbfc8e76 | deploy/global-images/.proxy-config/config.yaml.bak-20260911T140427Z-devloop-no-note | 0 | 0 | 0 | 0 | 0 | 是 |
| 20260911T140806Z-devloop-no-note | agt-hn7snfdspu | 0/0/0 | fbfc8e76→f102ed3e | deploy/global-images/.proxy-config/config.yaml.bak-20260911T140806Z-devloop-no-note | 0 | 0 | 0 | 0 | 0 | 是 |

## 新经验回流候选池

尚未执行(write-back.mjs 未对任何运行调用)。

## 笔记的准入是实验干预,不是闸门批准

笔记 skl-pXLc38dex6Zt 的闸门判定始终 pending;有笔记组之前由管理员置 approved 是实验准备动作,跑完即置回 candidate,报告不把它读作闸门批准;闸门判定待新经验回流(5e)后由证据驱动。驱动脚本每次调用记录的状态观测(0 条):无。

任务文本改动 1 次:2026-09-11T14:42:48Z added: 本仓库所属团队把过往经验以 skill 形式保存在团队知识库中。动手之前先检索一次团队经验,有相关的就参考,没有就按自己的判断做。(原因:three runs with zero skill_search showed the injected skill_tools hint alone does not lead to a search; the sentence describes environment and workflow only, no defect information; same text for both arms;作废运行 20260911T140427Z-devloop-no-note, 20260911T140806Z-devloop-no-note)。

## 计数(只描述这些运行)

- no-note:0 次正式样本。
- note:0 次正式样本。

差异仅描述这些运行,不作为闸门或笔记收益的无偏或保守估计。

## 剩余缺点

- 跨运行隔离尚未成立(批次四层面);本闭环改为每次运行新建消费者,只对这几次运行有效
- 解析修正后的统计未确认;正式样本分母已修正但需复核
- 开发闭环与交付验证待完成:本报告只覆盖清单里的运行
- 小样本、单场景、单主体、单模型;采纳证据覆盖率 0.95(批次四)
- 仓库内已有正确实现可参照:笔记的作用是缩短定位而非提供唯一答案;两组差异不能归于笔记
- 模型自报测试结果不采信,验收只认验证器自带参考测试与起点测试原内容;模型新增的测试另记
- 笔记正文列出 52/56、任务文本只描述超时:有笔记组在非零退出码一例上的通过含'笔记披露了验收覆盖范围'成分
- 团队资产只在模型主动 skill_search 时送达;task.md 已加一句团队经验可检索(两组同文,改动前的运行作废留档),送达与否仍按事件如实报
- 笔记的 approved 状态是实验干预,跑完置回 candidate;闸门判定 pending,待回流后由证据驱动
- 回流走产品的 /v3/skill/extract,提取内容由 Core 决定;是否产生资产、状态为何,以 write-back.json 为准

