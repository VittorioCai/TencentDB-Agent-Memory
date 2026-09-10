# 交接状态(受控文件)

本文件是证据索引,不替代原始证据和实时核对(CLAUDE.md §15)。接手后先核对实时 HEAD
与本次操作依赖的运行状态,再动手。同一时刻只由一个指定执行会话修改本文件。

| 项 | 值 |
|---|---|
| 当前执行负责人 | 执行会话(Claude Code),worktree `.claude/worktrees/topic4-gate0` |
| 分支 | `topic4-attribution-gate`,远端 `mine`(推送由用户手动完成) |
| 上次验证的实现提交 | 本文件所在提交的父提交 `380bdd4`;本次改动见 `git log -1 -- evaluation/STATE.md` |
| 验证时间 | 2026-09-11(审阅四项修复、重新冻结与核对) |
| 测试 | evaluation 491;Core 122;proxy 24(2026-09-11,全 0 失败) |

## 待验收成果:第 1 件"新实验条件准备齐"

**验收命令**

```bash
node evaluation/runner/batch-conditions.mjs --check --conditions=evaluation/gate/artifacts/batch4-conditions.json
```

**期望输出**:60 项全部 `PASS`,末行 `结论:条件一致,可以开试跑`,退出码 0。

**实际输出**(2026-09-10T15:56Z,全文在 `evaluation/gate/artifacts/batch4-conditions-check.txt`):
58 项 PASS,2 项 FAIL,退出码 1。

```
FAIL  token bt-…(sha256 a97b5919…) 来源唯一且不可从部署推导
      期望 "clean, not derivable"  实际 "clean=false … found_in=task:README.md,task:pair.json,task:tokens.json"
FAIL  token bt-…(sha256 74a29c97…) 来源唯一且不可从部署推导
      期望 "clean, not derivable"  实际 "clean=false … found_in=task:README.md,task:pair.json,task:tokens.json"
```

这两项是**设计问题**,不是配置问题:追踪值以明文写在这台机器上模型可读的文件里,冒烟运行
已证明模型能读到它们。修法取决于"token 明文放哪"的决定(见需决策事项)。定了之后改造、
重新冻结、再跑验收命令。

**已关闭的阻塞**:资产准入。两条 v3 资产已是 `approved`,闸门判定未动(decided_at 仍为
2026-09-09T21:19:51Z、decision pending),每条 revision 各 +2——与 `core-gate.sh --reset` 的
两次写入(status、visibility)一致;由用户执行,执行会话未读取管理员密钥。

## 两条新要求已落地(2026-09-10)

**试跑检查点是可运行的,不只是清单(§13)。**

```bash
node evaluation/runner/batch-conditions.mjs --trial <run 目录> --conditions=evaluation/gate/artifacts/batch4-conditions.json
```

11 条,按四组打分,每条给 PASS / FAIL / UNKN,不设兜底:

- 条件一致性:run 目录 tokens.json 与任务目录一致;规则版本与清单一致;闸门臂已记录;
  开跑状态符合该臂(off=两条 approved;on=按基线判定)。
- 隔离:消费者身份==清单;起点==冻结的消费者基线哈希;运行后已回滚(还原后哈希==起点);
  会话工作目录不是仓库且缓存为空。
- 采集完整性:verifyCoverage 覆盖整段会话。
- 实际采用:验收记录有目标尝试;**每次尝试都带回 trace 值(attempts[].value)**;
  采纳判定对每条资产可判(非 unknown)。

已在冒烟运行上跑过一次证明它工作:它正确判冒烟运行不合格(没有闸门臂、用的是旧
tokens.json、早于 hash_restored),隔离与采用各项 PASS。"不能只看 PASS":末行结论与
PASS/FAIL 无关,只看这 11 条。

**报告按 (rules_version, 实验标识) 分组,旧批次单独一行(用实际输出证明)。**
`calibrate-runs.mjs` 的主表现在是实验分组表:

```
| unrecorded · pre-batch (2026-09-05)        | 0/0/0/0 | ... | 0/6   |
| unrecorded · pre-batch (frozen 2026-09-06) | 24/0/8/0 | ... | 32/32 |
| gate-rules-2026-09-08f · batch3 (frozen)   | 20/0/9/0 | ... | 29/30 |
| **cumulative**                             | 44/0/17/0 | ... | 61/68 |
```

批次四跑出来会是同一表里新的一行(`gate-rules-2026-09-08f · batch4`),不与 batch3
合并。cumulative 跨规则跨实验,只描述历史,不替任何一行作证。全文见
`evaluation/attribution/CALIBRATION.md`。

## 阻塞

- **token 明文在模型可读的磁盘上**(2026-09-10 冒烟运行发现,需决策):见"需决策事项"。

## 冒烟运行 `20260910T154648Z-harness-smoke-v3`(不是样本,不进批次)

目的:让 runner 的三处改动(空目录会话、消费者范围哈希、run.json 新字段)经过一次真实运行。
条件:两条资产都是 candidate(闸门藏起),消费者 `agt-eiwlwrb0me`,记忆基线 0 个文件。

**验证通过的检查点**:`session.cwd` 是 `/private/tmp/topic4-sessions/…`,不是仓库;开跑前项目缓存
0 个文件;捕获的系统提示 `Working directory:` 与之一致;`consumer_scope.files_before` 0、哈希等于
冻结值;`resolved-identity` 是新消费者;捕获完整;`attempts[].value` 两次都带追踪值,采纳判定
两条都得出 true;run 目录 tokens.json 与任务目录一致;还原后新 agent 的 profile 目录不存在。

**结果**:PASS,先拨 10.244.7.19:8096 带 `bt-…(sha256 a97b5919…)`,再拨 127.0.0.1:47318 带 `bt-…(sha256 74a29c97…)`。
两条资产都不可读,模型却持有两条各自的追踪值。送达审计:两条都是 `delivered_from_other_source`,
来源是第 24 轮 `cd …/evaluation/tasks/bridge-addr && cat pair.json && cat tokens.json`。模型用 `lsof`
从探针进程的 cwd 找到仓库。**闸门没有旁路;泄漏的是评测自己的记录文件。**

**由此推翻的假设**:"会话在空目录里跑,仓库不可及"。有 shell 的模型能从进程表找到任何目录。
`record` 类来源重新算作污染;验收命令在"token 来源唯一"上会失败,这是对的。

**同时修掉的两处 harness 缺陷**:`hash_after` 被当作还原结果(现记 `hash_restored`);tokens.json
的说明键混进资产列表(已移除并加过滤)。

## 证据位置

| 什么 | 在哪 |
|---|---|
| 批次四条件清单(冻结) | `evaluation/gate/artifacts/batch4-conditions.json` |
| 批次四闸门基线 | `evaluation/gate/artifacts/gate_baseline_batch4.json`(无 v3 证据,判定 pending) |
| 核对输出 | `evaluation/gate/artifacts/batch4-conditions-check.txt` |
| 资产池快照(v3,含被闸门藏起的候选) | `evaluation/provenance/artifacts/asset-pool-snapshot.json`(不入库,由 `snapshot-assets.sh` 重生成) |
| 场景记录 | `evaluation/tasks/bridge-addr/pair.json`(顶层已对齐 v3 与新消费者;`batch4` 块) |
| 新 token | `evaluation/tasks/bridge-addr/tokens.json`(`adoption_fields: ["value"]`) |
| 派生隔离审计 | `evaluation/attribution/artifacts/isolation-findings.json` |
| 校准报告 | `evaluation/attribution/CALIBRATION.md`(生成) |
| 旧批次原始记录 | `evaluation/runner/runs/`,未改动 |

## 线上状态的受控记录(CLAUDE.md §10)

**proxy 配置** `deploy/global-images/.proxy-config/config.yaml`(不受版本控制,含密钥)

| 项 | 值 |
|---|---|
| 变更 | `sessionInit.debugForceIdentity.agent_id`:`agt-5e0y4l8a7a` → `agt-eiwlwrb0me` |
| 备份 | `deploy/global-images/.proxy-config/config.yaml.orig-20260909-before-consumer-switch`(同目录,受 .gitignore 保护,不进 Git) |
| 备份 sha256 | `4453c5fd…`(全值在条件清单 `rollback.proxy_config.backup_sha256`) |
| 当前 sha256 | `4b6309b4…`(条件清单 `proxy.config_sha256`) |
| 差异 | 仅第 51 行 agent_id,已用 diff 核对 |
| 恢复命令 | `cp deploy/global-images/.proxy-config/config.yaml.orig-20260909-before-consumer-switch deploy/global-images/.proxy-config/config.yaml && docker restart tdai-proxy` |
| 验证命令 | `docker logs tdai-proxy 2>&1 \| grep -F '→ initialized' \| tail -1`(下一次会话应显示对应 agent) |
| 生效核对 | 容器 StartedAt 2026-09-09T21:23:05Z ≥ 配置 mtime,已在核对项里 |

**Core 资产状态**:两条资产由 v2 升 v3(`/v3/skill/update`,expected_version 2),闸门判定未继承
(candidate/pending,已实测)。回退方式:再发一次 update 写回 v2 正文会产生 v4,不能"降回";
v2 正文在 git 历史(`4801803` 之前的 `assets/*.md`)。

**新 agent** `agt-eiwlwrb0me`(owner usr-4u07qc2kuj,名 Topic4-Consumer-B2):记忆 profile 尚未
生成,即空基线。不删。

## token 明文放哪 —— 已决定并实现(方案 2)

用户定:方案 2(明文出仓库)。已实现,见提交 `9cfe802`:仓库只存 sha256;明文只在 Core
的资产正文里;`fill-traces.mjs` 生成全新 trace 填进 Core(v4)、只把 sha256 写进
`tokens.json`;`resolve-tokens.mjs` 分析时用作者密钥从 Core 取回校验;`adoption.mjs` 新增
哈希模式;资产源文件是占位符。旧 bt- 值已进 git 历史即烧掉,换了全新值。方案 3 spike
(见下)非阻塞。

## 到 60/60 的确切步骤(2026-09-11 更新)

审阅四项已修(见提交):解析契约钉住(id、版本、内容哈希、token 哈希),走**管理读取**
(`x-tdai-read-purpose: manage`),所以来源唯一、Core 正文校验、基线扫描在资产 candidate
时也能做——`--check` 里这些项现在已 PASS。剩下三件:

1. **(用户,管理员密钥)恢复 approved**——这是 gate-off 的实验干预(模型路径要能读到
   两条资产),不是证据:
   ```
   bash evaluation/gate/core-gate.sh --reset --baseline evaluation/gate/artifacts/gate_baseline_batch4.json
   ```
2. **(执行会话)清出空消费者**:`agt-eiwlwrb0me` 被冒烟运行的记忆流水线污染成 4 个文件。
   新建一个全新消费者,改 proxy `debugForceIdentity.agent_id` 指向它并重启,`--consumer=`
   用新 id 重新冻结。检查项"消费者基线为空(files==0)"是硬要求,污染的消费者过不了。
3. **(执行会话)重新冻结 + 核对**:
   ```
   node evaluation/runner/batch-conditions.mjs --freeze --batch=4 --consumer=<新消费者> --task=evaluation/tasks/bridge-addr
   node evaluation/runner/batch-conditions.mjs --check --conditions=evaluation/gate/artifacts/batch4-conditions.json
   ```
   期望 61/61、退出 0。

当前实际(2026-09-11,全文 `evaluation/gate/artifacts/batch4-conditions-check.txt`):
58/61,三项 FAIL 全对应上面 1、2:两条资产开跑前状态 candidate;消费者 4 个文件。

## 第 2 件的顺序(2026-09-11 审阅纠正:证据在试跑之前)

v4 基线现在没有结果证据,两条都是 pending;gate-on 一试跑就重判回 candidate,"错资产
failed"的检查点不可能满足。所以顺序是:

1. **修通分析链**(本轮已做):哈希清单经解析契约取明文;运行时 judge-hard/judge-outcome/
   receipt 与分析时 runInput 同一契约;失败中止。
2. **条件核对** `--check` 全过(见上节步骤)。
3. **v4 准备运行**(gate-off,消费者读到两条资产,产生 validated / corrected 结果):
   `run-once.sh --auto --gate off` 若干次;记录留在仓库外。
4. **冻结真实证据与判定**:用 `build-baseline.mjs --runs=<准备运行> …` 生成
   `gate_baseline_batch4.json` 的 events/decisions(`--freeze` 不再覆盖带证据的基线)。
   此时 gate-on 臂才有"错资产 → failed"可判。
5. **off/on 一对试跑**,逐条过检查点(**不能只看 PASS**):
   ```
   node evaluation/runner/batch-conditions.mjs --trial <run 目录> --conditions=…/batch4-conditions.json
   ```
   含:gate-on 被藏资产 hidden=true;响应模型名一致且等于冻结值;会话 cwd 无兄弟目录且
   探针 cwd 不在仓库。
6. **正式对照**:交错跑 off/on 各五次。批次结束、下次换 trace 之前,
   `bash evaluation/runner/collect-runs.sh` 把记录搬进 runs/。
7. 报告按 (rules_version, 实验标识) 分组,批次四单独一行,旧批次不合并。

那条 `core-gate.sh --reset` 是已设计的 gate-off 干预(恢复 approved),不等于 v4 已有验证
证据;证据只能来自第 3 步。

## 方案 3 spike 结论(2026-09-10,≤1h,非阻塞)

- 宿主装的 `codebuddy` 是 macOS 原生二进制(Mach-O arm64),进不了 Linux 容器。
- 真实 CLI 是 npm 包 **`@tencent-ai/codebuddy-code` 2.148.0**,node 实现,**可以**进 Linux
  容器;宿主上另有 **`sandbox-exec`** 可用(macOS 原生沙箱)。
- 结论:方案 3 原则上可行,但本轮没有搭起来验证(容器内强制身份 + 经探针抓包未验)。
  按约定带**威胁模型**上批次(见 `CALIBRATION.md` 的"威胁模型"节),方案 3 留作后续。
