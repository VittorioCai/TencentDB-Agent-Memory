# 第三个开发闭环任务:resource-download

任务类型:**新增一个功能**(前两个是修已有缺陷)。采用判定靠**行为**,不靠标记。

## 结论

有笔记组高出 100 个百分点(4/4 对 0/4)。

## 样本

| 组 | 记录 | 计入样本 | 排除 | PASS | 通过率 |
|---|---|---|---|---|---|
| no-note | 20 | 4 | 16 | 0 | 0% |
| note | 4 | 4 | 0 | 4 | 100% |

## 每次运行

| 运行 | 组 | 计入 | 判决 | 五项行为断言 | 笔记提及 | 使用判定 | 读到副本里那份说明 | 不计入的原因 |
|---|---|---|---|---|---|---|---|---|
| 20260913T105239Z-devloop-no-note | no-note | 否 | FAIL | ✓✓✓✗✓ | 0 | 无 | 否 | 作废(no-note-2026-09-13a) |
| 20260913T105451Z-devloop-no-note | no-note | 否 | FAIL | ✓✓✓✗✓ | 0 | 无 | 是(2 条) | 作废(no-note-2026-09-13a) |
| 20260913T105648Z-devloop-no-note | no-note | 否 | FAIL | ✓✓✓✗✓ | 0 | 无 | 否 | 作废(no-note-2026-09-13a) |
| 20260913T105810Z-devloop-no-note | no-note | 否 | FAIL | ✓✓✓✗✓ | 0 | 无 | 是(2 条) | 作废(no-note-2026-09-13a) |
| 20260913T110459Z-devloop-no-note | no-note | 否 | FAIL | ✓✓✓✗✓ | 0 | 无 | 是(1 条) | 作废(no-note-2026-09-13a) |
| 20260913T110646Z-devloop-no-note | no-note | 否 | FAIL | ✓✓✓✗✓ | 0 | 无 | 否 | 作废(no-note-2026-09-13a) |
| 20260913T110815Z-devloop-no-note | no-note | 否 | FAIL | ✓✓✓✗✓ | 0 | 无 | 否 | 作废(no-note-2026-09-13a) |
| 20260913T111005Z-devloop-no-note | no-note | 否 | PASS | ✓✓✓✓✓ | 0 | 无 | 否 | 作废(no-note-2026-09-13a) |
| 20260913T112310Z-devloop-no-note | no-note | 否 | FAIL | ✓✓✓✗✓ | 0 | 无 | 是(1 条) | 作废(no-note-2026-09-13a) |
| 20260913T112523Z-devloop-no-note | no-note | 否 | FAIL | ✓✓✓✗✓ | 0 | 无 | 否 | 作废(no-note-2026-09-13a) |
| 20260913T112733Z-devloop-no-note | no-note | 否 | FAIL | ✓✓✓✗✓ | 0 | 无 | 否 | 作废(no-note-2026-09-13a) |
| 20260913T112941Z-devloop-no-note | no-note | 否 | PASS | ✓✓✓✓✓ | 0 | 无 | 是(1 条) | 作废(no-note-2026-09-13a) |
| 20260913T113300Z-devloop-no-note | no-note | 否 | FAIL | ✓✓✓✗✓ | 0 | 无 | 是(2 条) | 作废(no-note-2026-09-13a) |
| 20260913T113435Z-devloop-no-note | no-note | 否 | FAIL | ✓✓✓✗✓ | 0 | 无 | 否 | 作废(no-note-2026-09-13a) |
| 20260913T113621Z-devloop-no-note | no-note | 否 | FAIL | ✓✓✓✗✓ | 0 | 无 | 否 | 作废(no-note-2026-09-13a) |
| 20260913T113923Z-devloop-no-note | no-note | 否 | FAIL | ✓✓✓✗✓ | 0 | 无 | 否 | 作废(no-note-2026-09-13a) |
| 20260913T121409Z-devloop-no-note | no-note | 是 | FAIL | ✓✓✓✗✓ | 0 | 无 | 是(1 条) |  |
| 20260913T121636Z-devloop-no-note | no-note | 是 | FAIL | ✓✓✓✗✓ | 0 | 无 | 否 |  |
| 20260913T121823Z-devloop-no-note | no-note | 是 | FAIL | ✓✓✓✗✓ | 0 | 无 | 否 |  |
| 20260913T121937Z-devloop-no-note | no-note | 是 | FAIL | ✓✓✓✗✓ | 0 | 无 | 是(1 条) |  |
| 20260913T123427Z-devloop-note | note | 是 | PASS | ✓✓✓✓✓ | 278 | needs_review | 是(2 条) |  |
| 20260913T123631Z-devloop-note | note | 是 | PASS | ✓✓✓✓✓ | 234 | needs_review | 是(2 条) |  |
| 20260913T123828Z-devloop-note | note | 是 | PASS | ✓✓✓✓✓ | 321 | needs_review | 是(1 条) |  |
| 20260913T124050Z-devloop-note | note | 是 | PASS | ✓✓✓✓✓ | 193 | needs_review | 是(2 条) |  |

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

工作副本里除了产品源码(**按设计保留** —— 无笔记组读 MemoryProxy 自己想到 files/download 是允许的结果),还有我们自己写的上游 PR 归档,它用大白话写着 files/download 的成功路径返回原始字节。这不是产品的一部分,是评测与被测对象同仓库带来的副产物。两组副本完全相同,所以它只会让无笔记组这个基线更强、让测出的差值更保守;但读者有权知道它在,并知道有几次真的读到了。

它在这些位置:`evaluation/upstream/download-telemetry/`、`evaluation/PR-DESCRIPTION.md`。

| 组 | 计入样本 | 其中读到了它 | 未知 |
|---|---|---|---|
| no-note | 4 | 2 | 0 |
| note | 4 | 4 | 0 |

没有清掉的原因:这 8 次样本是在含它的副本上跑的;现在改 archive_excludes 会让后续样本与它们不可比。要清掉就得两组一起重跑,交给用户决定。

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
- 样本偏在:消费者同为一个模型,身份同为 identity c;两组之间除笔记的准入状态外不做其他变动。
- 生成:`node evaluation/tasks/resource-download/report.mjs`,数据来自 `devloop-runs.json` 与各次运行记录。
