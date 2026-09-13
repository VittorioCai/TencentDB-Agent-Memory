# 闸门能不能装进今天的产品:在最新上游上重拆一遍

导师 9/7 的要求是**闸门进 Core**,不是外挂脚本。由此必然被问一句:本分支的闸门是在
一个较早的上游提交上长出来的,**放到今天的上游代码里还装得进去吗、还能构建和测试吗?**
这一页就是那个问题的答案。

**结论:装得进去,代价比预想的小得多。**

## 怎么做的

分支 `gate-core-minimal`,提交 `c372d80`,**基线是上游默认分支 `feat/server_team` 的
`0468a2a`**(而不是本交付分支),worktree `.claude/worktrees/gate-core-minimal`。
树里**没有 `evaluation/`** —— 只有产品代码,证明闸门不依赖评测脚手架。

搬运不是整文件覆盖。共同祖先是 `c0cf94f`,两边此后都改过:21 个文件里 **13 个是双改**。
`git apply -3` 对不上索引,改用 `git merge-file` 逐文件三方合并,一侧最新上游、一侧本分支,
冲突会被标出而不是被覆盖。

## 结果

    21 files changed, 4043 insertions(+), 34 deletions(-)

| | 数量 | 说明 |
|---|---|---|
| 新增(上游没有) | 5 | `asset-gate.ts`、两个闸门测试、`sqlite-adapter.test.ts`、`tsconfig.typecheck.json` |
| 干净合并 | 12 | 含 `server.ts`(上游同期改了 +304/−101,与我们的 +33/−4 完全不重叠) |
| 冲突 | 4 | **每个 1 处,全是同一个模式** |

四处冲突都是 import 列表:上游在尾部加了四个 `InstanceUpstreamConfig*` 类型,我们在同一位置
加了自己的,两边都保留即可。**没有一处语义冲突。** 最担心的 `metadata-service.ts`(+802)
只冲突一处 import。

## 硬验收(受测提交 `c372d80`,树里无 `evaluation/`)

| 命令 | 结果 |
|---|---|
| `npm install` | 通过(仓库无 lockfile,未用 `npm ci`) |
| `npm run build:plugin` | **通过**,产出 `dist/`,8 个文件,1.25 MB |
| `npm test` | **通过**,3 个测试文件 / **132 个测试** |
| `npm run build` | **红** —— 但**纯净上游同样红**:`build:seed-v2` 指向 `scripts/seed-v2/tsconfig.json`,该目录不在仓库里(上游已有 issue **#716** 报过) |
| `npm run typecheck:metadata` | **红 118 条** —— 纯净 `0468a2a` 同配置 **123 条**;本次搬运**新增 0 条**,并消掉 `src/metadata` 里 5 条(11 → 6) |

**"全绿"按字面达不到,原因不在搬运**:后两条在纯净上游上就是红的;`typecheck:metadata` 在本交付
分支上也是红的(127 条)。它从来不是"必须为零"的闸门,是把错误摊开给人看的脚本。

错误数不能直接比字符串——插入代码后既有错误的行号会变。按「文件 + 错误码 + 消息」归一化后再比,
新增为 0;为此另建了一份纯净上游 worktree 做基线,不是凭印象说的。

## 闸门在产品里的位置

**九个接口**,全在 `/v3/meta/asset/` 下,由 `v3-meta-router.ts` 注册:
`outcome/append|list|retract`、`gate/evaluate|get|review|assessment|backfill|submit`。

**八条读路径执行准入**,都经 `skill-handlers.ts` 的 `admissionFilter()`:
`handleGet` / `handleGetByName` / `handleList` / `handleSearch` / `handleVersions` /
`handleFilesRead` / `handleExport` / `handleListing`。

判据是资产注册表(skill id == asset id)。模型路径(`readPurpose` 为 `use`,proxy 的 bridge
与注入器发的就是这个)只放行 approved,调用方自己的资产也不例外;没有资产行的 skill 视为未登记,
拒绝并登记为候选进入复核队列。面板路径(`manage`)按资产自身权限走,且要求请求带的 user key
能解析到所读的那个用户。**失败关闭**:拿不到 metadata service 时,模型路径返回空而不是全部。

## 这件事**没有**证明什么

- **不是**一条上游 PR,也没打算提。三个已知阻碍本轮**没有收口**:准入的默认启用语义、
  MongoDB 适配器的原子性、文档八项。
- **不**代表上游会接受;没有任何人评审过。
- **不**代表线上行为等价 —— 这里验证的是构建、类型与单元测试,不是部署后的端到端。
- 分支**只在本地**,未推送。评委要看 diff 的话需要先推到 fork(推送由用户手动)。

## 复现

```bash
git worktree add <路径> -b <分支> origin/feat/server_team
# 逐文件三方合并:基线 c0cf94f,一侧 origin/feat/server_team,一侧 topic4-attribution-gate
# 四处 import 冲突两边都留
cd <路径>/MemoryCore && npm install && npm run build:plugin && npm test
```

## 事先估计与实际的出入

事先按"13/21 双改"预计要逐块手搬、可能超过一天,因此约定了"超过一天就停下来报告"的规则。
实际用三方合并约十分钟,四处冲突都是 import 列表。**基于最新上游重拆不是一笔大账** ——
这条结论本身也是交付的一部分:它说明闸门与产品的耦合面比看上去窄。
