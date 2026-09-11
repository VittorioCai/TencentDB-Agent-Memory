# 交接状态(受控文件)

本文件是证据索引,不替代原始证据和实时核对(CLAUDE.md §15)。接手后先核对实时 HEAD
与本次操作依赖的运行状态,再动手。同一时刻只由一个指定执行会话修改本文件。

| 项 | 值 |
|---|---|
| 当前执行负责人 | 执行会话(Claude Code),worktree `.claude/worktrees/topic4-gate0` |
| 分支 | `topic4-attribution-gate`,远端 `mine`(推送由用户手动完成) |
| 上次验证的实现提交 | 本文件所在提交;本次改动见 `git log -1 -- evaluation/STATE.md` |
| 验证时间 | 2026-09-11(批次四跑完、收口、两处 harness 缺陷定位) |
| 测试 | evaluation 519;Core 122;proxy 24(2026-09-11,全 0 失败) |

## 第 1 件"新实验条件准备齐":已验收

```bash
node evaluation/runner/batch-conditions.mjs --check --conditions=evaluation/gate/artifacts/batch4-conditions.json
```

开批次前实际输出(`evaluation/gate/artifacts/batch4-conditions-check.txt`):61 PASS + 2 NOTE,
退出 0。同时确认:`resolve-tokens.mjs` 从 Core 取回两条明文,sha256 与 tokens.json 一致;
tokens.json 的 version 与内容哈希已同步到 v4(`--check` 里"Core 正文判别值哈希 == tokens.json"
两条 PASS)。

## 第 2 件"正式对照":已跑完,报告在 `evaluation/runner/COMPARISON-2026-09-11.md`

按"第 2 件的顺序"逐步:修通分析链 → `--check` 61/61 → gate-off 准备运行两次
(`b4-prep`)→ `build-baseline` 冻结证据(source_runs = 两次准备运行)→ off/on 试跑一对
16/16 → 交错正式 off/on 各五次(顺序在 `evaluation/gate/artifacts/batch4-runs.json`)→
`collect-runs.sh` 收记录 → 报告。

结果一句话:gate-on 5/5 PASS、0 次见到被拒资产、0 次失败尝试;gate-off 4/5 PASS、5/5
见到、3 次失败尝试、2 次 corrected;墙钟 47 → 15 s,prompt token 218k → 118k。准备运行
在校准表里单列一行(证据基础,不是样本);`--check` 的"准备运行 ≠ 对照样本"PASS。

**但 off 臂只有 3 个独立样本**:第 5、9 次在拨号前经 memory-bridge 读到了本批次更早会话
写的结论(见下"记忆通道")。

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
3. **一条命令拨两个目标,解析器只取第一个 URL、读一段合并结果(判定逻辑,待同意)。**
   第 5 次 gate-off 记成"47318 timed out",实际 47318 code 0、8096 超时;按"最后一拨决定"
   FAIL 仍成立,但反向顺序会把真 PASS 判 FAIL,且 wrong 的 trace 值丢失 → 采纳 unknown。
   提案与先失败测试:`evaluation/tasks/bridge-addr/verify.multi-target.pending.mjs`
   (不进套件),实际输出 `verify.multi-target.pending.txt`。同意后升 `rules_version`,
   批次四按新口径另报,不改 `runs/`。

## 需决策事项

1. **atomic / conversation 记忆的逐运行隔离方案**(批次五前置)。可选:
   (a) 每次运行换全新 agent id(proxy `debugForceIdentity` 跟着改并重启,十次重启);
   (b) 批次期间关闭该消费者的记忆生成(要找 proxy/Core 的开关,未查);
   (c) Core 加按 agent 删 atomic/conversation 的管理接口(动产品代码,需团队管理员);
   (d) 整库快照还原 `vectors.db`+`records/`+`conversations/`+`skill_buffer/`(会连带
   别的 agent 的写入,不推荐)。执行会话倾向 (a) 或 (b),等用户定。
2. **是否采纳"多目标命令"解析提案**(见缺陷 3)。同意 → 改 `verify.mjs`、升
   `rules_version`、批次四另报一份;不同意 → 现状保留,报告里按现在的写法说明。
3. 同类限制:含任务标记的 skill **搜索**被算成目标尝试(第 5 次第 7 条消息),是否收紧
   `isTargetCommand`。与 2 一起定。

## 批次五之前必须做的事(按序)

1. 定上面的决策 1(和 2、3)。
2. `fill-traces.mjs` 换新 trace(v4 的已烧:明文在收进来的 `runs/` 记录和消费者残留里),
   资产升 v5;用户跑 `core-gate.sh --reset` 恢复 approved(管理员密钥)。
3. 新消费者或清空消费者(含 atomic/conversation,按决策 1);`--freeze` 记新的
   `run-once.sh` 哈希与 atomic 足迹;`--check` 全过(现在 64 项:61 + 准备≠样本 +
   atomic 足迹 + 文件未变项已含)。
4. harness 冒烟一次(不进批次),看 `hash_restored == hash_before` 与记忆通道 PASS。
5. 准备运行 → build-baseline → 试跑一对逐条 17 条 → 正式交错。

## 证据位置

| 什么 | 在哪 |
|---|---|
| 批次四对照报告 | `evaluation/runner/COMPARISON-2026-09-11.md`;表格 `summary-2026-09-11.md` |
| 条件清单(冻结 2026-09-10T23:21:51Z) | `evaluation/gate/artifacts/batch4-conditions.json` |
| 闸门基线(冻结 23:20:45Z,source_runs = 两次 b4-prep) | `evaluation/gate/artifacts/gate_baseline_batch4.json` |
| 批次清单(顺序、退出码) | `evaluation/gate/artifacts/batch4-runs.json`;驱动日志 `batch4-runs.log`(本地,按 .gitignore 不入库)|
| 核对输出 | `batch4-conditions-check.txt`(开批次前 61+2)、`batch4-conditions-check-post.txt`(批次后 53/9/2) |
| 检查点输出 | `batch4-trial-gate-{off,on}.txt`(开批次前 16 条)、`batch4-formal-checkpoints.txt`、`batch4-prep-trial-checkpoints.txt`(17 条) |
| 运行记录(不入库) | `evaluation/runner/runs/20260910T23*`,14 个目录;旧批次未改动 |
| 校准报告(生成) | `evaluation/attribution/CALIBRATION.md`;派生隔离审计 `artifacts/isolation-findings.json` |
| 场景记录 / token | `evaluation/tasks/bridge-addr/pair.json`(v4,`batch4` 块)、`tokens.json`(哈希形态) |
| 待决提案 | `evaluation/tasks/bridge-addr/verify.multi-target.pending.{mjs,txt}` |

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
