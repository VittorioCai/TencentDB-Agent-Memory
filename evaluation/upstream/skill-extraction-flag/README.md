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

**「100 行以内」这条标准已由审阅方作废(2026-09-12 晚裁定 ①)。** 原话:那条标准是审阅方自己定的,
与专家「10–15 行＋一个测试是实现主体的估计,不能当完整提交范围」矛盾;逻辑只有 26 行、评审成本很低,
砍掉文档与 SDK 会退回成「加了个没人知道的字段」,反而更差。**按现在的 +212/−5 提。**

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
在上游 PR 上不合适)。**身份已由用户确认(2026-09-12 晚裁定 ②):`Vittorio Cai <vittoriocaiyx@gmail.com>`,照此签核,
两个提交都已带该签核。** 若日后要换身份,在 `.claude/worktrees/upstream-extract-flag` 里执行:

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

## 另外两个候选:已被占,不提

- **候选一**(会话/检索丢 source 字段)→ 上游 **#1348** `fix(memory-core): preserve source fields in
  conversation search`(2026-09-11,Bryce-border)已占。
- **候选三**(proxy 在 auth verify 调用上不带 Bearer)→ 上游 **#1349** `fix(proxy): send a configurable
  bearer on the auth verify call`(2026-09-11,L4XB)已占。

两条都在 2026-09-11 开出,晚于我们实测撞到的时间但早于我们提出,已放弃。**审阅裁定:不提。**

## 开 PR 的 base 必须是 `feat/server_team`

上游的默认分支是 `feat/server_team`,**不是 `main`**。`main` 是另一份**根提交都不相同**的公开分支,
里面根本没有 skill 这套代码:

```
$ git ls-tree --name-only origin/main | grep -c MemoryCore   # → 0
$ git rev-list --max-parents=0 origin/main                   # 7a5fce9…
$ git rev-list --max-parents=0 origin/feat/server_team       # 另一个根,与 main 无合并基线
```

base 选错会当场露怯:对着 `main` 提这个 PR,diff 会变成"新增整个 MemoryCore"。

## 推送与开 PR(由你手动)

`PR-BODY.md` 按上游的 `.github/PULL_REQUEST_TEMPLATE.md` 排版(Description / Related Issue /
Change Type / Self-test Checklist / Additional Notes)—— `--body-file` 会绕过模板,所以模板的结构
写进文件本身,勾选框也按实际情况勾好(Bug fix + Documentation update;两条自测项各附了跑过的命令
与结果)。

**上游 CI 不会跑这个 PR**:`.github/workflows/pr-ci.yml` 的触发条件是 `pull_request: branches: [main]`,
而本 PR 的 base 是 `feat/server_team`。所以它的四个 job(install / pack / 包体积 / skill 队列隔离守卫)
都不会自动执行,PR 正文里的自测就是唯一证据。我在本地按真实 base 跑了守卫:

```bash
cd .claude/worktrees/upstream-extract-flag/MemoryCore
BASE_REF=origin/feat/server_team bash scripts/ci/check-skill-queue-isolation.sh   # → PASS
npm pack --dry-run | grep -c skill-archive-extraction-flag                        # → 0(测试文件不进包)
```


**正文按 `PR-BODY.md` 原样提交,不加任何 AI 生成标记**(`🤖 Generated with …` 之类)。用户裁定
(2026-09-12):这份工作是"用户主导 + 多方复核",那行标记会让人低估实际投入;提到腾讯官方仓库的 PR
尤其不能带。`--body-file` 提交的就是文件内容,文件里也不许出现该行 —— 两个正文文件都已核过,从未有过。


```bash
cd /Users/vittoriocai/Desktop/Tecent_agentmemory-project4/.claude/worktrees/upstream-extract-flag
git push mine fix/skill-extraction-flag
gh pr create --repo TencentCloud/TencentDB-Agent-Memory \
  --base feat/server_team --head VittorioCai:fix/skill-extraction-flag \
  --title "fix(memory-core): expose extraction configuration in skill archive responses" \
  --body-file /Users/vittoriocai/Desktop/Tecent_agentmemory-project4/.claude/worktrees/topic4-gate0/evaluation/upstream/skill-extraction-flag/PR-BODY.md
```
