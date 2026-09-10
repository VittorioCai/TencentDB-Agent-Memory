# 交接状态(受控文件)

本文件是证据索引,不替代原始证据和实时核对(CLAUDE.md §15)。接手后先核对实时 HEAD
与本次操作依赖的运行状态,再动手。同一时刻只由一个指定执行会话修改本文件。

| 项 | 值 |
|---|---|
| 当前执行负责人 | 执行会话(Claude Code),worktree `.claude/worktrees/topic4-gate0` |
| 分支 | `topic4-attribution-gate`,远端 `mine`(推送由用户手动完成) |
| 上次验证的实现提交 | 本文件所在提交的父提交 `380bdd4`;本次改动见 `git log -1 -- evaluation/STATE.md` |
| 验证时间 | 2026-09-10T15:56Z(重新冻结与核对;冒烟运行 15:46–15:50Z) |
| 测试 | evaluation 469;Core 122;proxy 24(2026-09-10,全 0 失败) |

## 待验收成果:第 1 件"新实验条件准备齐"

**验收命令**

```bash
node evaluation/runner/batch-conditions.mjs --check --conditions=evaluation/gate/artifacts/batch4-conditions.json
```

**期望输出**:60 项全部 `PASS`,末行 `结论:条件一致,可以开试跑`,退出码 0。

**实际输出**(2026-09-10T15:56Z,全文在 `evaluation/gate/artifacts/batch4-conditions-check.txt`):
58 项 PASS,2 项 FAIL,退出码 1。

```
FAIL  token bt-7c4wgsmdac 来源唯一且不可从部署推导
      期望 "clean, not derivable"  实际 "clean=false … found_in=task:README.md,task:pair.json,task:tokens.json"
FAIL  token bt-yf39kfehc5 来源唯一且不可从部署推导
      期望 "clean, not derivable"  实际 "clean=false … found_in=task:README.md,task:pair.json,task:tokens.json"
```

这两项是**设计问题**,不是配置问题:追踪值以明文写在这台机器上模型可读的文件里,冒烟运行
已证明模型能读到它们。修法取决于"token 明文放哪"的决定(见需决策事项)。定了之后改造、
重新冻结、再跑验收命令。

**已关闭的阻塞**:资产准入。两条 v3 资产已是 `approved`,闸门判定未动(decided_at 仍为
2026-09-09T21:19:51Z、decision pending),每条 revision 各 +2——与 `core-gate.sh --reset` 的
两次写入(status、visibility)一致;由用户执行,执行会话未读取管理员密钥。

## 阻塞

- **token 明文在模型可读的磁盘上**(2026-09-10 冒烟运行发现,需决策):见"需决策事项"。

## 冒烟运行 `20260910T154648Z-harness-smoke-v3`(不是样本,不进批次)

目的:让 runner 的三处改动(空目录会话、消费者范围哈希、run.json 新字段)经过一次真实运行。
条件:两条资产都是 candidate(闸门藏起),消费者 `agt-eiwlwrb0me`,记忆基线 0 个文件。

**验证通过的检查点**:`session.cwd` 是 `/private/tmp/topic4-sessions/…`,不是仓库;开跑前项目缓存
0 个文件;捕获的系统提示 `Working directory:` 与之一致;`consumer_scope.files_before` 0、哈希等于
冻结值;`resolved-identity` 是新消费者;捕获完整;`attempts[].value` 两次都带追踪值,采纳判定
两条都得出 true;run 目录 tokens.json 与任务目录一致;还原后新 agent 的 profile 目录不存在。

**结果**:PASS,先拨 10.244.7.19:8096 带 `bt-7c4wgsmdac`,再拨 127.0.0.1:47318 带 `bt-yf39kfehc5`。
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

## 下一步(第 2 件)

0. 用户对"token 明文放哪"作出决定;执行会话据此改造并重新冻结条件,验收命令得到全部通过。
1. (已完成)资产准入。
2. 一对试跑(off 一次、on 一次),逐条过条件清单 `trial_checkpoints`;**不能只看 PASS**。
3. 试跑过检查点后,准备运行建立 v3 证据(gate-on 臂没有证据只能 pending),重新冻结
   `gate_baseline_batch4.json` 的 decisions,再交错跑 off/on 各五次。
4. 旧批次按旧口径单独报告,不合并。

## 需决策事项

**token 明文放哪。** 冒烟运行证明:只要追踪值以明文写在这台机器上模型可读的文件里
(`tokens.json`、`pair.json`、`assets/*.md`、README、测试),被闸门藏起的资产就能从这些文件
"读回来",gate-on 臂形同虚设。三个方向,代价递增:

1. **缓解**:会话期间把任务目录里含明文的文件 `chmod 000`,会话结束恢复;探针等 harness 进程
   不以仓库为 cwd。挡得住不对抗的模型,挡不住 `chmod +r`;报告里只能写"缓解",不能写"隔离"。
2. **明文出仓库**:仓库里只放 token 的 sha256;明文只在 Core 的资产正文里。采纳判定按哈希比
   `attempts[].value`;送达审计在分析时用作者密钥从 Core 管理路径读正文取出明文。资产源文件
   改为占位符,`enter-pool.sh` 入池时填入。改动:enter-pool、tokens.json 格式、adoption、
   delivery-audit、conditions、若干测试。约 4–6 小时。磁盘上仍有 Core 的数据卷,但模型没有
   现成指针。
3. **沙箱**:CodeBuddy 会话在容器里跑,只开到代理的网络。真正的隔离;改动最大,CodeBuddy 能否
   容器化未验证。

我的建议是 2,配合 1 里"harness 进程不以仓库为 cwd"。在你定之前,批次四不开试跑。
已批准的不变:换 token、新消费者、两臂同条件重跑。
