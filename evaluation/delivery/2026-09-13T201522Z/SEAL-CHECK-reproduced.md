# 封版核对 —— 题目四交付

本页由 `evaluation/seal-record.mjs` 从**一次从远端重新克隆的验收**跑出的 `rows.jsonl` 生成,数字不手抄;
那次验收的逐步记录与做法在 `evaluation/delivery/SEAL-f8c1a7f/rows.jsonl`(同目录 `HOW.md` 写明克隆命令与环境)。

## 交付提交

| | |
|---|---|
| 提交号 | `f8c1a7f99ae8e8ca9b62d90f8ca5a5e9707b44f6` |
| 分支 | `topic4-attribution-gate` |
| 浏览入口 | <https://github.com/VittorioCai/TencentDB-Agent-Memory/tree/topic4-attribution-gate> |
| 辅助材料(闸门抽取) | 分支 `gate-core-minimal` `c372d80`,固定比较区间 <https://github.com/VittorioCai/TencentDB-Agent-Memory/compare/0468a2a...c372d80> |

## 复算入口(评委拿到后怎么自己跑)

```bash
git clone --branch topic4-attribution-gate --single-branch https://github.com/VittorioCai/TencentDB-Agent-Memory.git
cd TencentDB-Agent-Memory
node --test $(find evaluation -name '*.test.mjs' -not -path '*/node_modules/*' | sort)   # 纯离线
bash evaluation/deliver-check.sh                                                        # 全部验收,存档到 evaluation/delivery/<时间>/
```

导读从 `evaluation/REVIEW-GUIDE.md` 开头读起;交付说明是 `evaluation/PR-DESCRIPTION.md`;线上状态与逐轮处置在 `evaluation/STATE.md`。

## 封版那次跑出了什么

共 22 步。**离线复算全部通过**;带 diff 的 8 份,**全部 0 行**。

| 步骤 | 退出码 | diff | 说明 |
|---|---:|---:|---|
| `suite` | 0 | — | ℹ tests 746 ℹ pass 746 ℹ fail 0  |
| `selfcheck` | 1 | — | 结论:验证器未全过(seg0=0 seg1=1 seg2=0 seg4=1) 已出现于 [task] task:RE |
| `selfcheck-exit-line-collect` | 1 | — | 结论:验证器未全过(seg0=0 seg1=1 seg2=0 seg4=1) 已出现于 [task] task:RE |
| `rejudge-regenerate` | 0 | — | 14 copies |
| `calibration` | 0 | 0 |  |
| `summary` | 0 | 0 |  |
| `rejudge-diff` | 0 | 0 |  |
| `reparse-exitline` | 0 | 0 |  |
| `devloop-report` | 0 | 0 |  |
| `devloop-report-2` | 0 | 0 |  |
| `devloop-report-3` | 0 | 0 | 计入样本 8 次 |
| `contamination-3` | 0 | — | 样本 8 次:污染 0,未知 0,规则 contamination-2026-09-13c;全部干净 |
| `author-recheck` | 0 | 0 | 5 份重验 |
| `stated-suite-size` | 0 | — | 套件实际 746 个测试;文档里声明当前规模的地方 2 处,全部一致 |
| `generated-reports` | 0 | — | 入库 .md 73 份:叙述 44 份,登记的报告 29 份 —— regenerated 12,figures_c |
| `comparison-figures` | 0 | — | 对照报告的主表与生成的 summary 逐格比对:26 格,全部一致 |
| `reports-executed` | 0 | — | 登记为要重算的 13 份,逐份核对本轮的执行记录与产物,全部对上 |
| `demo` | 0 | — | Segments: 1 live, 5 record, 1 fixture |
| `chain` | 0 | — | 3/3 条 case 成功;21 个环节,其中未证明 3 个 |
| `selection` | 0 | — | 池中 7 项;放行 5 项;挡下 2 项 |
| `conditions-check` | 1 | — | 24 PASS / 41 FAIL;conditions-check 的 41 项 FAIL:批次后的正常变化 15 |
| `live-state` | 0 | — | skill.extraction.enabled: file=unknown container=enabled:f |

## 干净克隆上必然不通过的部分(线上依赖)

这些步骤按设计需要线上栈,干净克隆上**不通过是正确的**,不是缺陷:

| 步骤 | 为什么 | 本次 |
|---|---|---|
| `conditions-check` | 需要 Core + 作者密钥 + docker:Core 读取、容器镜像摘要、消费者记忆各行标 unreadable | 24 PASS / 41 FAIL;conditions-check 的 41 项 FAIL… |
| `selfcheck` | 第【4】段核笔记正文需要 Core;判别值已烧毁,按设计失败,形态由判决器核对 | 结论:验证器未全过(seg0=0 seg1=1 seg2=0 seg4=1) 已出现于 [t… |
| `selfcheck-exit-line-collect` | 同上:笔记 v2 的值已烧毁 | 结论:验证器未全过(seg0=0 seg1=1 seg2=0 seg4=1) 已出现于 [t… |

`demo` 也会降级:无 Core 时第 1 段用夹具、第 5 段不跑(本次 Segments: 1 live, 5 record, 1 fixture)。
离线能跑到什么程度、各需要什么,逐行在 `evaluation/REVIEW-GUIDE.md` 的「干净克隆上什么能复算」一节。

## 还要人工确认的两件(实施者做不到)

- [ ] 评委能打开上面两个链接(fork 可见性)
- [ ] 提交渠道已收到材料

## 剩余缺点(交付时如实列出)

- **小样本、单模型**:批次四 5+5,前两个闭环任务各 2+2,第三个跑了三批,**条件不同,不合并**;
  逐批样本量与通过率见 `evaluation/tasks/resource-download/REPORT.md`(每次验收重算,这里不抄数)。
  这个量级只说方向,不说幅度,不做显著性检验。
- **第三任务的采用归因:补上缺失的资产池快照后闭合,但并非每次都闭合**。原先三批有笔记运行一次 `used` 都没有,
  根因是本任务的笔记从来不在冻结的池快照里(快照在它还是 `candidate` 时冻结,之后才准入),
  `build-events.mjs` 对不在快照里的资产不写任何事件,判决器无从记账 —— 另两个闭环任务本来就带着快照,第三个漏了。
  补上后重判:计入样本的有笔记运行里多数给出 `used`,无笔记运行仍然一次笔记事件都没有;
  逐次数字与两组保真对照见 `evaluation/tasks/resource-download/REJUDGE-POOL.md`(判据先冻结在 `rejudge-criteria.json`)。
  **第一批补不上**:那批笔记是 v1,判别值已烧毁,重判会得到假阴。**改的是评测自己的采集,产品一行没动。**
  那份快照是**事后补录的资产索引**,不是当时冻结的历史池 —— 它支持「笔记内容进入了后续操作并被记账」,
  **不能单凭 `used` 宣称任务成功由这条笔记造成**;行为差异与采用归因是两件事,报告分开陈述。
- **这条结论改过三次口径,前两次都不是根因**:先归因于工作副本里的上游 PR 归档,再归因于归因落点不可达。
  两次都修好了真问题,但都不是拦住 `used` 的那一个。三次都留在 `evaluation/STATE.md` 里,没有抹掉。
- **「最小上下文」一项的证据弱于归因与闸门**:只展示了准入与任务相关性两层分开计数,没有做优化效果的对照。
- **跨人 = 两个用户 id,不是两个人**:全部身份由同一人操作,独立性未建立,报告里没有一处声称建立了。
- **一份生成报告不能在验收里重算**(`REPARSE-DIFF-2026-09-11-exitline.md`),代价与原因登记在 `evaluation/generated-reports.json`。
