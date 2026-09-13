# 第三个开发闭环任务:resource-download

任务类型:**新增一个功能**(前两个是修已有缺陷)。采用判定靠**行为**,不靠标记。

## 第一批:结论

有笔记组高出 100 个百分点(4/4 对 0/4)。

### 第一批:样本

| 组 | 记录 | 计入样本 | 排除 | PASS | 通过率 |
|---|---|---|---|---|---|
| no-note | 20 | 4 | 16 | 0 | 0% |
| note | 4 | 4 | 0 | 4 | 100% |

## 第二批:结论

有笔记组高出 80 个百分点(4/5 对 0/6)。

### 第二批:样本

| 组 | 记录 | 计入样本 | 排除 | PASS | 通过率 |
|---|---|---|---|---|---|
| no-note | 6 | 6 | 0 | 0 | 0% |
| note | 6 | 5 | 1 | 4 | 80% |

**作废抬高了 note 组的数字,所以这里把两种算法都给出来。** 按冻结的作废规则,该组计入 4/5;**把被作废的按原判决计回去**则是 4/6。作废规则是开跑前写死的、机械执行的(见 `batch2-conditions.json`),不因结果调整;但它这次恰好对结论有利,所以两个数并列,由读的人判断。

**两批不合并。** 它们的工作副本排除清单不同(第二批排掉了本仓库自己的上游 PR 归档),条件不同的样本合在一起算出来的比率没有意义(CLAUDE.md:更换条件不与旧口径合并)。


## 每次运行

| 运行 | 组 | 计入 | 判决 | 五项行为断言 | 笔记提及 | 使用判定 | 读到副本里那份说明 | 不计入的原因 |
|---|---|---|---|---|---|---|---|---|
| 20260913T105239Z-devloop-no-note | no-note | 否 | FAIL | ✓✓✓✗✓ | 未知 | 未知 | 未知 | 作废(no-note-2026-09-13a) |
| 20260913T105451Z-devloop-no-note | no-note | 否 | FAIL | ✓✓✓✗✓ | 未知 | 未知 | 未知 | 作废(no-note-2026-09-13a) |
| 20260913T105648Z-devloop-no-note | no-note | 否 | FAIL | ✓✓✓✗✓ | 未知 | 未知 | 未知 | 作废(no-note-2026-09-13a) |
| 20260913T105810Z-devloop-no-note | no-note | 否 | FAIL | ✓✓✓✗✓ | 未知 | 未知 | 未知 | 作废(no-note-2026-09-13a) |
| 20260913T110459Z-devloop-no-note | no-note | 否 | FAIL | ✓✓✓✗✓ | 未知 | 未知 | 未知 | 作废(no-note-2026-09-13a) |
| 20260913T110646Z-devloop-no-note | no-note | 否 | FAIL | ✓✓✓✗✓ | 未知 | 未知 | 未知 | 作废(no-note-2026-09-13a) |
| 20260913T110815Z-devloop-no-note | no-note | 否 | FAIL | ✓✓✓✗✓ | 未知 | 未知 | 未知 | 作废(no-note-2026-09-13a) |
| 20260913T111005Z-devloop-no-note | no-note | 否 | PASS | ✓✓✓✓✓ | 0 | 无 | 否 | 作废(no-note-2026-09-13a) |
| 20260913T112310Z-devloop-no-note | no-note | 否 | FAIL | ✓✓✓✗✓ | 未知 | 未知 | 未知 | 作废(no-note-2026-09-13a) |
| 20260913T112523Z-devloop-no-note | no-note | 否 | FAIL | ✓✓✓✗✓ | 未知 | 未知 | 未知 | 作废(no-note-2026-09-13a) |
| 20260913T112733Z-devloop-no-note | no-note | 否 | FAIL | ✓✓✓✗✓ | 未知 | 未知 | 未知 | 作废(no-note-2026-09-13a) |
| 20260913T112941Z-devloop-no-note | no-note | 否 | PASS | ✓✓✓✓✓ | 0 | 无 | 是(1 条) | 作废(no-note-2026-09-13a) |
| 20260913T113300Z-devloop-no-note | no-note | 否 | FAIL | ✓✓✓✗✓ | 未知 | 未知 | 未知 | 作废(no-note-2026-09-13a) |
| 20260913T113435Z-devloop-no-note | no-note | 否 | FAIL | ✓✓✓✗✓ | 未知 | 未知 | 未知 | 作废(no-note-2026-09-13a) |
| 20260913T113621Z-devloop-no-note | no-note | 否 | FAIL | ✓✓✓✗✓ | 未知 | 未知 | 未知 | 作废(no-note-2026-09-13a) |
| 20260913T113923Z-devloop-no-note | no-note | 否 | FAIL | ✓✓✓✗✓ | 未知 | 未知 | 未知 | 作废(no-note-2026-09-13a) |
| 20260913T121409Z-devloop-no-note | no-note | 是 | FAIL | ✓✓✓✗✓ | 0 | 无 | 是(1 条) |  |
| 20260913T121636Z-devloop-no-note | no-note | 是 | FAIL | ✓✓✓✗✓ | 0 | 无 | 否 |  |
| 20260913T121823Z-devloop-no-note | no-note | 是 | FAIL | ✓✓✓✗✓ | 0 | 无 | 否 |  |
| 20260913T121937Z-devloop-no-note | no-note | 是 | FAIL | ✓✓✓✗✓ | 0 | 无 | 是(1 条) |  |
| 20260913T123427Z-devloop-note | note | 是 | PASS | ✓✓✓✓✓ | 278 | needs_review | 是(2 条) |  |
| 20260913T123631Z-devloop-note | note | 是 | PASS | ✓✓✓✓✓ | 234 | needs_review | 是(2 条) |  |
| 20260913T123828Z-devloop-note | note | 是 | PASS | ✓✓✓✓✓ | 321 | needs_review | 是(1 条) |  |
| 20260913T124050Z-devloop-note | note | 是 | PASS | ✓✓✓✓✓ | 193 | needs_review | 是(2 条) |  |
| 20260913T164731Z-devloop-no-note | no-note | 是 | FAIL | ✓✓✓✗✓ | 0 | 无 | 否 |  |
| 20260913T164920Z-devloop-no-note | no-note | 是 | FAIL | ✓✓✓✗✓ | 0 | 无 | 否 |  |
| 20260913T165133Z-devloop-no-note | no-note | 是 | FAIL | ✓✓✓✗✓ | 0 | 无 | 否 |  |
| 20260913T165325Z-devloop-note | note | 是 | PASS | ✓✓✓✓✓ | 279 | needs_review | 否 |  |
| 20260913T165535Z-devloop-note | note | 是 | PASS | ✓✓✓✓✓ | 408 | needs_review | 否 |  |
| 20260913T165813Z-devloop-note | note | 是 | FAIL | ✓✓✓✗✓ | 452 | needs_review | 否 |  |
| 20260913T170043Z-devloop-no-note | no-note | 是 | FAIL | ✓✓✓✗✓ | 0 | 无 | 否 |  |
| 20260913T170327Z-devloop-no-note | no-note | 是 | FAIL | ✓✓✓✗✓ | 0 | 无 | 否 |  |
| 20260913T170534Z-devloop-no-note | no-note | 是 | FAIL | ✓✓✓✗✓ | 0 | 无 | 否 |  |
| 20260913T170755Z-devloop-note | note | 是 | PASS | ✓✓✓✓✓ | 208 | 无 | 否 |  |
| 20260913T170959Z-devloop-note | note | 否 | FAIL | ✓✓✓✗✓ | 278 | needs_review | 否 | 污染:foreign_run_access |
| 20260913T171204Z-devloop-note | note | 是 | PASS | ✓✓✓✓✓ | 136 | needs_review | 否 |  |

五项断言依次是:

- 1. 非空资源:拿到的是原始字节,不是信封
- 2. 空资源:零字节,而不是一个装着 JSON 的文件
- 3. base64 的空资源同样是零字节
- 4. 请求打到 files/download —— files/read 无论加不加 -o 都只回 JSON 信封
- 5. 错误信封:抛错并带上 message,不吞掉

## 作废批次:no-note-2026-09-13a(16 次)

整批作废:实施者在 /private/tmp/scen-check/ 留下了验证用的「看了笔记的写法」参考实现(10:30:45Z 与 10:30:53Z 两个文件),第一次运行始于 10:52:39Z —— 这 16 次全部在「答案就在磁盘上」的环境里跑。其中 2 次实际读到了:20260913T111005Z 直接 cat 了那份草稿,20260913T112941Z 又 grep 到前者留下的工作副本。

- 闸门是否失职:memory-channel.json 显示这两次 reads=0;笔记是 candidate,闸门没有放行。答案来自磁盘,不来自记忆通道。
- 为什么整批作废而不是只废被抓到的:「这条知识只能来自笔记」这个前提对整批都不成立,只作废被抓到的 2 次等于挑对自己有利的那部分。
- 发现方式:evaluation/runner/contamination.mjs(事后补写);对这 16 次重跑,规则命中见每条 contamination_rules
- 已改:
  - evaluation/runner/contamination.mjs 与 .test.mjs(跑前扫散落答案、跑完逐次检测)
  - run-once.sh:每次跑完写 contamination.json;工作副本跑完即删(KEEP_SESSION=1 可留)
  - run-arm.sh:开跑前扫盘,不过不跑;manifest 逐条记 contaminated
  - verify.mjs:判别值必须对得上 tokens.json 里登记的 sha256(含退休旧值),否则 registered=false 且 needs_review
- **未解决**:同一用户的 shell 面前,磁盘上没有真正读不到的位置。历次运行记录必然含答案,清不掉;这一半靠检测发现并作废,不靠隔离。
- 前两个任务:前两个任务的 23 次归档运行已全部重扫:无一引用别的运行目录,无一碰过 scen-check(当时它还不存在)。唯一没有 capture 的 20260911T175839Z-devloop-smoke 是已登记的记录缺口,且是冒烟不是样本。

## 工作副本里本不该有的那份说明

工作副本里除了产品源码(**按设计保留** —— 无笔记组读 MemoryProxy 自己想到 files/download 是允许的结果),还有我们自己写的上游 PR 归档,它用大白话写着 files/download 的成功路径返回原始字节。这不是产品的一部分,是评测与被测对象同仓库带来的副产物。**存在这样一个共同的替代信息源,尚不能确定它对组间差异的影响。** 两组副本虽然相同,但实际读到它的次数并不相同(见下表),而它与笔记可能共同作用于同一个行为;凭这 8 次既判断不出它把差值放大了还是缩小了,也判断不出方向。**原稿写的是「它只会让基线更强、让差值更保守」—— 那是一句没有依据的因果结论**(2026-09-13 第八轮复核指出,已改)。能说的只有:它在,哪一组读到了几次,以及两组的判决。

它在这些位置:`evaluation/upstream/download-telemetry/`、`evaluation/PR-DESCRIPTION.md`。

| 组 | 计入样本 | 其中读到了它 | 未知 |
|---|---|---|---|
| no-note | 10 | 2 | 0 |
| note | 9 | 4 | 0 |

没有清掉的原因:用户已定(2026-09-13):不清,如实报。这 8 次样本在含它的副本上跑。**要判断它的影响,只能另做一批排除它之后的对照**:把 `evaluation/upstream/` 与 `evaluation/PR-DESCRIPTION.md` 加进 archive_excludes,冻结条件后两组交错各跑若干次,单独报告,接受差异缩小或打平 —— 那一批问的是「排除已知替代来源后结果还复现吗」,不是「把 4 次加到 6 次」。不与这 8 次合并(CLAUDE.md:更换条件不与旧口径合并)。

## 污染判定重判(contamination-2026-09-13c)

自查补三处:不带尾斜杠地点到共享根目录也算枚举(b 版只有带斜杠才抓得住);/tmp 与 /private/tmp 同一处;命令从每条请求里取并按 id 去重,不只看最长的一份对话。

24 次重判,判定与 b 版完全一致

## 污染判定重判(contamination-2026-09-13b)

首版规则按文本找别的运行 id,把「读到的文字里引用过那条路径」当成了「访问过那个目录」。仓库自己的交付报告(evaluation/delivery/…)引用着历次运行的命令行,消费者在自己的副本里读到它们并不是污染。改为按**访问**判:只取 tool_calls 的参数,工具回显的内容一概不算;省略号写法(…/session)不算路径。

20 次重判,4 次改判为干净(20260913T105239Z、20260913T113621Z 两次作废批次内的,以及有笔记组 20260913T123427Z、20260913T124050Z)。两次真污染仍被抓住:20260913T111005Z(reference_leak + 访问)、20260913T112941Z(枚举共享根目录)。

每条运行保留 contamination_at_run_time,即当时那版规则给出的判定,不静默改写。作废批次不因重判恢复 —— 作废的理由是运行环境里有答案,与规则版本无关。

## 这份数字测的是什么,不是什么

- 测的是:在这一个新增功能任务上,一份写着两条实测行为的笔记,能不能让一个全新消费者把请求打到 `files/download`、把空内容当合法内容、把错误信封原样带出。
- 不测:笔记对其他任务的作用;也不测产品在其他场景下的检索质量。
- 允许零增益:同样的知识读 MemoryProxy 源码也能得到,所以两组打平是一个合理结果,不构成失败。
- 样本量:无笔记 4 次、有笔记 4 次。这个量级只能说明方向,说不了幅度——两组的百分点差不该被读成效应大小的估计;要更有底,须在同一条件下另跑一批。
- 样本偏在:消费者同为一个模型,身份同为 identity c;两组之间除笔记的准入状态外不做其他变动。
- 生成:`node evaluation/tasks/resource-download/report.mjs`,数据来自 `devloop-runs.json` 与各次运行记录。
