# 归因判定的校准

判定器说某个资产"被使用了"。这份报告问:**内容真的到达模型了吗,而且早于被判定的那次操作?**

两侧都从原始记录重算,不读任何既有报告:送达来自捕获(`delivery-audit.mjs`),判定来自每次运行自己的事件文件,规则版本、基线、模型、资产版本来自 run 目录。**这份文档本身由脚本生成**,所以表里的数字不可能和代码不一致:

```bash
node evaluation/attribution/calibrate-runs.mjs --frozen=gate-rules-2026-09-08f \
  --md=evaluation/attribution/CALIBRATION.md evaluation/runner/runs/2026*-gate-*/
```

生成于 2026-09-08T21:40:48.470Z。

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
| rules unrecorded | 29 | 1 | 8 | 0 | 0 | 0 | 38/38 | 0.974 |
| rules gate-rules-2026-09-08f (frozen) | 15 | 0 | 4 | 0 | 1 | 0 | 19/20 | 1 |
| **cumulative** | 44 | 1 | 12 | 0 | 1 | 0 | 57/58 | 0.982 |

An isolation failure is not a judging error: the asset was hidden and its
content reached the model anyway, so calling it used was right and the
setup was what failed. Unsettled rows — capture that does not cover the
run, an alternative source, an arrival after the operation — count for
neither side; `rated/total` is how much of the batch measured anything.


## 这份数字测的是什么,不是什么

**测的**:归因判定与内容送达是否一致——判定器有没有凭空说"用了"。

**不测的**:这个资产是否真的帮助了任务。送达且被判使用,不等于它起了作用。

**假阴性一列至今是 0,而这件事本身需要解释。** `未判 used + 内容已到达` 这条分支从未触发,意味着到目前为止**只要内容到达,判定器就判 used**。如果确实如此,那它测的是**送达**,而不是**使用**——恰恰是本课题要区分的东西。要让这一列从"是 0"变成"可达而恰好是 0",需要构造"模型确实读了资产,但操作不使用它"的场景。

**判据是保守的**:说不清一律未定。真实错误率**不会被低估**,但可测样本会变小。

**规则版本未记录的批次**只能描述旧规则下的历史,不能验证冻结的规则。
