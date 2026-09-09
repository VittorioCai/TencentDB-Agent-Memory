# 归因判定的校准

判定器说某个资产"被使用了"。这份报告把**三件事分开问**,因为它们的证据不同:

| 问题 | 证据来源 |
|---|---|
| **送达** —— 内容是否到达模型 | 捕获(`delivery-audit.mjs`) |
| **采纳** —— 操作是否实际用了它 | 验收记录 `verdict.json` 的 attempts(`adoption.mjs`) |
| **收益** —— 用了以后是否奏效 | 该次尝试的结果 `attempt.ok` |

采纳的参考判定**不由 delivery 推出,也不由待测的判定器推出**,否则就是拿判定器给自己打分。

**这份文档本身由脚本生成**,表格和正文里的结论都出自同一次计算:

```bash
node evaluation/attribution/calibrate-runs.mjs --frozen=gate-rules-2026-09-08f \
  --md=evaluation/attribution/CALIBRATION.md evaluation/runner/runs/2026*-gate-*/
```

生成于 2026-09-09T20:40:30.370Z。

## 这次分析的口径

- **分析代码**:`delivery-audit.mjs` @ f1c69943b123、`adoption.mjs` @ 7659499a1a6d、`calibration.mjs` @ b59437e4fbe5、`calibrate-runs.mjs` @ f606c61bd5a4
- **规则版本**:gate-rules-2026-09-08f
- **数据范围**:35 次运行,2026-09-05T15:35:18Z → 2026-09-08T22:07:55Z
- **未知项(全数据范围,非仅冻结组)**:送达说不清 6 项;采纳无证据 2 项;隐藏状态未记录 6 项;捕获不完整 1 次

## 判据

**判定错误与隔离失效是两件事**,合并统计会同时美化两者。

| 情形 | 归类 | 为什么 |
|---|---|---|
| 被隐藏 + 确认未送达 + 判 used | **假阳性** | 判定器错了 |
| 被隐藏 + 实际送达(**来路不限**) | **隔离失败** | 判 used 是对的,失效的是实验设置 |
| 说不清(覆盖不足 / 来源无法识别 / 全部到达都晚于操作) | **未定** | 不计入任一侧 |

"来路不限"是要点:来源**已识别但不是本资产**(知识文件、缓存的工具结果、另一个技能)仍然是到达,隐藏时就是泄漏;只有来源**无法识别**才算未定。

判定一个资产是否到达时,**操作之前的每一次到达都要看**,不是只看第一次:一次更早的他源到达会遮住随后一次真实的资产读取,结论可能碰巧对,依据却不成立。

使用检测这一侧的判据不同,参考判定是**采纳**:

| 情形 | 归类 |
|---|---|
| 确已采用 + 判已使用 | 真阳性 |
| 确已采用 + 判未使用 | 假阴性 |
| 未采用 + 判已使用 | 假阳性 |
| 未采用 + 判未使用 | **真阴性**(判对了,不是漏报) |
| 采纳情况未知 | **单独一类**,不进分母 |

## 送达一致性

这张表问的是:判定器有没有凭空说"用了"。
它衡量的是判定与**送达**是否一致。
不能把它当作实际使用的准确率——那要看下一节。

| set | TP | FP | TN | FN | isolation failure | unsettled | rated/total | accuracy |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| rules unrecorded | 24 | 0 | 8 | 0 | 0 | 6 | 32/38 | 1 |
| rules gate-rules-2026-09-08f (frozen) | 20 | 0 | 9 | 0 | 1 | 0 | 29/30 | 1 |
| **cumulative** | 44 | 0 | 17 | 0 | 1 | 6 | 61/68 | 1 |

An isolation failure is not a judging error: the asset was hidden and its
content reached the model anyway, so calling it used was right and the
setup was what failed. Unsettled rows — a capture that does not cover the
run, a source the record cannot name, whether the asset was hidden not
recorded — count for neither side; `rated/total` is how much of the batch
measured anything. An arrival from an identified other source is NOT
unsettled: the content did reach the model.

**规则 gate-rules-2026-09-08f · 送达一致性**:可评 29/30,假阳性 0 个,假阴性 0 个,准确率 1。

这一组里假阳性 0 个、假阴性 0 个。在几乎没有反例的集合上,准确率的信息量有限——它说明"没发现判定器凭空判定",不说明"判定器在困难情形下也对"。

说不清的 1 项不计入分母(共 30 项,可评 29 项)。上面的比率只描述这 29 项;被排除的 1 项既没有算判对也没有算判错,它们是否恰好富含错误,这批数据答不了。

## 实际使用(参考判定 = 采纳)

| set | TP | FP | TN | FN | 采纳未知 | rated/total | accuracy | 采纳证据覆盖率 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| rules unrecorded | 28 | 0 | 8 | 0 | 2 | 36/38 | 1 | 0.947 |
| rules gate-rules-2026-09-08f (frozen) | 20 | 0 | 10 | 0 | 0 | 30/30 | 1 | 1 |
| **cumulative** | 48 | 0 | 18 | 0 | 2 | 66/68 | 1 | 0.971 |

**规则 gate-rules-2026-09-08f · 使用检测**:可评 30/30,假阳性 0 个,假阴性 0 个,准确率 1。

这一组里假阳性 0 个、假阴性 0 个。在几乎没有反例的集合上,准确率的信息量有限——它说明"没发现判定器凭空判定",不说明"判定器在困难情形下也对"。

这一组 30 项全部可评,没有项被排除在分母之外。

**采纳证据的覆盖率是 1**,其中 0 项没有独立证据可判,已单独计为"采纳未知",没有进分母。

### 收益不等于采纳

采纳且奏效 15 项,采纳但未奏效 4 项,采纳而收益未知 1 项。
资产被用上了不代表它帮到了任务;这一列就是把两者分开看的地方。

## 独立性

**受污染 0 次。**

**隔离状态未记录 30 次** —— 这些运行早于隔离改造,没有 `agent_memory` 字段。未记录不等于干净,它们既不能算独立样本,也没有证据说不是:

- `20260905T153518Z-gate-off`
- `20260905T214807Z-gate-off`
- `20260905T220020Z-gate-off`
- `20260905T223401Z-gate-off`
- `20260906T092114Z-gate-off`
- `20260906T093110Z-gate-off`
- `20260906T111638Z-gate-off`
- `20260906T112924Z-gate-on`
- `20260906T112957Z-gate-on`
- `20260906T113049Z-gate-on`
- `20260907T094429Z-gate-off-core`
- `20260907T094558Z-gate-off-core`
- `20260907T094700Z-gate-off-core`
- `20260907T094823Z-gate-off-core`
- `20260907T094930Z-gate-off-core`
- `20260907T095021Z-gate-on-core`
- `20260907T095050Z-gate-on-core`
- `20260907T095122Z-gate-on-core`
- `20260907T095146Z-gate-on-core`
- `20260907T095207Z-gate-on-core`
- `20260908T075149Z-gate-off-core`
- `20260908T075239Z-gate-off-core`
- `20260908T075324Z-gate-off-core`
- `20260908T075410Z-gate-off-core`
- `20260908T075500Z-gate-off-core`
- `20260908T075544Z-gate-on-core`
- `20260908T075604Z-gate-on-core`
- `20260908T075620Z-gate-on-core`
- `20260908T075637Z-gate-on-core`
- `20260908T075749Z-gate-on-core`

## 这份数字测的是什么,不是什么

**测的**:上面两件事——判定与送达是否一致,判定与采纳是否一致。

**不测的**:这个资产对任务的贡献有多大。采纳且奏效,也不等于换一个资产就做不成。

**规则版本未记录的批次**只能描述旧规则下的历史,不能验证冻结的规则。

**未知项不是零**:上面"这次分析的口径"里列出的每一类未知,都是这批数据没能测到的部分,不能读作"没有问题"。
