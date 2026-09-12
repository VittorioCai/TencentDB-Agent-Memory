# 上游候选:成功的 skill 下载不产生调用记录

**状态:已提交上游,待审核。**
PR [#1360](https://github.com/TencentCloud/TencentDB-Agent-Memory/pull/1360)
(2026-09-13 开,base `feat/server_team`、head `VittorioCai:fix/proxy-download-telemetry`,
唯一提交 `59c3465`,带 DCO 签核,`+133/−0`、2 文件)。**尚未被接受,也没有任何自动检查结果**
——上游 `pr-ci.yml` 只在 base 为 `main` 时触发,下面写的"通过"一律指本地验证。

分支 `fix/proxy-download-telemetry`,基线 `origin/feat/server_team@0468a2a`,
worktree `.claude/worktrees/proxy-dl-telemetry`,`evaluation/` 零文件混入。

## 问题

`bridge-telemetry.ts` 的契约是**每次上游请求完成发一条 `bridge_call`**。主路径两侧都守着:
拿到响应发一条(含 4xx/5xx)、upstream 不响应也发一条。`files/download` 分支**只有后者**。

这条 bug 最有力的地方是**契约由代码自己承认**:那个 catch 分支的注释写着

> 埋点补齐: 与主路径 :822 对称, upstream 未响应也算一次调用。
> 之前这个 catch 分支静默 return, 导致 curl 视角"打了 N 次" CH 少一条。

同一类洞**有人为失败路径补过,把成功路径落下了**——于是这个分支恰恰在成功时沉默。

实测(真 handler + 桩 sink,见测试):

| 路径 | `bridge_call` 条数 |
|---|---:|
| `files/read` 成功 | 1 |
| `files/download` 成功 | **0** |
| `files/download` 网络异常 | 1 |

**下游确有消费者**(自己核的,未照抄复核方):`MemoryCore/src/gateway/analytics/analytics-sql.ts`
的 `bridge_calls` / `prev_bridge_calls` 两个 CTE 从 `tool_call_logs where kind='bridge_call'`
算调用次数与会话调用率——成功路径缺行,偏的正是"证明 bridge 被用了"那个指标。
仅在配了 ClickHouse 采集的部署上影响持久化统计,这一点写进了正文。

## 修复范围

实现 20 行:在拿到上游响应之后、三个 return(状态非 2xx 原样透传 / 信封不可解析 / 解出字节)
**之前**发一条,与主路径逐字段对齐。放在那儿保证**任何一条路径都不会变成两条**。
响应体、状态码、响应头一律不动;`emitBridgeToolCallTelemetry` 本身吞掉 sink 异常,埋点不阻塞业务。

## 证据与验证(均为本地,非 CI)

- 测试 6 个,**先写后改**:三个一开始就通过(钉住本来就对的行为——网络异常那条、响应本体不变、
  以及 `files/read` 对照),三个失败的现在通过。驱动真 `createSkillBridgeHandler`,注入 fetcher、
  预置会话,用 mock 掉的埋点模块捕获发射,不走网络也不碰 ClickHouse。
- `npx tsc --noEmit` 改前改后同为 **60** 条既有错误。
- `BASE_REF=origin/feat/server_team bash MemoryCore/scripts/ci/check-skill-queue-isolation.sh` → PASS。

## 查重(2026-09-13,覆盖全部历史)

`bridge_call`、`emitBridgeToolCallTelemetry`、`files/download telemetry`、`download telemetry`
**全部零命中**。`bridge-telemetry` 只命中 **#1305**(`feat(proxy): add structured skill access
telemetry`),它也改 `skill-bridge.ts`,但改在第 34 行(import)与主路径埋点内加一个字段展开
(`...extractResolvedSkillAccess(...)`),其 diff 里 `files/download` 出现 **0** 次,
与本 PR 的 620 行区域**无 hunk 重合**。正文的 Overlap 一节说明了这点,并主动问:
若 #1305 合了,同一个字段展开是否也该加到这条新埋点上,另开跟进还是并进来,请他们定。

## 自查发现并已修的三处(推送前)

1. **正文里有一个没测过的数字**:对照表第一行 `files/read 成功 = 1` 原是读主路径代码**推断**的,
   却写成了实测。已补对照测试,现在是真跑出来的(顺带防住主路径重复计数)。
2. **差点又添一个会烂的行号引用**:原注释写"与主路径 `:911` 对称";而这个文件里既有的
   "与主路径 `:822` 对称"**已经烂了**(822 行现在是无关的 console.log,主路径埋点在 906/930)。
   改成按行为引用,并在注释里点明为什么不写行号。既有那处 `:822` **没有顺手改**——保持 diff
   只对准这个 bug,但在正文里单开一节说明并把决定交给维护者。
3. **tsc 基线第一次测出 0 是假的**:`git stash -u` 把 `node_modules` 符号链接一起收走了,
   tsc 根本没跑起来;只 stash 已跟踪改动重测才得到真基线 60 → 60。

## 剩余缺点

- 上游尚未接受;无任何自动检查结果。
- 证据来自源码路径核验与单元测试,**没有做真实部署下的端到端验证**(没有对着跑着的 ClickHouse
  验证行确实落库)。
