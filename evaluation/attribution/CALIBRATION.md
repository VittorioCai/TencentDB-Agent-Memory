# 归因判定的校准

判定器说某个资产"被使用了"。这份报告问:**内容真的到达模型了吗,而且早于被判定的那次操作?**

两侧都从原始记录重算,不读任何既有报告:送达来自捕获(`delivery-audit.mjs`),判定来自每次运行自己的事件文件,规则版本、基线、模型、资产版本来自 run 目录。**这份文档本身由脚本生成**,所以表里的数字不可能和代码不一致:

```bash
node evaluation/attribution/calibrate-runs.mjs --frozen=gate-rules-2026-09-08f \
  --md=evaluation/attribution/CALIBRATION.md evaluation/runner/runs/2026*-gate-*/
```

生成于 2026-09-08T22:12:59.284Z。

## 判据

**判定错误与隔离失效是两件事**,合并统计会同时美化两者。

| 情形 | 归类 | 为什么 |
|---|---|---|
| 被隐藏 + 确认未送达 + 判 used | **假阳性** | 判定器错了 |
| 被隐藏 + 实际送达(**来路不限**) | **隔离失败** | 判 used 是对的,失效的是实验设置 |
| 说不清(覆盖不足 / 来源无法识别 / 全部到达都晚于操作) | **未定** | 不计入任一侧 |

"来路不限"是要点:来源**已识别但不是本资产**(知识文件、缓存的工具结果、另一个技能)仍然是到达,隐藏时就是泄漏;只有来源**无法识别**才算未定。曾经把这两者合成一类,批次三唯一一次真实泄漏因此从表里消失。

判定一个资产是否到达时,**操作之前的每一次到达都要看**,不是只看第一次:一次更早的他源到达会遮住随后一次真实的资产读取,结论可能碰巧对,依据却不成立。每次到达各自判回显与归因,再合成。

## 结果

| set | TP | FP | TN | FN | isolation failure | unsettled | rated/total | accuracy |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| rules unrecorded | 24 | 0 | 8 | 0 | 0 | 6 | 32/38 | 1 |
| rules gate-rules-2026-09-08f (frozen) | 20 | 0 | 9 | 0 | 1 | 0 | 29/30 | 1 |
| **cumulative** | 44 | 0 | 17 | 0 | 1 | 6 | 61/68 | 1 |

An isolation failure is not a judging error: the asset was hidden and its
content reached the model anyway, so calling it used was right and the
setup was what failed. Unsettled rows — capture that does not cover the
run, an alternative source, an arrival after the operation — count for
neither side; `rated/total` is how much of the batch measured anything.


## 这份数字测的是什么,不是什么

**测的**:归因判定与内容送达是否一致——判定器有没有凭空说"用了"。

**不测的**:这个资产是否真的帮助了任务。送达且被判使用,不等于它起了作用。

**冻结规则那一行至今没有任何反例。** 累计里的数字来自多个规则集,读者容易以为反例问题已经解决——没有。能验证 `gate-rules-2026-09-08f` 的只有批次三,而它 FP 0、FN 0,一个反例都没有。累计准确率不能替它作证。

**假阴性一列是 0,而且这个 0 是测出来的,不是够不着。** 六个桶每一个都由 `calibration-reachability.test.mjs` 走**完整链路**验证过——磁盘上的运行目录、真实的 `runInput`、同一个 `classify`,不是把裁定直接喂给分类器。

这条验证本身翻出一个结构缺陷:操作锚点原来取自 used-event 的 `target_ref`,而**没判 used 的运行根本没有 used-event**,于是"内容到达了、判定器没说话"永远落进 `delivered_order_unknown`,假阴性**结构上不可达**。**用来检验判定的锚点不能依赖那个判定。** 锚点已改为取自**验收**(`verdict.json` 的 attempts,记着任务被判定的那次尝试和它的调用 id),无论判定器说什么它都在。换锚点后真实数据一格未变。

所以这一列的 0 现在意味着:在这批数据里,**只要内容到达,判定器就判 used**。它测的更像**送达**而不是**使用**。要把两者分开,需要"模型确实读了资产、但操作不使用它"的真实场景。

**判据是保守的**:说不清一律未定。真实错误率**不会被低估**,但可测样本会变小。

**规则版本未记录的批次**只能描述旧规则下的历史,不能验证冻结的规则。
