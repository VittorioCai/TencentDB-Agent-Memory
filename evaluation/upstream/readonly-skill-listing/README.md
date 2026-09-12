# 上游候选:只读模式下,系统提示仍要求模型修改 Skill

**状态:已提交上游,待审核。**
PR [#1359](https://github.com/TencentCloud/TencentDB-Agent-Memory/pull/1359)
(2026-09-12T23:03Z 开,base `feat/server_team`、head `VittorioCai:fix/proxy-readonly-skill-listing`)。
**尚未被接受,也没有任何自动检查结果**——上游 `pr-ci.yml` 的触发条件是
`pull_request: branches: [main]`,本 PR 的 base 是 `feat/server_team`,四个 job 一个都不会跑。
所以"通过"只指本地验证,不能读成 CI 绿。

分支 `fix/proxy-readonly-skill-listing`,基线 `origin/feat/server_team@0468a2a`,
唯一提交 `2a60304`,worktree `.claude/worktrees/proxy-readonly`。与题目四交付分支历史不相干,
`evaluation/` 零文件混入。

## 问题

`skillRuntime.allowLlmWrite` 的默认值是 **false**(`MemoryProxy/src/config.ts` 的
`DEFAULT_CONFIG`,`config.example.yaml:663` 也这么写)。在这个默认下:

- skill-bridge 对所有写子路径回 `40302` / HTTP 403(`skill-bridge.ts` 的 `WRITE_SUBPATHS` 分支);
- `SkillToolsInjector` **正确地**按开关隐藏 `skill_patch` / `skill_create`
  (`injection/index.ts` 显式传 `?? false`);
- 但 `<available_skills>` 的头部无条件写着 **"If a skill has issues, fix it with the
  `skill_patch` skill-bridge tool."** 与 **"…update it before finishing."**
  ——`skill-injector.ts` 里 `allowLlmWrite` 一次都没出现。

结果:**默认部署下,产品指示模型去用一个从未给过它的工具,调用回 403。** 白费一轮工具往返,
并且留给模型一条执行不了的指令。前提是该 agent 有非空的 skill 列表——列表为 `(none)` 时
注入器不产出这个块,那些会话不受影响。

## 修复范围

只改两件事,共 `+43/−8`(实现,大半是解释开关的注释)+ 103 行测试:

1. `skill-injector.ts`:把两句写指令从头部拆出,按 `allowLlmWrite` 渲染;关闭时换成
   "Skills are read-only in this session…report them in your reply so a human can act on it",
   **不提任何写工具的名字**(提了会把工具名重新放到模型眼前,又诱发那次 403)。
   其余原样:强制加载指令、curl 提醒、listing 本体、footer。
2. `injection/index.ts`:开关本来就在隔壁一行为 `SkillToolsInjector` 算好,同一个值也传给
   `SkillInjector`。

**不动的**:bridge 的 `WRITE_SUBPATHS` 与 40302 分支;`SkillToolsInjector`(它本来就对);
MemoryCore 的同名副本——那个开关在 proxy 侧、Core 不知道,且 Core 的 `SKILL_LISTING_HEADER`
是**导出但从未被 Core 自己引用**的(`/v3/skill/listing` 只返回 `<available_skills>` 行),
所以这条路径上模型看到的就是 proxy 这份。这一点写进了文件注释与 PR 正文。

## 证据与验证(均为本地,非 CI)

| 项 | 结果 |
|---|---|
| 测试 | `MemoryProxy/src/injection/injectors/__tests__/skill-injector-readonly.test.ts`,**9 个,先写后改**(其中 4 个一开始按预期失败),改后全过 |
| 覆盖 | 关闭/打开/不传三态;关闭时无写工具名、有替代动作、其余块不变;打开时两句原文逐字保留;**3 个走真实注入路径**(桩客户端驱动 `SkillInjector.prewarm()`,证明值从 config → 注入器 → 渲染块走通) |
| 类型 | `npx tsc --noEmit` 改前改后都是 **60** 条既有错误,新增 0(该基线数与 #1349 作者独立测得的一致) |
| CI 守卫 | `BASE_REF=origin/feat/server_team bash MemoryCore/scripts/ci/check-skill-queue-isolation.sh` → PASS |

## 查重(2026-09-12 刷新,覆盖全部历史)

基数与 GitHub API 一致:946 个 PR、371 个 issue。

- `skill_patch`、`40302`、`SKILL_LISTING_HEADER`、`write_ops_disabled`、`listing instructions`
  —— **全部零命中**;`allowLlmWrite` 仅 1 条,是无关的 DeepSeek 400 报错 issue。
- 文件级重叠只有 **#1281**(`feat(proxy): add dynamic skill queue strategies`),它同时动
  `skill-injector.ts` 与 `injection/index.ts`,**其中一处改写的正是本 PR 改写的同一行**
  (`new SkillInjector({...})`)。但拉它的 diff 逐行看过:`allowLlmWrite` / `skill_patch` /
  `SKILL_LISTING_HEADER` / 写指令的出现次数都是 **0**,它改的是注入的位置与时机,不处理本问题。
  谁后合谁 rebase,解法是两个字段都留——**已写进 PR 正文的 "Overlap with #1281" 一节**。
- #974 只动 `skill-tools-injector.ts`;#1347 只动 `skill-tools-injector.ts` + `tdai-tools-injector.ts`;
  #967 动 `index.ts` 但在 knowledge 段。均不重合。

## 剩余缺点

- **上游尚未接受**;无任何自动检查结果。
- 只读那句替代文案是**我们选的措辞,属产品表面的决定**,PR 正文当时没有为它留讨论空间。
  已准备一条评论把这个决定交还维护者(措辞可换、整句可删),同时说明唯一有技术含义的部分是
  "不要提写工具的名字"。**该评论是否发出由用户决定。**
- 证据全部来自源码路径核验与单元测试,**没有做真实部署下的端到端验证**。
