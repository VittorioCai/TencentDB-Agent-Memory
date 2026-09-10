# 交接状态(受控文件)

本文件是证据索引,不替代原始证据和实时核对(CLAUDE.md §15)。接手后先核对实时 HEAD
与本次操作依赖的运行状态,再动手。同一时刻只由一个指定执行会话修改本文件。

| 项 | 值 |
|---|---|
| 当前执行负责人 | 执行会话(Claude Code),worktree `.claude/worktrees/topic4-gate0` |
| 分支 | `topic4-attribution-gate`,远端 `mine`(推送由用户手动完成) |
| 上次验证的实现提交 | 本文件所在提交的父提交 `380bdd4`;本次改动见 `git log -1 -- evaluation/STATE.md` |
| 验证时间 | 2026-09-10T15:02Z(条件冻结与核对) |
| 测试 | evaluation 464;Core 122;proxy 24(2026-09-10,全 0 失败) |

## 待验收成果:第 1 件"新实验条件准备齐"

**验收命令**

```bash
node evaluation/runner/batch-conditions.mjs --check --conditions=evaluation/gate/artifacts/batch4-conditions.json
```

**期望输出**:60 项全部 `PASS`,末行 `结论:条件一致,可以开试跑`,退出码 0。

**实际输出**(2026-09-10T15:02Z,全文在 `evaluation/gate/artifacts/batch4-conditions-check.txt`):
58 项 PASS,2 项 FAIL,退出码 1。两项 FAIL 相同:

```
FAIL  asset wrong 开跑前状态      期望 "approved"  实际 "candidate"
FAIL  asset right 开跑前状态      期望 "approved"  实际 "candidate"
      修法 bash evaluation/gate/core-gate.sh --reset --baseline evaluation/gate/artifacts/gate_baseline_batch4.json
```

这一步需要团队管理员密钥(`deploy/global-images/.admin-key`),执行会话读取该文件被
安全策略拦下两次,按 CLAUDE.md §14 停下,交用户执行。用户跑完上面那条命令后,再跑
一次验收命令,应得到 60/60。

## 阻塞

- **资产准入**:两条 v3 资产处于 `candidate`,场景前提要求 `approved`。需要管理员密钥。见上。

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

## 下一步(第 2 件)

1. 用户执行准入命令;验收命令得到 60/60。
2. 一对试跑(off 一次、on 一次),逐条过条件清单 `trial_checkpoints`;**不能只看 PASS**。
3. 试跑过检查点后,准备运行建立 v3 证据(gate-on 臂没有证据只能 pending),重新冻结
   `gate_baseline_batch4.json` 的 decisions,再交错跑 off/on 各五次。
4. 旧批次按旧口径单独报告,不合并。

## 需决策事项

- 无新增。已批准:换 token、新消费者、两臂同条件重跑。
