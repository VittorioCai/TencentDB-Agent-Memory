# 开发闭环 `exit-code-fix`:运行报告(脚本生成)

生成命令:`node evaluation/tasks/exit-code-fix/report.mjs`;数据范围:`evaluation/tasks/exit-code-fix/devloop-runs.json` 列出的 10 次运行(正式样本 5 次,冒烟 1 次,作废留档 4 次);
判据版本:repo-2026-09-11b, repo-2026-09-11c, repo-2026-09-11d;2 次运行读的是仓库外复判副本(/private/tmp/topic4-rejudge/devloop-2026-09-11;原记录不改,REJUDGED.json 记代码哈希):20260911T154907Z-devloop-note 0a3043b5c578; 20260911T155035Z-devloop-note 0a3043b5c578;笔记 skl-pXLc38dex6Zt(eval-tool-result-exit-line,当前 v2,仓库只存 sha256 1e85dcf5dcf7…;此前 v1 sha256 d3d4dd1bd6a4… 于 2026-09-11T17:55:11Z 退役)。每次运行开跑时的笔记版本见"每次运行"表;未记录版本的运行都早于第一次轮换,在 v1 上。

## 这份数字测的是什么,不是什么

- 测的是:同一缺陷任务在"笔记对消费者不可见(candidate)"与"笔记已准入(approved)"两种池状态下,各跑若干次,模型改出的仓库副本能否通过与两组完全相同的功能验收;笔记是否送达、是否被采用(新增测试的文件名/标题带笔记的判别值,并关联到写入它的调用)、采用后的结果判定;每次运行的消费者是否新建、记忆通道是否读到借入的记忆。
- 不是:两组的性能对照。样本极小,先无笔记后有笔记只用于闭环演示,不作为闸门或笔记收益的估计。
- 仓库内已有正确实现可参照(起点副本的 `evaluation/gate0/verify-capture.mjs` 正确读退出行并通用解析 curl 错误行,见 conditions.json 的 known_hints_in_tracked_files),**笔记的作用是缩短定位而非提供唯一答案**;无笔记组通过并不说明笔记无用,有笔记组通过也不说明是笔记的功劳——采用与否只看 attempts 与 used 事件。
- 判据保守在哪:验收只认验证器自带的参考测试与起点测试的原内容;模型自报的测试结果不采信;模型新增的测试另记不进判决。未知项:送达/采用事件缺失时记"?",不折成 0。

## 每次运行

| 序 | 组 | run_id | 消费者(新建) | proxy 解析到的 agent | 开跑时笔记状态/可见性 | 模型检索团队池次数 | 笔记出现在检索结果 | 笔记送达事件 | 采用 used / 待复核 | 结果判定 | 验收 | 尝试值 | 改动文件 | 模型自测 | 记忆通道 ok | 起点后提交 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | smoke(冒烟) | 20260911T135759Z-devloop-smoke | agt-hnqxin11n9 | agt-hnqxin11n9 | candidate v1 | 1 | 否 | 无 | 0 / 0 | 无 | PASS | none: no test file was added | M evaluation/tasks/bridge-addr/verify.mjs; M evaluation/tasks/bridge-addr/verify.test.mjs | 未加 | 是 | 0 |
| 1 | no-note(作废) | 20260911T140427Z-devloop-no-note | agt-hn1pxo9rcm | agt-hn1pxo9rcm | candidate v1 | 0 | 否 | 无 | 0 / 0 | 无 | PASS | none: no test file was added; 1 test(s) added to existing file(s) carry no bt- marker | M evaluation/tasks/bridge-addr/verify.mjs; M evaluation/tasks/bridge-addr/verify.test.mjs | 22/22 | 是 | 0 |
| 2 | no-note(作废) | 20260911T140806Z-devloop-no-note | agt-hn7snfdspu | agt-hn7snfdspu | candidate v1 | 2 | 否 | 无 | 0 / 0 | 无 | FAIL | none: no test file was added; 1 test(s) added to existing file(s) carry no bt- marker | M evaluation/tasks/bridge-addr/verify.mjs; M evaluation/tasks/bridge-addr/verify.test.mjs | 22/22 | 是 | 0 |
| 1 | no-note | 20260911T144347Z-devloop-no-note | agt-hpvaeml21e | agt-hpvaeml21e | candidate v1 | 3 | 否 | 无 | 0 / 0 | 无 | PASS | none: no test file was added; 1 test(s) added to existing file(s) carry no bt- marker | M evaluation/tasks/bridge-addr/verify.mjs; M evaluation/tasks/bridge-addr/verify.test.mjs | 22/22 | 是 | 0 |
| 2 | no-note | 20260911T144542Z-devloop-no-note | agt-hpyg3smf6v | agt-hpyg3smf6v | candidate v1 | 2 | 否 | 无 | 0 / 0 | 无 | PASS | none: no test file was added; 1 test(s) added to existing file(s) carry no bt- marker | M evaluation/tasks/bridge-addr/verify.mjs; M evaluation/tasks/bridge-addr/verify.test.mjs | 22/22 | 是 | 0 |
| 1 | note(作废) | 20260911T151132Z-devloop-note | agt-hq5ik0kr3g | agt-hq5ik0kr3g | approved/private v1 | 4 | 否 | 无 | 0 / 0 | 无 | PASS | none: no test file was added; 1 test(s) added to existing file(s) carry no bt- marker | M evaluation/tasks/bridge-addr/verify.mjs; M evaluation/tasks/bridge-addr/verify.test.mjs | 22/22 | 是 | 0 |
| 0 | note(作废) | 20260911T151342Z-devloop-note | agt-hq84sw27hy | agt-hq84sw27hy | approved/private v1 | 0 | 否 | 无 | 0 / 0 | 无 | PASS | none: no test file was added; 1 test(s) added to existing file(s) carry no bt- marker | M evaluation/tasks/bridge-addr/verify.mjs; M evaluation/tasks/bridge-addr/verify.test.mjs | 22/22 | 是 | 0 |
| 1 | note | 20260911T154907Z-devloop-note(复判 repo-2026-09-11d) | agt-hsv5hd4ys2 | agt-hsv5hd4ys2 | approved/team v1 | 2 | 是 | fetched 1, injected 1, recalled 1 | 2 / 1 | validated 1, needs_review 1 | PASS | bt-imczk9p69e3 | A evaluation/tasks/bridge-addr/verify.exit-status.bt-imczk9p69e3.test.mjs; M evaluation/tasks/bridge-addr/verify.mjs | 3/3 | 是 | 0 |
| 2 | note | 20260911T155035Z-devloop-note(复判 repo-2026-09-11d) | agt-hsylov19pn | agt-hsylov19pn | approved/team v1 | 2 | 是 | fetched 1, injected 1, recalled 1 | 2 / 1 | validated 1, needs_review 1 | PASS | bt-imczk9p69e3 | A evaluation/tasks/bridge-addr/verify.exit-status.bt-imczk9p69e3.test.mjs; M evaluation/tasks/bridge-addr/verify.mjs | 3/3 | 是 | 0 |
| 1 | note | 20260911T184746Z-devloop-note | agt-h05w3gsqab | agt-h05w3gsqab | approved/team v2 | 3 | 是 | fetched 1, injected 1, recalled 1 | 1 / 2 | validated 1 | PASS | bt-78yk9r3bfrm | A evaluation/tasks/bridge-addr/verify.exit-status.bt-78yk9r3bfrm.test.mjs; M evaluation/tasks/bridge-addr/verify.mjs | 4/4 | 是 | 0 |

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
| 20260911T184746Z-devloop-note | 7/7 | 无 | OK | 0 | 3/3 | 0 / 0 / 1 | reference test passed (7/7); no new identified failure in the controlled suite (561 tests over 40 original test file(s) plus the reference); 3 baseline failure(s) still failing; note: the model's own tests (1 added or rewritten file(s)): 4/4 pass (recorded, not a verdict input) |

参考测试(验证器自带,两组相同)共 7 例:大写退出行的超时(28)、大写退出行的非零退出码(52/56)、小写拼写仍可读、退出 0 + code 0 信封、退出 0 + 非零信封、退出 0 无输出保持不可读、stderr 里的连接失败。**笔记正文列出了 52/56,而任务文本只描述超时;因此有笔记组在"非零退出码"一例上的通过,包含"笔记披露了验收覆盖范围"的成分,不能只记为定位更快。** 根因修复(退出行的标签按两种拼写读,一行正则)同时覆盖超时与非零退出码两类情形;只把超时分支改成认大写、不改退出码读取的修复是治标,会在"非零退出码"一例上失败。本清单里:参考测试 7/7(根因修复)9 次(smoke 20260911T135759Z-devloop-smoke; no-note作废 20260911T140427Z-devloop-no-note; no-note 20260911T144347Z-devloop-no-note; no-note 20260911T144542Z-devloop-no-note; note作废 20260911T151132Z-devloop-note; note作废 20260911T151342Z-devloop-note; note 20260911T154907Z-devloop-note; note 20260911T155035Z-devloop-note; note 20260911T184746Z-devloop-note);只过超时、不过非零退出码(治标)1 次(no-note作废 20260911T140806Z-devloop-no-note);其他参考失败 0 次。

## 结果判定逐条解释

判据(judge-outcome.mjs):每条 used 事件按它的 call id 找验收记录里同一调用的 attempt;attempt 成功且本次验收 PASS → validated;该调用不是验收 attempt(提到了判别值但不是写入新增测试的调用)→ needs_review "the token appeared in an operation that was not an acceptance attempt";attempt 失败 → corrected 或 needs_review(视失败是否由资产内容解释)。attempt 只认最终新增测试的文件名/标题里的标记,并关联最后一次写入该文件且含标记的调用。

| run_id | 状态 | 调用 | 工具 | 调用做了什么(参数头) | 判定理由 |
|---|---|---|---|---|---|
| 20260911T154907Z-devloop-note | validated | call_00_RHmV4S1O5LcgS05ZIxxI6538 | Write | /private/tmp/topic4-sessions/20260911T154907Z-devloop-note.vfDN/session/evaluation/tasks/b | the call it fed succeeded (reference test passed on the changed copy) and the run's acceptance passed (reference test passed on the changed copy) |
| 20260911T154907Z-devloop-note | needs_review | call_00_KPRFvvOTwslSEGh2Z7gk0929 | Bash | cd /private/tmp/topic4-sessions/20260911T154907Z-devloop-note.vfDN/session && node --test  | the token appeared in an operation that was not an acceptance attempt, so no outcome can be tied to it |
| 20260911T155035Z-devloop-note | validated | call_00_FyIgEjn7omrGZtlb2DKJ4738 | Write | /private/tmp/topic4-sessions/20260911T155035Z-devloop-note.5s6V/session/evaluation/tasks/b | the call it fed succeeded (reference test passed on the changed copy) and the run's acceptance passed (reference test passed on the changed copy) |
| 20260911T155035Z-devloop-note | needs_review | call_00_NkcZfb0Uq36JNewscK1e8738 | Bash | cd /private/tmp/topic4-sessions/20260911T155035Z-devloop-note.5s6V/session && node --test  | the token appeared in an operation that was not an acceptance attempt, so no outcome can be tied to it |
| 20260911T184746Z-devloop-note | validated | call_00_NKUFu2qWxVXTlBsiWqFF9183 | Write | /private/tmp/topic4-sessions/20260911T184746Z-devloop-note.v298/session/evaluation/tasks/b | the call it fed succeeded (reference test passed on the changed copy) and the run's acceptance passed (reference test passed on the changed copy) |

## 可见性事故:approved 但 private,检索不到,表现为"未采用"

笔记由 `/v3/skill/create` 建入,默认 `visibility: private`;批次四的资产由 enter-pool.sh 显式置 team。bridge 的 skill_search 不含别人的私有 skill。管理员置 approved 后跑的有笔记组第一对(20260911T151132Z-devloop-note、20260911T151342Z-devloop-note):20260911T151132Z-devloop-note 检索 4 次、笔记出现在结果 否、送达事件 无、采用 0;20260911T151342Z-devloop-note 检索 0 次、笔记出现在结果 否、送达事件 无、采用 0。若不查准入返回里的 visibility 字段就写报告,这两次会被记成"笔记送达后模型未采用"——把配置缺陷说成模型行为。与"探针装错位置"同类:仪器出错不报错,只给看起来正常的结论。处置:两次作废留档;2026-09-11T15:48:50Z note visibility private → team (owner key, fill-note.mjs --fix-visibility; record visibility-fix.json); pool re-snapshotted (v1 kept as asset-pool-snapshot.v1-note-private.json);2026-09-11T18:59:00Z asset-pool-snapshot.json refreshed to the pool as read live by run 20260911T184746Z (note v2 approved team, 7 assets); the previous snapshot (note v1) kept as asset-pool-snapshot.v1-note-team.json;2026-09-11T21:55:36Z runtime image digests backfilled: core sha256:55fec3a6067af7cc4dbb48017f590392cf0085f378b6bcac340a91690a9707ed (2026-09-07 build), proxy sha256:85d0360534bd39cb1160b2dcfe37dec25a6feb3d2de814af575ba98f77077f19;2026-09-11T22:03:16Z runtime mount override recorded (correction of the 2026-09-11 backfill's reasoning);2026-09-11T22:23:08Z correction: the historical core image digest is unknown; sha256:55fec3a6… is the image after the rebuild, not the one these runs used;fill-note 建/更新后置 team 并在 --check 校验;驱动对有笔记组同时要求 approved 与 team。

## 结论(按 2026-09-11 晚定的口径)

两组功能验收相同(验证器自带参考测试 + 起点测试原内容),正式样本里无笔记 2/2 通过、有笔记 3/3 通过。笔记的可观测作用是改变实现路径:有笔记组 3/3 次按团队约定新建了带判别值的独立测试文件(无笔记组把测试加进已有文件),不是"没笔记就做不成"。判别值随机生成、只在 Core 正文里;无笔记组 4 次(含作废)零出现(0 次带标记)。采用证据来自送达事件(injected / recalled / fetched)与写入调用的关联(3 条,写入方式 Write),有笔记组 3/3 次判 used;不依赖模型自述。样本 2+3,差异仅描述这些运行。

## 闸门有没有动:回流前后的 Core 记录

| 时间 | 时点 | status | visibility | evidence_revision | 闸门 decision | decided_at | online validated/used/corrected |
|---|---|---|---|---|---|---|---|
| 2026-09-11T16:00:28Z | before write-back (after the note arm and the revert to candidate) | candidate | team | 2 | pending | 2026-09-11T11:25:46.115Z | 0/0/0 |
| 2026-09-11T16:09:56Z | after re-sync of the re-judged note runs (trusted rows expected) | candidate | team | 2 | pending | 2026-09-11T11:25:46.115Z | 0/0/0 |
| 2026-09-11T16:10:55Z | after re-sync of the re-judged note runs as trusted rows | candidate | team | 4 | pending | 2026-09-11T11:25:46.115Z | 0/0/0 |
| 2026-09-11T16:11:39Z | after re-sync with the owner-key hash lookup | candidate | team | 6 | pending | 2026-09-11T11:25:46.115Z | 0/0/0 |
| 2026-09-11T16:54:11Z | after the extraction window closed (before apply) | candidate | team | 6 | pending | 2026-09-11T11:25:46.115Z | 0/0/0 |
| 2026-09-11T16:54:11Z | after apply | approved | team | 6 | admit | 2026-09-11T16:54:11.610Z | 2/0/0 |
| 2026-09-11T17:56:52Z | after rotation to v2 (value burned by the 2026-09-11 records); before any run | candidate | team | 6 | pending | 2026-09-11T17:56:50.752Z | 0/0/0 |
| 2026-09-11T18:42:51Z | before the note arms on v2: is the note approved, is A's assessment on file | candidate | team | 6 | pending | 2026-09-11T18:20:18.980Z | 0/0/0 |
| 2026-09-11T18:45:26Z | after the administrator set v2 approved (experimental intervention, 18:44:05Z), both assessments on file; before the note arms | approved | team | 6 | pending | 2026-09-11T18:20:18.980Z | 0/0/0 |
| 2026-09-11T19:04:08Z | administrator set v2 back to candidate (19:03:08Z) for the no-note arm; evidence_revision 10 | candidate | team | 10 | pending | 2026-09-11T18:20:18.980Z | 0/0/0 |
| 2026-09-11T19:08:31Z | after apply (second task): status as Core holds it | approved | team | 10 | admit | 2026-09-11T19:08:30.973Z | 4/0/0 |

闸门在 2026-09-11T19:08:31Z 重判:decided_at 2026-09-11T11:25:46.115Z → 2026-09-11T19:08:30.973Z,decision pending → admit,status candidate → approved;evidence_revision 2 → 10。回流闭合:一条经验被提取 → 被使用 → 被验证 → 闸门据证据准入;笔记保留 approved(判定与状态一致,是这一环的实物;上次人工 approved 时 gate 仍 pending,状态与判定不一致,故置回)。admit 所依据的 4 次 validated 来自同一消费者用户、同一任务,见"apply 之前的两项确认"。

## 回流窗口、池快照与新资产的来源

| 时间 | 开关 | 前 → 后 | 容器读回 | 配置 sha 前→后 | 备份 | ok |
|---|---|---|---|---|---|---|
| 2026-09-11T16:25:58Z | on | false → true | enabled:true | 66ebab0a→cdb5b484 | deploy/global-images/.memory-core-config/tdai-gateway.yaml.bak-20260911T162547Z-before-extraction-on | true |
| 2026-09-11T16:52:28Z | off | true → false | enabled:false | cdb5b484→66ebab0a | deploy/global-images/.memory-core-config/tdai-gateway.yaml.bak-20260911T165220Z-before-extraction-off | true |

开关时间窗:开 2026-09-11T16:25:58Z → 关 2026-09-11T16:52:28Z。四次写回的调用时间:20260911T144347Z-devloop-no-note 2026-09-11T16:26:56Z; 20260911T144542Z-devloop-no-note 2026-09-11T16:27:22Z; 20260911T154907Z-devloop-note 2026-09-11T16:27:42Z; 20260911T155035Z-devloop-note 2026-09-11T16:28:03Z。

写回记录里出现的新资产 10 项(每条写回调用前后比对注册表,以该次消费者用户的 key 读;注册表行只带 owner user,归档 key 的路径段给出被归档会话的 agent):skl-HJW3hVeUmdXj team-skill-bridge-search v1 candidate owner user usr-4u07qc2kuj(=该次消费者用户),归档 agent agt-hpvaeml21e(=该次消费者),提取任务 skill-extract-task-96a66940; skl-isClIUZCR2nH codebuddy-tool-result-parsing v1 candidate owner user usr-4u07qc2kuj(=该次消费者用户),归档 agent agt-hpvaeml21e(=该次消费者),提取任务 skill-extract-task-96a66940; skl-d9gLp1pxJFuK team-skill-bridge-http v1 candidate owner user usr-4u07qc2kuj(=该次消费者用户),归档 agent agt-hpyg3smf6v(=该次消费者),提取任务 skill-extract-task-3656971c; skl-uVUnsZwjjQmq eval-verifier-regression-fix-workflow v1 candidate owner user usr-4u07qc2kuj(=该次消费者用户),归档 agent agt-hpyg3smf6v(=该次消费者),提取任务 skill-extract-task-3656971c; skl-nyuzDt1y8wmt codebuddy-bash-tool-result-format v1 candidate owner user usr-4u07qc2kuj(=该次消费者用户),归档 agent agt-hpyg3smf6v(=该次消费者),提取任务 skill-extract-task-3656971c; skl-zxOrEOb022WE team-skill-bridge-search v1 candidate owner user usr-4u07qc2kuj(=该次消费者用户),归档 agent agt-hsv5hd4ys2(=该次消费者),提取任务 skill-extract-task-9d11533a; skl-706O31iXcvAU evaluation-repo-test-conventions v1 candidate owner user usr-4u07qc2kuj(=该次消费者用户),归档 agent agt-hsv5hd4ys2(=该次消费者),提取任务 skill-extract-task-9d11533a; skl-z0V6zwphUvhB codebuddy-tool-result-exit-line v1 candidate owner user usr-4u07qc2kuj(=该次消费者用户),归档 agent agt-hsv5hd4ys2(=该次消费者),提取任务 skill-extract-task-9d11533a; skl-NNeJq4zXYret confirm-fix-with-git-stash-baseline v1 candidate owner user usr-4u07qc2kuj(=该次消费者用户),归档 agent agt-hsylov19pn(=该次消费者),提取任务 skill-extract-task-a58a9265; skl-47VVI0Hmdzz2 codebuddy-exit-status-parsing v1 candidate owner user usr-4u07qc2kuj(=该次消费者用户),归档 agent agt-hsylov19pn(=该次消费者),提取任务 skill-extract-task-a58a9265。owner user 等于该次消费者用户的 10/10;归档 agent 等于该次消费者的 10/10。

池快照:开关前 7 项(2026-09-11T16:18:49Z);写回后 7 项(2026-09-11T16:28:23Z),新增 0;关闭后 7 项(2026-09-11T16:54:11Z),相对开关前新增 0。 作者 key 拍的快照没有看到这 10 项:提取出的 skill 默认 visibility private、属消费者用户,作者的注册表列表不含它们(与笔记私有那次是同一机制);来源以每次写回前后的注册表比对为准。

## apply 之前的两项确认

**1. 作者先验有没有计入试算的 admit?** 试算(2026-09-11T19:08:30Z)的判定理由:"rule admit: cross-person validated >= 1 (4 record(s)) and no corrected";"reported signals: 4 call(s) from 6 trusted row(s), 2 distinct task(s), 2 distinct consumer(s); none is a threshold";"2 row(s) on file are not trusted (not submitted by an admin or reviewer with call id, version and evidence) and were not read";"2 trusted call(s) are about other versions or contents of this asset and do not decide version 2 (b230f087c6)";"author usr-n68ea5ythq: 29 validated / 10 corrected on other assets (reported, not used)";"context-based assessment on file: competence medium for "reading the exit status line of a CodeBuddy tool result: how the label is spelled and how an acceptance parser must read it" (reported, not used: the decision rests on outcomes)"。作者那一行标注 "(reported, not used)":规则(rule admit: cross-person validated >= 1 (4 record(s)) and no corrected)不读作者先验;作者信号只决定 review_priority(asset-gate.ts 371–387:近 30 天有被判 wrong 的资产 → high),不进 admit/reject 判定。因此 apply 的结果与试算一致,理由是 rule admit: cross-person validated >= 1 (4 record(s)) and no corrected。

**2. 两次验证是 cross_user 还是 cross_agent?** 笔记作者 user usr-n68ea5ythq;20260911T154907Z-devloop-note 消费者 agt-hsv5hd4ys2 属 user usr-4u07qc2kuj → cross_user;20260911T155035Z-devloop-note 消费者 agt-hsylov19pn 属 user usr-4u07qc2kuj → cross_user;20260911T184746Z-devloop-note 消费者 agt-h05w3gsqab 属 user usr-4u07qc2kuj → cross_user。Core 试算信号 cross_user_validated 4、distinct_consumers 2(按 user 计:两个 agent 同属一个消费者用户)。**闸门 admit 基于 4 次 cross_user validated,但两次来自同一消费者用户、同一任务(distinct_consumers=2,distinct_tasks=2)。跨人关系成立,独立性不成立——这是单主体条件下的已知限制,不是两个独立验证。**

闸门评估记录:
- 2026-09-11T16:19:07Z dry-run(before the write-back with extraction on (trusted rows 2)):decision admit → status_target approved;status candidate → candidate;online validated 2 / corrected 0 / cross_user_validated 2 / untrusted_ignored 2
- 2026-09-11T16:54:11Z APPLY(apply after the write-back window: the rule's own decision on the two trusted cross-user validated rows):decision admit → status_target approved;status candidate → approved;online validated 2 / corrected 0 / cross_user_validated 2 / untrusted_ignored 2
- 2026-09-11T18:43:13Z dry-run(v2 with A's context-based assessment on file and no outcome yet: what the rule says and which review priority it gives):decision pending → status_target candidate;status candidate → candidate;online validated 0 / corrected 0 / cross_user_validated 0 / untrusted_ignored 2
- 2026-09-11T18:54:56Z dry-run(v2 after one task-1 run (user B) and one task-2 run (user C) synced: what the rule sees before the last note run):decision admit → status_target approved;status approved → approved;online validated 2 / corrected 0 / cross_user_validated 2 / untrusted_ignored 2
- 2026-09-11T19:01:40Z dry-run(v2 after the note arms: task 1 ×1 (user B, entity task-5e6xp4mrrw) and task 2 ×4 (user C; 2 under task-5e6xp4mrrw, 2 under task-h1k7xruuhb); before the no-note arm):decision admit → status_target approved;status approved → approved;online validated 4 / corrected 0 / cross_user_validated 4 / untrusted_ignored 2
- 2026-09-11T19:08:30Z dry-run(all arms done on v2: task 1 note ×1 (B), task 2 note ×4 + no-note ×2 (C); before apply):decision admit → status_target approved;status candidate → candidate;online validated 4 / corrected 0 / cross_user_validated 4 / untrusted_ignored 2
- 2026-09-11T19:08:30Z APPLY(apply after the second task: the rule's own decision on the trusted cross-user validated rows of two users and two task entities):decision admit → status_target approved;status candidate → approved;online validated 4 / corrected 0 / cross_user_validated 4 / untrusted_ignored 2
apply 结果:status candidate → approved,与最后一次试算(admit)一致。

## 不信模型自报:这些运行的实证

本清单里已判决的 10 次运行中,7 次改写了被测代码自己的测试文件(evaluation/tasks/bridge-addr/verify.test.mjs);9 次模型自己的测试全绿(20260911T140427Z-devloop-no-note 22/22; 20260911T140806Z-devloop-no-note 22/22; 20260911T144347Z-devloop-no-note 22/22; 20260911T144542Z-devloop-no-note 22/22; 20260911T151132Z-devloop-note 22/22; 20260911T151342Z-devloop-note 22/22; 20260911T154907Z-devloop-note 3/3; 20260911T155035Z-devloop-note 3/3; 20260911T184746Z-devloop-note 4/4);1 次未记录模型自测(判据版本早于 repo-2026-09-11c)。验收器不看这些:受控套件跑起点测试的原内容,模型的测试只记不判。其中 1 次模型自测全绿而验收不是 PASS(20260911T140806Z-devloop-no-note:FAIL,参考测试失败项 a non-zero exit status, as CodeBuddy spells it, is a failure)——若当初采信模型自报"测试通过",这些运行会被判成通过。

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
| 20260911T184746Z-devloop-note | agt-h05w3gsqab | 0/0/0 | 6104b51e→6bc0555f | deploy/global-images/.proxy-config/config.yaml.bak-20260911T184746Z-devloop-note | 0 | 0 | 0 | 0 | 0 | 是 |

## 新经验回流候选池

| run_id | 作者(agent / user) | 来源会话 | 提取任务 | 新资产 | 实际决定 |
|---|---|---|---|---|---|
| 20260911T144347Z-devloop-no-note | agt-hpvaeml21e / usr-4u07qc2kuj | codebuddy:c2525241-ba87-4736-85cc-1a67b7ffaf6d | skill-extract-task-96a66940 (code 0) | skl-HJW3hVeUmdXj team-skill-bridge-search v1 candidate; skl-isClIUZCR2nH codebuddy-tool-result-parsing v1 candidate | Core extracted 2 asset(s); status as Core set it: candidate (admission is the administrator's step) |
| 20260911T144542Z-devloop-no-note | agt-hpyg3smf6v / usr-4u07qc2kuj | codebuddy:9e6f612d-7bcd-456b-8157-7a8dc2be3432 | skill-extract-task-3656971c (code 0) | skl-d9gLp1pxJFuK team-skill-bridge-http v1 candidate; skl-uVUnsZwjjQmq eval-verifier-regression-fix-workflow v1 candidate; skl-nyuzDt1y8wmt codebuddy-bash-tool-result-format v1 candidate | Core extracted 3 asset(s); status as Core set it: candidate (admission is the administrator's step) |
| 20260911T154907Z-devloop-note | agt-hsv5hd4ys2 / usr-4u07qc2kuj | codebuddy:bdec6479-e531-4224-baed-be42c686b567 | skill-extract-task-9d11533a (code 0) | skl-zxOrEOb022WE team-skill-bridge-search v1 candidate; skl-706O31iXcvAU evaluation-repo-test-conventions v1 candidate; skl-z0V6zwphUvhB codebuddy-tool-result-exit-line v1 candidate | Core extracted 3 asset(s); status as Core set it: candidate (admission is the administrator's step) |
| 20260911T155035Z-devloop-note | agt-hsylov19pn / usr-4u07qc2kuj | codebuddy:fbbd6f35-dca2-4479-9e51-a16db7a38f15 | skill-extract-task-a58a9265 (code 0) | skl-NNeJq4zXYret confirm-fix-with-git-stash-baseline v1 candidate; skl-47VVI0Hmdzz2 codebuddy-exit-status-parsing v1 candidate | Core extracted 2 asset(s); status as Core set it: candidate (admission is the administrator's step) |

## 笔记的准入是实验干预,不是闸门批准

笔记 skl-pXLc38dex6Zt 的闸门判定始终 pending;有笔记组之前由管理员置 approved 是实验准备动作,跑完即置回 candidate,报告不把它读作闸门批准;闸门判定待新经验回流(5e)后由证据驱动。驱动脚本每次调用记录的状态观测(6 条):2026-09-11T14:43:47Z candidate(no-note, n=2); 2026-09-11T15:11:32Z approved(note, n=0); 2026-09-11T15:49:07Z approved(note, n=2); 2026-09-11T15:57:14Z candidate(no-note, n=0); 2026-09-11T15:57:26Z candidate(no-note, n=0); 2026-09-11T18:47:46Z approved(note, n=1)。 最后一次观测为 approved:尚未置回。

任务文本改动 1 次:2026-09-11T14:42:48Z added: 本仓库所属团队把过往经验以 skill 形式保存在团队知识库中。动手之前先检索一次团队经验,有相关的就参考,没有就按自己的判断做。(原因:three runs with zero skill_search showed the injected skill_tools hint alone does not lead to a search; the sentence describes environment and workflow only, no defect information; same text for both arms;作废运行 20260911T140427Z-devloop-no-note, 20260911T140806Z-devloop-no-note)。
配置修正 5 次:2026-09-11T15:48:50Z note visibility private → team (owner key, fill-note.mjs --fix-visibility; record visibility-fix.json); pool re-snapshotted (v1 kept as asset-pool-snapshot.v1-note-private.json)(作废运行 20260911T151132Z-devloop-note, 20260911T151342Z-devloop-note);2026-09-11T18:59:00Z asset-pool-snapshot.json refreshed to the pool as read live by run 20260911T184746Z (note v2 approved team, 7 assets); the previous snapshot (note v1) kept as asset-pool-snapshot.v1-note-team.json(作废运行 无);2026-09-11T21:55:36Z runtime image digests backfilled: core sha256:55fec3a6067af7cc4dbb48017f590392cf0085f378b6bcac340a91690a9707ed (2026-09-07 build), proxy sha256:85d0360534bd39cb1160b2dcfe37dec25a6feb3d2de814af575ba98f77077f19(作废运行 无);2026-09-11T22:03:16Z runtime mount override recorded (correction of the 2026-09-11 backfill's reasoning)(作废运行 无);2026-09-11T22:23:08Z correction: the historical core image digest is unknown; sha256:55fec3a6… is the image after the rebuild, not the one these runs used(作废运行 无)。

作废留档的运行(4):
- 20260911T140427Z-devloop-no-note(no-note):task.md changed after this run (2026-09-11T14:42:48Z: the team-knowledge sentence was added, both arms alike); kept on file, not counted
- 20260911T140806Z-devloop-no-note(no-note):task.md changed after this run (2026-09-11T14:42:48Z: the team-knowledge sentence was added, both arms alike); kept on file, not counted
- 20260911T151132Z-devloop-note(note):the note was visibility=private (skill/create default) while the other pool assets are team; the bridge's search excludes other users' private skills — run 1 searched 4 times with relevant queries and got the four team assets, never the note; run 2 did not search; 0 delivery events. A configuration defect, not model behaviour; voided 2026-09-11T15:48:50Z, kept on file. Both runs were started by a --n 0 status check (seq 1 0 counts down; driver guarded since).
- 20260911T151342Z-devloop-note(note):the note was visibility=private (skill/create default) while the other pool assets are team; the bridge's search excludes other users' private skills — run 1 searched 4 times with relevant queries and got the four team assets, never the note; run 2 did not search; 0 delivery events. A configuration defect, not model behaviour; voided 2026-09-11T15:48:50Z, kept on file. Both runs were started by a --n 0 status check (seq 1 0 counts down; driver guarded since).

## 计数(只描述这些运行)

- no-note:2 次;验收 PASS 2 / FAIL 0 / ERROR 0;模型检索团队池 2 次运行、笔记出现在检索结果 0 次运行;笔记有送达事件 0 次(送达未知 0);笔记被采用 0 次;消费者为本次新建且与 proxy 解析一致 2 次;记忆通道 ok 2 次、不 ok 0 次、未知 0 次。
- note:3 次;验收 PASS 3 / FAIL 0 / ERROR 0;模型检索团队池 3 次运行、笔记出现在检索结果 3 次运行;笔记有送达事件 3 次(送达未知 0);笔记被采用 3 次;消费者为本次新建且与 proxy 解析一致 3 次;记忆通道 ok 3 次、不 ok 0 次、未知 0 次。

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
- 笔记最终 approved 是闸门规则的判定(admit 基于 2 次 cross_user validated,但 distinct_consumers=1、distinct_tasks=1:跨人成立、独立性不成立);人工 approved 那段已置回,实验干预不算闸门批准
- 后续不做:跨运行记忆隔离方案(要点已记:每次新 agent + 反证验证 + 查借入的 chat_memory)、并发最后一组维持 ERROR、bridge-name 不换解析;批次五不跑(4 次不可判源于 gate-off 下两条冲突约定并存,换 trace 重跑会复现)
- 回流走产品的 /v3/skill/extract,提取内容由 Core 决定;是否产生资产、状态为何,以 write-back.json 为准
- 运行时镜像摘要在这些运行时没有冻结,而且已不可考:重建后拉到的上游 :latest(sha256:55fec3a6…)被证明不是当时的镜像(同一套挂载文件在它上面起不来,见 gate/artifacts/core-mount-accept-failure-20260912.log)。能确定的是运行时 = 当时镜像的其余文件 + 本分支挂载的 metadata 目录与 6 个 gateway/core 文件。回填与被覆盖清单见 devloop-runs.json 的 config_fixes;自 2026-09-11 起 selfcheck 把容器镜像摘要冻进 conditions.json

