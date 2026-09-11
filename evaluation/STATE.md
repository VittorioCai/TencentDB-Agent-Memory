# 交接状态(受控文件)

本文件是证据索引,不替代原始证据和实时核对(CLAUDE.md §15)。接手后先核对实时 HEAD
与本次操作依赖的运行状态,再动手。同一时刻只由一个指定执行会话修改本文件。

| 项 | 值 |
|---|---|
| 当前执行负责人 | 执行会话(Claude Code),worktree `.claude/worktrees/topic4-gate0` |
| 分支 | `topic4-attribution-gate`,远端 `mine`(推送由用户手动完成) |
| 上次验证的实现提交 | 本文件所在提交;本次改动见 `git log -1 -- evaluation/STATE.md` |
| 验证时间 | 2026-09-11 晚(正式名单对齐、验收解析按四条边界重写并重判批次四) |
| 测试 | evaluation 552;Core 122;proxy 24(2026-09-11,全 0 失败) |

## 第 1 件"新实验条件准备齐":已验收

```bash
node evaluation/runner/batch-conditions.mjs --check --conditions=evaluation/gate/artifacts/batch4-conditions.json
```

开批次前实际输出(`evaluation/gate/artifacts/batch4-conditions-check.txt`):61 PASS + 2 NOTE,
退出 0。同时确认:`resolve-tokens.mjs` 从 Core 取回两条明文,sha256 与 tokens.json 一致;
tokens.json 的 version 与内容哈希已同步到 v4(`--check` 里"Core 正文判别值哈希 == tokens.json"
两条 PASS)。

## 第 2 件"正式对照":已跑完并重判,报告在 `evaluation/runner/COMPARISON-2026-09-11-reparsed.md`

按"第 2 件的顺序"逐步:修通分析链 → `--check` 61/61 → gate-off 准备运行两次(`b4-prep`)→
`build-baseline` 冻结证据 → off/on 试跑一对 → 交错正式 off/on 各五次(顺序在
`evaluation/gate/artifacts/batch4-runs.json`)→ `collect-runs.sh` 收记录 → 报告。

2026-09-11 晚按审阅意见收口(顺序即优先级,1–4 已做):

1. **正式名单对齐**:主表只由 `batch4-runs.json` 十个 run id 生成(`calibrate-runs.mjs --manifest=`,
   `experimentOf`);准备、试跑各自另列;同一目录传两遍只算一次。旧解析下正式行:送达
   14/0/5/1、20/20、0.95;使用 13/0/6/0、未知 1、19/20、1.0、覆盖 0.95——与审阅独立重算一致。
2. **多目标解析按四条边界重写**(`verify.mjs` attempts-2026-09-11 + `provenance/shell-requests.mjs`;
   `judge-outcome.mjs` 按"带该资产值的那条请求"配对;`run-once.sh` 两遍验收,带服务端日志与
   探针)。十四次运行在仓库外副本上重判(`rejudge-runs.mjs`),差异 `REPARSE-DIFF-2026-09-11.md`:
   正式十次 4 变——第 1、3、7 次 PASS→ERROR(最后一条消息并发双拨,服务端日志证明 right
   在 0.1 s 内被应答、整条消息跑满 wrong 的超时,没有"最后一次"),第 5 次 FAIL→ERROR
   (一条命令连拨,本次探针没探 10.244.7.19:8096,结果不可分)。新口径:off PASS 1 / 不可判 4,
   on PASS 5/5;校准送达不变,使用 14/0/6/0、未知 0。
3. **三处口径**已改(见新报告):"3 次未观察到该类记忆读取,2 次确认受记忆影响";全批与
   未读子集分别报、不作无偏/保守估计;atomic 足迹是冻结前漏检不是批次后状态。
4. **第 9 次**单独一节:使用检测的真阴性;只关闭 REMAINING.md:94 的第 1 例。

## 批次里发现的三处缺陷(都已定位,处置各不同)

1. **记忆通道未隔离(设计缺口,需决策)。** profiles/ 快照不覆盖 atomic 记忆
   (`vectors.db`、`records/`、`skill_buffer/`)和 `conversations/`;流水线在会话进行中
   就写,模型经 `memory-bridge/v3/atomic/search`、`conversation/search|query` 读回。
   第 9 次 gate-off 经 `conversation/query` 拿到 prep 1 整个会话含最终报告。gate-on 五次
   都没读。已补检测:试跑检查点第 17 条"记忆通道"(`evaluation/runner/memory-channel.mjs`
   + 测试 12 条),`--check` 新项"消费者 atomic 记忆足迹为空"(现在 139 行 / 16 会话目录,
   FAIL)。**批次五之前要定隔离方案**,见需决策事项。
2. **快照先于清理(harness,已修)。** `run-once.sh` 把整树 tar 取在 `MEM_EXPECT_EMPTY`
   清理之前,还原时把残留装回,"运行后已回滚"检查点 10/10 FAIL;每次开跑起点仍是空基线
   (guard 生效,`pre_run_cleared_files` 4–5)。已抽成 `evaluation/runner/lib/agent-memory.sh`
   (先清理后快照),`agent-memory.test.mjs` 假 docker 跑真函数,先失败后 4/4。
   **改动未经真实运行**:批次五准备运行前先跑一次 harness 冒烟(不进批次)。
3. **一条命令拨两个目标 / 同一消息并发双拨(判定逻辑,已按审阅四条边界改,已重判)。**
   见上"第 2 件"第 2 点。待决的只剩并发组的判定规则(下)。

## 需决策事项

1. **atomic / conversation 记忆的逐运行隔离方案**(批次五前置)。可选:
   (a) 每次运行换全新 agent id(proxy `debugForceIdentity` 跟着改并重启,十次重启);
   (b) 批次期间关闭该消费者的记忆生成(要找 proxy/Core 的开关,未查);
   (c) Core 加按 agent 删 atomic/conversation 的管理接口(动产品代码,需团队管理员);
   (d) 整库快照还原(会连带别的 agent 的写入,不推荐)。执行会话倾向 (a) 或 (b)。
2. **并发发出、结果不一致的最后一组请求怎么判**:现按"不可读不是失败"记 ERROR;替代是
   按完成时间取最后(六次都是 wrong 最后完成 → FAIL)或"全部成功才 PASS"。任一种都不会
   把这六次判成 PASS。定了才能把批次三按新口径另报。
3. `bridge-name` 场景的验收仍用旧解析(整段含标记),是否同步改。

## 下一步(审阅 2026-09-11 定的顺序)

5. **最小开发闭环**:历史资产 → 真实 BugFix/Feature → 测试 → 回执 → 候选处理;复用已有
   导入/抽取/检索,不建新组件。
6. **交付前**:demo 接真实工件、一次真实冒烟、交付复跑、整理 PR。
7. 有余量再做隔离反证验证或批次五;不得据此声称额外工作已完成。

## 批次五之前必须做的事(按序,仅当做到第 7 步)

1. 定决策 1(和 2、3)。
2. `fill-traces.mjs` 换新 trace(v4 已烧:明文在收集的记录、消费者残留,以及旧报告与
   已删测试文件的 git 历史里),资产升 v5;用户跑 `core-gate.sh --reset` 恢复 approved。
3. 新消费者或清空消费者(含 atomic/conversation,按决策 1);`--freeze` 记新的 `run-once.sh`
   哈希与 atomic 足迹;`--check` 全过(64 项)。
4. harness 冒烟一次(不进批次):`hash_restored == hash_before`、记忆通道 PASS、两遍验收产出
   `verdict.pass1.json` 与 `verdict.json`。
5. 准备运行 → build-baseline → 试跑一对逐条 17 条 → 正式交错。

## 证据位置

| 什么 | 在哪 |
|---|---|
| 批次四对照报告(新口径) | `evaluation/runner/COMPARISON-2026-09-11-reparsed.md`;表格 `summary-2026-09-11-reparsed{,-noread}.md`;校准 `attribution/CALIBRATION-batch4-reparsed-2026-09-11.md`;差异 `attribution/REPARSE-DIFF-2026-09-11.md` |
| 旧口径(保留) | `evaluation/runner/COMPARISON-2026-09-11.md`(顶部有取代说明)、`summary-2026-09-11.md`、`attribution/CALIBRATION.md`(名单已对齐)、`CALIBRATION-2026-09-11-as-committed-ef22463.md` |
| 重判副本(仓库外,可重生成) | `/private/tmp/topic4-rejudge/2026-09-11/<run_id>/`,命令在新报告开头 |
| 条件清单(冻结 2026-09-10T23:21:51Z) | `evaluation/gate/artifacts/batch4-conditions.json` |
| 闸门基线(冻结 23:20:45Z,source_runs = 两次 b4-prep) | `evaluation/gate/artifacts/gate_baseline_batch4.json` |
| 批次清单(顺序、退出码) | `evaluation/gate/artifacts/batch4-runs.json`;驱动日志 `batch4-runs.log`(本地,按 .gitignore 不入库)|
| 核对输出 | `batch4-conditions-check.txt`(开批次前 61+2)、`batch4-conditions-check-post.txt`(批次后 53/9/2) |
| 检查点输出 | `batch4-trial-gate-{off,on}.txt`(开批次前 16 条)、`batch4-formal-checkpoints.txt`、`batch4-prep-trial-checkpoints.txt`(17 条) |
| 运行记录(不入库) | `evaluation/runner/runs/20260910T23*`,14 个目录;旧批次未改动 |
| 校准报告(生成) | `evaluation/attribution/CALIBRATION.md`;派生隔离审计 `artifacts/isolation-findings.json` |
| 场景记录 / token | `evaluation/tasks/bridge-addr/pair.json`(v4,`batch4` 块)、`tokens.json`(哈希形态) |
| 多目标解析测试 | `evaluation/tasks/bridge-addr/verify.multi-target.test.mjs`、`evaluation/provenance/shell-requests.test.mjs`(待决提案文件已删,已进套件) |

## 线上状态的受控记录(CLAUDE.md §10)

**proxy 配置** `deploy/global-images/.proxy-config/config.yaml`(不受版本控制,含密钥)

| 项 | 值 |
|---|---|
| 变更 | `sessionInit.debugForceIdentity.agent_id` → `agt-giawngxum4`(2026-09-10T23:07:37Z 生效) |
| 备份 | `config.yaml.orig-20260909-before-consumer-switch`(原始,sha256 `4453c5fd…`)、`config.yaml.bak-20260911-before-b3-switch`(切换前);同目录,受 .gitignore 保护 |
| 当前 sha256 | `76428b8b…`(条件清单 `proxy.config_sha256`) |
| 恢复命令 | `cp deploy/global-images/.proxy-config/config.yaml.orig-20260909-before-consumer-switch deploy/global-images/.proxy-config/config.yaml && docker restart tdai-proxy` |
| 验证命令 | `docker logs tdai-proxy 2>&1 \| grep -F '→ initialized' \| tail -1` |

**Core 资产状态**:两条资产 v4;批次结束时 right `approved`、wrong `failed`(最后一次是
gate-on)。恢复 approved 由用户跑 `core-gate.sh --reset --baseline …gate_baseline_batch4.json`。

**消费者记忆**:profiles/ 下 `agt-giawngxum4` 现有 5 个残留文件(最后一次会话的迟到写入,
下一次运行前由 guard 清);atomic/conversation 足迹 139 行 / 16 会话目录,**没有清理办法**
(见需决策 1)。旧消费者 `agt-eiwlwrb0me` 不删。

**运行记录暂存**:`/private/tmp/topic4-runs/` 只剩 `probe-capture.jsonl`;会话目录
`/private/tmp/topic4-sessions/` 保留(含 23:05 那次被删掉的准备尝试 `20260910T230524Z-b4-prep.dqa0`,
它的会话写了记忆,是 prep 1 读到的冻结前残留的来源)。

## 历史节(保留,已完成)

- 冒烟运行 `20260910T154648Z-harness-smoke-v3`:证明有 shell 的模型能从进程表找到仓库并读
  记录文件 → 记录/探针/会话全部出仓库,`record` 类来源算污染。
- token 明文放哪:方案 2(仓库只存 sha256,明文只在 Core 正文)已实现并经 `--check` 验证。
- 方案 3 spike(容器内跑 CLI):可行但未搭起来,非阻塞。
