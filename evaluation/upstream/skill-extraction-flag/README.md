# 上游候选:归档响应里看不见提取开关

候选二,按 2026-09-12 专家复核的定位重做。**不是**「任务永不消费」类的缺陷 —— 那个问题
定义是我(审阅侧)先前写错的,已作废;现在的定位是**响应可观测性修复**。

分支 `fix/skill-extraction-flag`,基于上游默认分支 `feat/server_team` 的 `0468a2a`
(worktree `.claude/worktrees/upstream-extract-flag`,与本交付分支历史不相干,不含题目四的
任何改动)。PR 正文见 `PR-BODY.md`。

## 改了什么

`/v3/skill/extract`、`/v3/skill/conversation/add`、`/v3/skill/conversation/force-archive`
三个归档入口的**成功响应**各加一个字段 `extraction_enabled`,回报服务端解析出的
`skill.extraction.enabled`。实现是 `skill-handlers.ts` 里一个 helper + 四处调用点。

该字段只表示配置开关:`true` 不代表 worker 就绪、也不代表抽取已完成;读不到已解析配置时是
`null`,**不是** `false` ——「看不出来」和「关着」是两个答案。错误响应不动;归档契约不动。

## 为什么是 bug

归档成功的响应本身没说错:`SkillTriggerService.archive()` 在 tasks mutex 内依次写归档、
追加 `SkillTaskEntry`、`enqueueAgent`(trigger-service.ts:161 写归档、179 进 mutex、209 入队),三件事都做了。问题在于
调用方分不清「已接收,提取正在进行」和「已接收,但当前配置下提取不会执行」—— 两者都是
`code: 0` + `task_id`。等 skill 出现的客户端会一直等;去轮询 `/v3/skill/list` 的客户端也
分不清「空结果是因为开关关着」还是「这段会话本来没什么可留」。

**我们自己就撞在这上面。** 开发闭环第一轮四次写回(2026-09-11T16:06Z,提取关闭)的记录
`runner/runs/20260911T155035Z-devloop-note/write-back.attempt1.json` 里,响应是
`code: 0` + `task_id`,而我们当时写下的结论只能是:

> "extract accepted but no new asset appeared in the registry within 121s (Core may have
> judged the session had nothing to keep, or the worker is still running); nothing is
> claimed"

—— 那句「无法断定」正是这个 PR 要消除的歧义。

## 怎么复现

```bash
bash evaluation/runner/core-extraction.sh off --record <记录文件>   # 需要 off
bash evaluation/upstream/skill-extraction-flag/reproduce.sh        # 默认跑完清理残留
```

脚本收集专家要求的三项证据,并把它们连同「不主张什么」一起写进
`artifacts/reproduce-<时间戳>.json`:

1. **响应原文** —— `code: 0`、`ok: true`、`task_id`,没有任何字段提示开关状态;
2. **任务确实登记并入队** —— 该 agent 的 `_tasks.json` 里出现了同一个 `task_id`,带
   `enqueued_at_ms`;
3. **worker 起来了但执行不了** —— `[skill-worker-pool] start … concurrency=60`,随后每个
   worker 反复 `ERROR … consumeAgent error: standalone SkillExtractor unavailable`。

第 3 项同时**证伪了我先前的描述**:worker pool 的构造只看 `getResolvedSkillConfig()` 是否
存在(即 `skill.enabled`),不看 `extraction.enabled`,所以提取关闭时 pool 照样启动。

「候选池没有新增」**不作为证据**:正常提取也可能一个候选都不产出。

已跑的一次:`artifacts/reproduce-20260912T175750Z.json`
(`task_id=skill-extract-task-fe84b9ed`,`req_id=req-6f8365f3512d416d`)。

## 多少行

| 部分 | 行数 |
|---|---|
| 实现(`MemoryCore/src/gateway/skill-handlers.ts`) | +26 / −2 |
| 测试(`skill-archive-extraction-flag.test.ts`,6 例) | +125 |
| API 文档 + 两个 SDK 的类型/说明 | +61 / −3 |
| **合计** | **+212 / −5,5 个文件** |

**「100 行以内」这条标准只在实现主体上成立(26 行),整个提交范围不成立。** 专家的原话是
「新增字段需要同步 SDK 类型和说明,因此『10–15 行＋一个测试』可以是实现主体的估计,不能当
完整提交范围」。要压到 100 行以内只能砍掉文档与 SDK 同步,那就退回成「加了个没人知道的字
段」。取舍由你定。

## 与已有 PR 的关系

- **#1117 `fix(skill): expose extraction action outcomes`** —— worker 侧,报告抽取**做了
  什么**(候选结果聚合进日志与任务完成元数据),改 `candidate-outcome.ts` /
  `extract-worker.ts`。本 PR 在抽取开始**之前**的同步响应上,改 `skill-handlers.ts`。文件
  与字段都不重合,方向互补。
- **#1216** 也改 `skill-handlers.ts`,但只动 `handleGet`(上游第 507 行附近),与本 PR 的
  1040 行之后无 hunk 重合;它新建 `__tests__/skill-handlers.test.ts`,本 PR 的测试另起文件名
  以免占用同一路径。
- 查重覆盖**仓库全部历史**(不只九月):按 `extraction_enabled`、`skill.extraction.enabled`、
  三个路由路径、`skill-handlers` / `extract-worker` / `trigger-service`、`force-archive`
  等词检索全部 PR,无第二条动这些响应字段。

## DCO

上游 CONTRIBUTING 第 123 行起要求每个提交带 DCO 签核。两个提交都已带
`Signed-off-by: Vittorio Cai <vittoriocaiyx@gmail.com>`,作者与提交者身份也设成同一个
(本机 `git config` 没设 user.email,默认会落成 `vittoriocai@VittoriodeMacBook-Air.local`,
在上游 PR 上不合适)。**签核是你本人的法律声明,推之前请确认这个身份是你要用的**;要换成别的
(例如 GitHub noreply 邮箱),在 `.claude/worktrees/upstream-extract-flag` 里执行:

```bash
cd /Users/vittoriocai/Desktop/Tecent_agentmemory-project4/.claude/worktrees/upstream-extract-flag
N="<名字>"; E="<邮箱>"
git filter-branch -f \
  --env-filter "export GIT_AUTHOR_NAME='$N' GIT_AUTHOR_EMAIL='$E' GIT_COMMITTER_NAME='$N' GIT_COMMITTER_EMAIL='$E'" \
  --msg-filter "sed \"s|^Signed-off-by:.*|Signed-off-by: $N <$E>|\"" \
  origin/feat/server_team..HEAD
# 核对:身份与签核三处一致
git log --format='%an <%ae> | %cn <%ce>%n%B' origin/feat/server_team..HEAD | grep -E '@|Signed-off-by'
```

## 推送与开 PR(由你手动)

```bash
cd /Users/vittoriocai/Desktop/Tecent_agentmemory-project4/.claude/worktrees/upstream-extract-flag
git push mine fix/skill-extraction-flag
gh pr create --repo TencentCloud/TencentDB-Agent-Memory \
  --base feat/server_team --head VittorioCai:fix/skill-extraction-flag \
  --title "fix(memory-core): expose extraction configuration in skill archive responses" \
  --body-file /Users/vittoriocai/Desktop/Tecent_agentmemory-project4/.claude/worktrees/topic4-gate0/evaluation/upstream/skill-extraction-flag/PR-BODY.md
```
