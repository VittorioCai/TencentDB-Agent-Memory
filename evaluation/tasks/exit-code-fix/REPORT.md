# 开发闭环 `exit-code-fix`:运行报告(脚本生成)

生成命令:`node evaluation/tasks/exit-code-fix/report.mjs`;数据范围:`evaluation/tasks/exit-code-fix/devloop-runs.json` 列出的 9 次运行(正式样本 4 次,冒烟 1 次,作废留档 4 次);
判据版本:repo-2026-09-11b, repo-2026-09-11c, repo-2026-09-11d;2 次运行读的是仓库外复判副本(/private/tmp/topic4-rejudge/devloop-2026-09-11;原记录不改,REJUDGED.json 记代码哈希):20260911T154907Z-devloop-note 0a3043b5c578; 20260911T155035Z-devloop-note 0a3043b5c578;笔记 skl-pXLc38dex6Zt(eval-tool-result-exit-line v1,仓库只存 sha256 d3d4dd1bd6a4…)。

## 这份数字测的是什么,不是什么

- 测的是:同一缺陷任务在"笔记对消费者不可见(candidate)"与"笔记已准入(approved)"两种池状态下,各跑若干次,模型改出的仓库副本能否通过与两组完全相同的功能验收;笔记是否送达、是否被采用(新增测试的文件名/标题带笔记的判别值,并关联到写入它的调用)、采用后的结果判定;每次运行的消费者是否新建、记忆通道是否读到借入的记忆。
- 不是:两组的性能对照。样本极小,先无笔记后有笔记只用于闭环演示,不作为闸门或笔记收益的估计。
- 仓库内已有正确实现可参照(起点副本的 `evaluation/gate0/verify-capture.mjs` 正确读退出行并通用解析 curl 错误行,见 conditions.json 的 known_hints_in_tracked_files),**笔记的作用是缩短定位而非提供唯一答案**;无笔记组通过并不说明笔记无用,有笔记组通过也不说明是笔记的功劳——采用与否只看 attempts 与 used 事件。
- 判据保守在哪:验收只认验证器自带的参考测试与起点测试的原内容;模型自报的测试结果不采信;模型新增的测试另记不进判决。未知项:送达/采用事件缺失时记"?",不折成 0。

## 每次运行

| 序 | 组 | run_id | 消费者(新建) | proxy 解析到的 agent | 开跑时笔记状态/可见性 | 模型检索团队池次数 | 笔记出现在检索结果 | 笔记送达事件 | 采用 used / 待复核 | 结果判定 | 验收 | 尝试值 | 改动文件 | 模型自测 | 记忆通道 ok | 起点后提交 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | smoke(冒烟) | 20260911T135759Z-devloop-smoke | agt-hnqxin11n9 | agt-hnqxin11n9 | candidate | 1 | 否 | 无 | 0 / 0 | 无 | PASS | none: no test file was added | M evaluation/tasks/bridge-addr/verify.mjs; M evaluation/tasks/bridge-addr/verify.test.mjs | 未加 | 是 | 0 |
| 1 | no-note(作废) | 20260911T140427Z-devloop-no-note | agt-hn1pxo9rcm | agt-hn1pxo9rcm | candidate | 0 | 否 | 无 | 0 / 0 | 无 | PASS | none: no test file was added; 1 test(s) added to existing file(s) carry no bt- marker | M evaluation/tasks/bridge-addr/verify.mjs; M evaluation/tasks/bridge-addr/verify.test.mjs | 22/22 | 是 | 0 |
| 2 | no-note(作废) | 20260911T140806Z-devloop-no-note | agt-hn7snfdspu | agt-hn7snfdspu | candidate | 2 | 否 | 无 | 0 / 0 | 无 | FAIL | none: no test file was added; 1 test(s) added to existing file(s) carry no bt- marker | M evaluation/tasks/bridge-addr/verify.mjs; M evaluation/tasks/bridge-addr/verify.test.mjs | 22/22 | 是 | 0 |
| 1 | no-note | 20260911T144347Z-devloop-no-note | agt-hpvaeml21e | agt-hpvaeml21e | candidate | 3 | 否 | 无 | 0 / 0 | 无 | PASS | none: no test file was added; 1 test(s) added to existing file(s) carry no bt- marker | M evaluation/tasks/bridge-addr/verify.mjs; M evaluation/tasks/bridge-addr/verify.test.mjs | 22/22 | 是 | 0 |
| 2 | no-note | 20260911T144542Z-devloop-no-note | agt-hpyg3smf6v | agt-hpyg3smf6v | candidate | 2 | 否 | 无 | 0 / 0 | 无 | PASS | none: no test file was added; 1 test(s) added to existing file(s) carry no bt- marker | M evaluation/tasks/bridge-addr/verify.mjs; M evaluation/tasks/bridge-addr/verify.test.mjs | 22/22 | 是 | 0 |
| 1 | note(作废) | 20260911T151132Z-devloop-note | agt-hq5ik0kr3g | agt-hq5ik0kr3g | approved/private | 4 | 否 | 无 | 0 / 0 | 无 | PASS | none: no test file was added; 1 test(s) added to existing file(s) carry no bt- marker | M evaluation/tasks/bridge-addr/verify.mjs; M evaluation/tasks/bridge-addr/verify.test.mjs | 22/22 | 是 | 0 |
| 0 | note(作废) | 20260911T151342Z-devloop-note | agt-hq84sw27hy | agt-hq84sw27hy | approved/private | 0 | 否 | 无 | 0 / 0 | 无 | PASS | none: no test file was added; 1 test(s) added to existing file(s) carry no bt- marker | M evaluation/tasks/bridge-addr/verify.mjs; M evaluation/tasks/bridge-addr/verify.test.mjs | 22/22 | 是 | 0 |
| 1 | note | 20260911T154907Z-devloop-note(复判 repo-2026-09-11d) | agt-hsv5hd4ys2 | agt-hsv5hd4ys2 | approved/team | 2 | 是 | fetched 1, injected 1, recalled 1 | 2 / 1 | validated 1, needs_review 1 | PASS | bt-imczk9p69e3 | A evaluation/tasks/bridge-addr/verify.exit-status.bt-imczk9p69e3.test.mjs; M evaluation/tasks/bridge-addr/verify.mjs | 3/3 | 是 | 0 |
| 2 | note | 20260911T155035Z-devloop-note(复判 repo-2026-09-11d) | agt-hsylov19pn | agt-hsylov19pn | approved/team | 2 | 是 | fetched 1, injected 1, recalled 1 | 2 / 1 | validated 1, needs_review 1 | PASS | bt-imczk9p69e3 | A evaluation/tasks/bridge-addr/verify.exit-status.bt-imczk9p69e3.test.mjs; M evaluation/tasks/bridge-addr/verify.mjs | 3/3 | 是 | 0 |

## 验收明细

| run_id | 参考测试 | 参考测试失败项 | 受控套件 | 新增失败 | 基线失败仍在 | 原测试缺失 / 被改写 / 模型新增 | 验收理由 |
|---|---|---|---|---|---|---|---|
| 20260911T135759Z-devloop-smoke | 7/7 | 无 | OK | 0 | 3/3 | 0 / 1 / 0 | reference test passed (7/7); no new identified failure in the controlled suite (561 tests over 40 original test file(s) plus the reference); 3 baseline failure(s) still failing; note: the model changed 1 original test file(s) (evaluation/tasks/bridge-addr/verify.test.mjs); the controlled suite ran their original content |
| 20260911T140427Z-devloop-no-note | 7/7 | 无 | OK | 0 | 3/3 | 0 / 1 / 0 | reference test passed (7/7); no new identified failure in the controlled suite (561 tests over 40 original test file(s) plus the reference); 3 baseline failure(s) still failing; note: the model changed 1 original test file(s) (evaluation/tasks/bridge-addr/verify.test.mjs); the controlled suite ran their original content; the model's own tests (1 added or rewritten file(s)): 22/22 pass (recorded, not a verdict input) |
| 20260911T140806Z-devloop-no-note | 6/7 | a non-zero exit status, as CodeBuddy spells it, is a failure | REGRESSED | 1 | 3/3 | 0 / 1 / 0 | the verifier's reference regression test does not pass (1 failing); note: the model changed 1 original test file(s) (evaluation/tasks/bridge-addr/verify.test.mjs); the controlled suite ran their original content; the model's own tests (1 added or rewritten file(s)): 22/22 pass (recorded, not a verdict input) |
| 20260911T144347Z-devloop-no-note | 7/7 | 无 | OK | 0 | 3/3 | 0 / 1 / 0 | reference test passed (7/7); no new identified failure in the controlled suite (561 tests over 40 original test file(s) plus the reference); 3 baseline failure(s) still failing; note: the model changed 1 original test file(s) (evaluation/tasks/bridge-addr/verify.test.mjs); the controlled suite ran their original content; the model's own tests (1 added or rewritten file(s)): 22/22 pass (recorded, not a verdict input) |
| 20260911T144542Z-devloop-no-note | 7/7 | 无 | OK | 0 | 3/3 | 0 / 1 / 0 | reference test passed (7/7); no new identified failure in the controlled suite (561 tests over 40 original test file(s) plus the reference); 3 baseline failure(s) still failing; note: the model changed 1 original test file(s) (evaluation/tasks/bridge-addr/verify.test.mjs); the controlled suite ran their original content; the model's own tests (1 added or rewritten file(s)): 22/22 pass (recorded, not a verdict input) |
| 20260911T151132Z-devloop-note | 7/7 | 无 | OK | 0 | 3/3 | 0 / 1 / 0 | reference test passed (7/7); no new identified failure in the controlled suite (561 tests over 40 original test file(s) plus the reference); 3 baseline failure(s) still failing; note: the model changed 1 original test file(s) (evaluation/tasks/bridge-addr/verify.test.mjs); the controlled suite ran their original content; the model's own tests (1 added or rewritten file(s)): 22/22 pass (recorded, not a verdict input) |
| 20260911T151342Z-devloop-note | 7/7 | 无 | OK | 0 | 3/3 | 0 / 1 / 0 | reference test passed (7/7); no new identified failure in the controlled suite (561 tests over 40 original test file(s) plus the reference); 3 baseline failure(s) still failing; note: the model changed 1 original test file(s) (evaluation/tasks/bridge-addr/verify.test.mjs); the controlled suite ran their original content; the model's own tests (1 added or rewritten file(s)): 22/22 pass (recorded, not a verdict input) |
| 20260911T154907Z-devloop-note | 7/7 | 无 | OK | 0 | 3/3 | 0 / 0 / 1 | reference test passed (7/7); no new identified failure in the controlled suite (561 tests over 40 original test file(s) plus the reference); 3 baseline failure(s) still failing; note: the model's own tests (1 added or rewritten file(s)): 3/3 pass (recorded, not a verdict input) |
| 20260911T155035Z-devloop-note | 7/7 | 无 | OK | 0 | 3/3 | 0 / 0 / 1 | reference test passed (7/7); no new identified failure in the controlled suite (561 tests over 40 original test file(s) plus the reference); 3 baseline failure(s) still failing; note: the model's own tests (1 added or rewritten file(s)): 3/3 pass (recorded, not a verdict input) |

参考测试(验证器自带,两组相同)共 7 例:大写退出行的超时(28)、大写退出行的非零退出码(52/56)、小写拼写仍可读、退出 0 + code 0 信封、退出 0 + 非零信封、退出 0 无输出保持不可读、stderr 里的连接失败。**笔记正文列出了 52/56,而任务文本只描述超时;因此有笔记组在"非零退出码"一例上的通过,包含"笔记披露了验收覆盖范围"的成分,不能只记为定位更快。** 根因修复(退出行的标签按两种拼写读,一行正则)同时覆盖超时与非零退出码两类情形;只把超时分支改成认大写、不改退出码读取的修复是治标,会在"非零退出码"一例上失败。本清单里:参考测试 7/7(根因修复)8 次(smoke 20260911T135759Z-devloop-smoke; no-note作废 20260911T140427Z-devloop-no-note; no-note 20260911T144347Z-devloop-no-note; no-note 20260911T144542Z-devloop-no-note; note作废 20260911T151132Z-devloop-note; note作废 20260911T151342Z-devloop-note; note 20260911T154907Z-devloop-note; note 20260911T155035Z-devloop-note);只过超时、不过非零退出码(治标)1 次(no-note作废 20260911T140806Z-devloop-no-note);其他参考失败 0 次。

## 结果判定逐条解释

判据(judge-outcome.mjs):每条 used 事件按它的 call id 找验收记录里同一调用的 attempt;attempt 成功且本次验收 PASS → validated;该调用不是验收 attempt(提到了判别值但不是写入新增测试的调用)→ needs_review "the token appeared in an operation that was not an acceptance attempt";attempt 失败 → corrected 或 needs_review(视失败是否由资产内容解释)。attempt 只认最终新增测试的文件名/标题里的标记,并关联最后一次写入该文件且含标记的调用。

| run_id | 状态 | 调用 | 工具 | 调用做了什么(参数头) | 判定理由 |
|---|---|---|---|---|---|
| 20260911T154907Z-devloop-note | validated | call_00_RHmV4S1O5LcgS05ZIxxI6538 | Write | /private/tmp/topic4-sessions/20260911T154907Z-devloop-note.vfDN/session/evaluation/tasks/b | the call it fed succeeded (reference test passed on the changed copy) and the run's acceptance passed (reference test passed on the changed copy) |
| 20260911T154907Z-devloop-note | needs_review | call_00_KPRFvvOTwslSEGh2Z7gk0929 | Bash | cd /private/tmp/topic4-sessions/20260911T154907Z-devloop-note.vfDN/session && node --test  | the token appeared in an operation that was not an acceptance attempt, so no outcome can be tied to it |
| 20260911T155035Z-devloop-note | validated | call_00_FyIgEjn7omrGZtlb2DKJ4738 | Write | /private/tmp/topic4-sessions/20260911T155035Z-devloop-note.5s6V/session/evaluation/tasks/b | the call it fed succeeded (reference test passed on the changed copy) and the run's acceptance passed (reference test passed on the changed copy) |
| 20260911T155035Z-devloop-note | needs_review | call_00_NkcZfb0Uq36JNewscK1e8738 | Bash | cd /private/tmp/topic4-sessions/20260911T155035Z-devloop-note.5s6V/session && node --test  | the token appeared in an operation that was not an acceptance attempt, so no outcome can be tied to it |

## 可见性事故:approved 但 private,检索不到,表现为"未采用"

笔记由 `/v3/skill/create` 建入,默认 `visibility: private`;批次四的资产由 enter-pool.sh 显式置 team。bridge 的 skill_search 不含别人的私有 skill。管理员置 approved 后跑的有笔记组第一对(20260911T151132Z-devloop-note、20260911T151342Z-devloop-note):20260911T151132Z-devloop-note 检索 4 次、笔记出现在结果 否、送达事件 无、采用 0;20260911T151342Z-devloop-note 检索 0 次、笔记出现在结果 否、送达事件 无、采用 0。若不查准入返回里的 visibility 字段就写报告,这两次会被记成"笔记送达后模型未采用"——把配置缺陷说成模型行为。与"探针装错位置"同类:仪器出错不报错,只给看起来正常的结论。处置:两次作废留档;2026-09-11T15:48:50Z note visibility private → team (owner key, fill-note.mjs --fix-visibility; record visibility-fix.json); pool re-snapshotted (v1 kept as asset-pool-snapshot.v1-note-private.json);fill-note 建/更新后置 team 并在 --check 校验;驱动对有笔记组同时要求 approved 与 team。

## 结论(按 2026-09-11 晚定的口径)

两组功能验收相同(验证器自带参考测试 + 起点测试原内容),正式样本里无笔记 2/2 通过、有笔记 2/2 通过。笔记的可观测作用是改变实现路径:有笔记组 2/2 次按团队约定新建了带判别值的独立测试文件(无笔记组把测试加进已有文件),不是"没笔记就做不成"。判别值随机生成、只在 Core 正文里;无笔记组 4 次(含作废)零出现(0 次带标记)。采用证据来自送达事件(injected / recalled / fetched)与写入调用的关联(2 条,写入方式 Write),有笔记组 2/2 次判 used;不依赖模型自述。样本 2+2,差异仅描述这些运行。

## 闸门有没有动:回流前后的 Core 记录

| 时间 | 时点 | status | visibility | evidence_revision | 闸门 decision | decided_at | online validated/used/corrected |
|---|---|---|---|---|---|---|---|
| 2026-09-11T16:00:28Z | before write-back (after the note arm and the revert to candidate) | candidate | team | 2 | pending | 2026-09-11T11:25:46.115Z | 0/0/0 |
| 2026-09-11T16:09:56Z | after re-sync of the re-judged note runs (trusted rows expected) | candidate | team | 2 | pending | 2026-09-11T11:25:46.115Z | 0/0/0 |
| 2026-09-11T16:10:55Z | after re-sync of the re-judged note runs as trusted rows | candidate | team | 4 | pending | 2026-09-11T11:25:46.115Z | 0/0/0 |
| 2026-09-11T16:11:39Z | after re-sync with the owner-key hash lookup | candidate | team | 6 | pending | 2026-09-11T11:25:46.115Z | 0/0/0 |

闸门 decided_at 停在 2026-09-11T11:25:46.115Z(decision pending),evidence_revision 2 → 6:证据写入了,闸门尚未据此重判——回流只是写入,没闭合。

## 回流窗口、池快照与新资产的来源

提取开关记录(extraction-switch.jsonl)尚无:提取未打开,四次写回只归档(见上表)。

池快照:开关前 7 项(2026-09-11T16:18:49Z);写回后 未拍;关闭后 未拍。

## apply 之前的两项确认

**1. 作者先验有没有计入试算的 admit?** 试算(2026-09-11T16:19:07Z)的判定理由:"rule admit: cross-person validated >= 1 (2 record(s)) and no corrected";"reported signals: 2 call(s) from 2 trusted row(s), 1 distinct task(s), 1 distinct consumer(s); none is a threshold";"2 row(s) on file are not trusted (not submitted by an admin or reviewer with call id, version and evidence) and were not read";"author usr-n68ea5ythq: 29 validated / 10 corrected on other assets (reported, not used)"。作者那一行标注 "(reported, not used)":规则(rule admit: cross-person validated >= 1 (2 record(s)) and no corrected)不读作者先验;作者信号只决定 review_priority(asset-gate.ts 371–387:近 30 天有被判 wrong 的资产 → high),不进 admit/reject 判定。因此 apply 的结果与试算一致,理由是 rule admit: cross-person validated >= 1 (2 record(s)) and no corrected。

**2. 两次验证是 cross_user 还是 cross_agent?** 笔记作者 user usr-n68ea5ythq;20260911T154907Z-devloop-note 消费者 agt-hsv5hd4ys2 属 user usr-4u07qc2kuj → cross_user;20260911T155035Z-devloop-note 消费者 agt-hsylov19pn 属 user usr-4u07qc2kuj → cross_user。Core 试算信号 cross_user_validated 2、distinct_consumers 1(按 user 计:两个 agent 同属一个消费者用户)。两次都是跨人(作者用户 ≠ 消费者用户),"基于跨人验证 admit"成立;但只有一个消费者用户、一个任务。

闸门评估记录:
- 2026-09-11T16:19:07Z dry-run(before the write-back with extraction on (trusted rows 2)):decision admit → status_target approved;status candidate → candidate;online validated 2 / corrected 0 / cross_user_validated 2 / untrusted_ignored 2

## 不信模型自报:这些运行的实证

本清单里已判决的 9 次运行中,7 次改写了被测代码自己的测试文件(evaluation/tasks/bridge-addr/verify.test.mjs);8 次模型自己的测试全绿(20260911T140427Z-devloop-no-note 22/22; 20260911T140806Z-devloop-no-note 22/22; 20260911T144347Z-devloop-no-note 22/22; 20260911T144542Z-devloop-no-note 22/22; 20260911T151132Z-devloop-note 22/22; 20260911T151342Z-devloop-note 22/22; 20260911T154907Z-devloop-note 3/3; 20260911T155035Z-devloop-note 3/3);1 次未记录模型自测(判据版本早于 repo-2026-09-11c)。验收器不看这些:受控套件跑起点测试的原内容,模型的测试只记不判。其中 1 次模型自测全绿而验收不是 PASS(20260911T140806Z-devloop-no-note:FAIL,参考测试失败项 a non-zero exit status, as CodeBuddy spells it, is a failure)——若当初采信模型自报"测试通过",这些运行会被判成通过。

## 消费者与记忆隔离

| run_id | 消费者 | 创建时足迹(profile/records/buffer) | proxy 配置 sha 前→后 | 备份 | 记忆读取次数 | 读回项 | 早于开跑 | 他 agent 的 | 无日期 | ok |
|---|---|---|---|---|---|---|---|---|---|---|
| 20260911T135759Z-devloop-smoke | agt-hnqxin11n9 | 0/0/0 | 76428b8b→52aa8777 | deploy/global-images/.proxy-config/config.yaml.bak-20260911T135759Z-devloop-smoke | 0 | 0 | 0 | 0 | 0 | 是 |
| 20260911T140427Z-devloop-no-note | agt-hn1pxo9rcm | 0/0/0 | 52aa8777→fbfc8e76 | deploy/global-images/.proxy-config/config.yaml.bak-20260911T140427Z-devloop-no-note | 0 | 0 | 0 | 0 | 0 | 是 |
| 20260911T140806Z-devloop-no-note | agt-hn7snfdspu | 0/0/0 | fbfc8e76→f102ed3e | deploy/global-images/.proxy-config/config.yaml.bak-20260911T140806Z-devloop-no-note | 0 | 0 | 0 | 0 | 0 | 是 |
| 20260911T144347Z-devloop-no-note | agt-hpvaeml21e | 0/0/0 | f102ed3e→b1610d43 | deploy/global-images/.proxy-config/config.yaml.bak-20260911T144347Z-devloop-no-note | 0 | 0 | 0 | 0 | 0 | 是 |
| 20260911T144542Z-devloop-no-note | agt-hpyg3smf6v | 0/0/0 | b1610d43→5a1cc48f | deploy/global-images/.proxy-config/config.yaml.bak-20260911T144542Z-devloop-no-note | 0 | 0 | 0 | 0 | 0 | 是 |
| 20260911T151132Z-devloop-note | agt-hq5ik0kr3g | 0/0/0 | 5a1cc48f→410fe42f | deploy/global-images/.proxy-config/config.yaml.bak-20260911T151132Z-devloop-note | 0 | 0 | 0 | 0 | 0 | 是 |
| 20260911T151342Z-devloop-note | agt-hq84sw27hy | 0/0/0 | 410fe42f→8666e78e | deploy/global-images/.proxy-config/config.yaml.bak-20260911T151342Z-devloop-note | 0 | 0 | 0 | 0 | 0 | 是 |
| 20260911T154907Z-devloop-note | agt-hsv5hd4ys2 | 0/0/0 | 8666e78e→1e493277 | deploy/global-images/.proxy-config/config.yaml.bak-20260911T154907Z-devloop-note | 0 | 0 | 0 | 0 | 0 | 是 |
| 20260911T155035Z-devloop-note | agt-hsylov19pn | 0/0/0 | 1e493277→ef127834 | deploy/global-images/.proxy-config/config.yaml.bak-20260911T155035Z-devloop-note | 0 | 0 | 0 | 0 | 0 | 是 |

## 新经验回流候选池

| run_id | 作者(agent / user) | 来源会话 | 提取任务 | 新资产 | 实际决定 |
|---|---|---|---|---|---|
| 20260911T144347Z-devloop-no-note | agt-hpvaeml21e / usr-4u07qc2kuj | codebuddy:c2525241-ba87-4736-85cc-1a67b7ffaf6d | skill-extract-task-b44150ce (code 0) | 无 | extract accepted but no new asset appeared in the registry within 121s (Core may have judged the session had nothing to keep, or the worker is still running); nothing is claimed |
| 20260911T144542Z-devloop-no-note | agt-hpyg3smf6v / usr-4u07qc2kuj | codebuddy:9e6f612d-7bcd-456b-8157-7a8dc2be3432 | skill-extract-task-96dd7e7a (code 0) | 无 | extract accepted but no new asset appeared in the registry within 121s (Core may have judged the session had nothing to keep, or the worker is still running); nothing is claimed |

## 笔记的准入是实验干预,不是闸门批准

笔记 skl-pXLc38dex6Zt 的闸门判定始终 pending;有笔记组之前由管理员置 approved 是实验准备动作,跑完即置回 candidate,报告不把它读作闸门批准;闸门判定待新经验回流(5e)后由证据驱动。驱动脚本每次调用记录的状态观测(5 条):2026-09-11T14:43:47Z candidate(no-note, n=2); 2026-09-11T15:11:32Z approved(note, n=0); 2026-09-11T15:49:07Z approved(note, n=2); 2026-09-11T15:57:14Z candidate(no-note, n=0); 2026-09-11T15:57:26Z candidate(no-note, n=0)。 最后一次观测为 candidate:已撤销。

任务文本改动 1 次:2026-09-11T14:42:48Z added: 本仓库所属团队把过往经验以 skill 形式保存在团队知识库中。动手之前先检索一次团队经验,有相关的就参考,没有就按自己的判断做。(原因:three runs with zero skill_search showed the injected skill_tools hint alone does not lead to a search; the sentence describes environment and workflow only, no defect information; same text for both arms;作废运行 20260911T140427Z-devloop-no-note, 20260911T140806Z-devloop-no-note)。
配置修正 1 次:2026-09-11T15:48:50Z note visibility private → team (owner key, fill-note.mjs --fix-visibility; record visibility-fix.json); pool re-snapshotted (v1 kept as asset-pool-snapshot.v1-note-private.json)(作废运行 20260911T151132Z-devloop-note, 20260911T151342Z-devloop-note)。

作废留档的运行(4):
- 20260911T140427Z-devloop-no-note(no-note):task.md changed after this run (2026-09-11T14:42:48Z: the team-knowledge sentence was added, both arms alike); kept on file, not counted
- 20260911T140806Z-devloop-no-note(no-note):task.md changed after this run (2026-09-11T14:42:48Z: the team-knowledge sentence was added, both arms alike); kept on file, not counted
- 20260911T151132Z-devloop-note(note):the note was visibility=private (skill/create default) while the other pool assets are team; the bridge's search excludes other users' private skills — run 1 searched 4 times with relevant queries and got the four team assets, never the note; run 2 did not search; 0 delivery events. A configuration defect, not model behaviour; voided 2026-09-11T15:48:50Z, kept on file. Both runs were started by a --n 0 status check (seq 1 0 counts down; driver guarded since).
- 20260911T151342Z-devloop-note(note):the note was visibility=private (skill/create default) while the other pool assets are team; the bridge's search excludes other users' private skills — run 1 searched 4 times with relevant queries and got the four team assets, never the note; run 2 did not search; 0 delivery events. A configuration defect, not model behaviour; voided 2026-09-11T15:48:50Z, kept on file. Both runs were started by a --n 0 status check (seq 1 0 counts down; driver guarded since).

## 计数(只描述这些运行)

- no-note:2 次;验收 PASS 2 / FAIL 0 / ERROR 0;模型检索团队池 2 次运行、笔记出现在检索结果 0 次运行;笔记有送达事件 0 次(送达未知 0);笔记被采用 0 次;消费者为本次新建且与 proxy 解析一致 2 次;记忆通道 ok 2 次、不 ok 0 次、未知 0 次。
- note:2 次;验收 PASS 2 / FAIL 0 / ERROR 0;模型检索团队池 2 次运行、笔记出现在检索结果 2 次运行;笔记有送达事件 2 次(送达未知 0);笔记被采用 2 次;消费者为本次新建且与 proxy 解析一致 2 次;记忆通道 ok 2 次、不 ok 0 次、未知 0 次。

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

