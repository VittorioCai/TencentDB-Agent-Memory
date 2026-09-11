# 评审导读:每条主张对应哪个文件、怎么复算

这一页给评审用:先说主张,再给证据文件和一条能跑的命令。数字不在这里抄,在各报告里(全部脚本生成);
`bash evaluation/deliver-check.sh` 一次复跑所有验收命令并把生成报告与提交副本做 diff,存档在 `evaluation/delivery/<时间>/SUMMARY.md`。
分支 `topic4-attribution-gate`;交付形式见 `evaluation/PR-DESCRIPTION.md`;状态与线上环境见 `evaluation/STATE.md`。
原始运行记录在分支里:`evaluation/runner/runs/20260910T23*`(批次四,14)与 `20260911T1*-devloop-*`(闭环,23),每目录只少一个无脚本读取的
`capture-before.jsonl`(清单与哈希 `evaluation/gate/artifacts/run-records-committed-2026-09-12.json`);重判副本由 `deliver-check.sh` 按需重生成。

## 干净克隆上什么能复算,什么需要线上(2026-09-12 彩排实测)

`bash evaluation/deliver-check.sh` 在一个没有密钥、没有 Core、没有 docker 的克隆上跑过(`evaluation/delivery/rehearsal-*`
不入库,结论如下);每一步的依赖写在这里,评审不必猜。

| 步骤 | 干净克隆(无密钥、无 Core) | 需要什么 |
|---|---|---|
| 单元套件 604 | ✅ 全过 | 无 |
| 批次四重判副本重生成、校准表、汇总表、重判差异、退出行 reparse | ✅ 与提交副本 diff 0(重判差异只差副本路径一行) | 已烧毁值登记簿 `attribution/burned-tokens.json`(值早已在提交的记录里;无登记簿则这几步跳过并说明) |
| 两个闭环 REPORT | ✅ diff 0 | 无 |
| 两个 selfcheck 【0】–【3】 | ✅ | 无;【4】离线时只核版本与 sha256,可见性与 content_hash 标 SKIP |
| demo 7 段 | 6 段(record/fixture),第 1 段"资产池"离线降为夹具 | 第 1 段与第 5 段的 live 需要 Core + 作者密钥 |
| 条件核对 `batch-conditions --check` | 文件哈希、基线等本地项可核;Core 读取、容器镜像、消费者记忆各行标 unreadable / 未冻结,不算通过 | 线上各行需要 Core + docker + 密钥 |
| 线上状态一节 | 只记录,不判决 | Core + proxy 配置 + 密钥 |

## 一句话主张,和三个否定

**我们把"资产被使用"从模型自述变成了被校准过的可测量量,并让闸门按可信结果在产品里写状态。**

| 否定 | 证据 | 复算 |
|---|---|---|
| 召回 ≠ 使用 | 送达、采纳、收益三件事分开命名(`evaluation/README.md` §8 约定);送达按捕获与服务端日志,采纳按判别值出现在写入调用 / 请求里 | `evaluation/attribution/CALIBRATION-batch4-reparsed-2026-09-11.md` |
| 自述 ≠ 事实 | 模型自报的测试结果只记不判;验收器跑起点测试原内容、自带参考测试 | `evaluation/tasks/exit-code-fix/REPORT.md`"不信模型自报"一节 |
| 省 token ≠ 收益 | contributed 只由留一法对照产出,原始值随事件走 | `evaluation/calibration/README.md` "contributed" 一节,`contributed-events.jsonl` |

## 官方六项任务 → 本分支

| 任务 | 做了什么 | 证据文件 | 复算命令 |
|---|---|---|---|
| 一 历史经验学习 | 经验笔记从批次四记录与代码整理而来,入池只存 sha256;任务结束由产品 `/v3/skill/extract` 从会话提取候选 | `tasks/exit-code-fix/assets/note.md`(占位符)、`write-back.json` 各运行目录、`REPORT.md` "新经验回流候选池" | `node evaluation/tasks/exit-code-fix/report.mjs` |
| 二 检索与最小上下文 | 未另建检索;送达只经产品自己的 `skill_search`,注入块对新 agent 为空(这是产品事实,报告写明) | `tasks/exit-code-fix/README.md`、`LESSONS.md` "送达机制" | — |
| 三 使用链路与可信归因 | recalled / injected / fetched / used / validated / corrected 六态;结果按调用不按运行;关系 cross_user 由服务端推导;只读受信行 | `evaluation/README.md`、`gate/README.md` "The rules"、`attribution/` | `node evaluation/attribution/calibrate-runs.mjs …`(命令在报告开头) |
| 四 用户可感知回执 | 一资产一行一标记;来源与消费者同行;"相关测试 X 通过"措辞;低置信风险来自闸门 confidence | `receipt/README.md`、各运行 `receipt.txt` | `node evaluation/receipt/render-cli.mjs <run>/receipt.json` |
| 五 效果评测与反事实 | 批次四 gate-off / gate-on 交错各 5 次;留一法 contributed;开发闭环无 / 有笔记各 2 次 ×2 任务(演示,非性能对照) | `runner/COMPARISON-2026-09-11-reparsed.md`、`tasks/*/REPORT.md` | `bash evaluation/deliver-check.sh` |
| 六 经验回流与候选 | 提取候选默认 candidate、私有;闸门规则 admit 需跨人 validated ≥ 1 且无 corrected;作者上下文评估只定复核优先级 | `tasks/exit-code-fix/REPORT.md` "闸门有没有动"、`gate-evaluations.jsonl`、`author/README.md` | `node evaluation/tasks/exit-code-fix/gate-evaluate.mjs --dry-run` |

## 导师 9/4 三条 → 本分支

| 条 | 对应 | 文件 |
|---|---|---|
| ① 置信度是入池 / 回池门禁,系统辅助人判断;离线 + 在线两类指标 | 闸门在 Core 写 status;confidence = 跨人结果中 validated 占比,带分母,无证据为 null;人可推翻、可撤回结果行;pending 资产带复核优先级排队 | `gate/README.md`、`MemoryCore/src/metadata/service/asset-gate.ts` |
| ② 人的因素:作者历史表现、泛化性、使用侧效果 | 作者:闸门信号里其他资产的跨人 validated / corrected 与 30 天内判错资产;`evaluation/author/` 从作者自己的记录做评估(逐条引用、程序核事实、能力只由核实结果推出、永不推出 high)。泛化:`distinct_tasks` / `distinct_consumers` 报告不设阈值;第二任务测同一笔记在另一文件上的迁移。使用侧:结果按调用绑定,收益经留一法 | `author/README.md`、`author/artifacts/assessment-*-exit-line.md`、`tasks/exit-line-collect/REPORT.md` |
| ③(待补) | — | — |

## 离线 / 在线两类指标,对应到代码里的名字

| 导师用词 | 本分支的名字 | 在哪 |
|---|---|---|
| 在线指标 | `signals.online`:按调用收拢的 validated / corrected / used、cross_user_validated、distinct_tasks、distinct_consumers,只读受信行 | `asset-gate.ts`,每条 gate 决定的 `signals` |
| 离线指标 | 判定器校准(送达一致性、使用检测 precision / recall,含隐藏组真阴性)、留一法 contributed、冻结基线 `as_of` | `attribution/CALIBRATION-*.md`、`calibration/`、`gate/artifacts/gate_baseline_batch4.json` |

## 失败案例卡(比正向数字更说明理解)

- 并发双拨、结果不一致的最后一组 → ERROR 不 PASS:`runner/COMPARISON-2026-09-11-reparsed.md`、`attribution/REPARSE-DIFF-2026-09-11.md`。
- 笔记 approved 但 private,检索不到,表现为"未采用":`tasks/exit-code-fix/REPORT.md` "可见性事故"、`visibility-fix.json`。
- 自测全绿、验收 FAIL 的一次:同报告"不信模型自报"。
- 提取关着时 extract 只归档:`extraction-switch.jsonl`、`LESSONS.md`。
- 写入作者评估会重判并撤销刚置的准入:`LESSONS.md`(2026-09-11 第二任务)。
- 证据包漏掉"作者作为消费者"的一本账:`LESSONS.md`、`author/build-evidence-pack.test.mjs`。

## 每份报告都有"测的是什么,不是什么"

批次四:`runner/COMPARISON-2026-09-11-reparsed.md` 开头;闭环:`tasks/exit-code-fix/REPORT.md`、`tasks/exit-line-collect/REPORT.md` 第一节;作者:`author/README.md` "Limits, stated"。
共同的局限:单操作者操作全部身份(跨人是两个用户 id,不是两个人)、单模型、小样本、判别值进过 git 的版本已烧毁。
