# 归因判定的校准 — 2026-09-08

判定器说某个资产"被使用了"。这份报告问:**内容真的到达模型了吗,而且早于被判定的那次操作?**

两侧都从原始记录重算,不读任何既有报告:送达来自捕获(`../attribution/delivery-audit.mjs`),判定来自每次运行自己的事件文件,规则版本、基线、模型、资产版本来自 run 目录。重算命令:

```bash
node evaluation/attribution/calibrate-runs.mjs --frozen=gate-rules-2026-09-08f \
  evaluation/runner/runs/2026090[5678]*gate-*/
```

## 判据

**判定错误与隔离失效是两件事**,合并统计会同时美化两者。

| 情形 | 归类 | 为什么 |
|---|---|---|
| 被隐藏 + 确认未送达 + 判 used | **假阳性** | 判定器错了 |
| 被隐藏 + 实际送达(旁路) | **隔离失败** | 判 used 是**对的**,失效的是实验设置;算作判定错误会掩盖真实漏洞 |
| 说不清(覆盖不足 / 替代来源 / 操作之后到达) | **未定** | 不计入任一侧 |

未定不进分母。`rated/total` 就是这批数据里**真正测到了东西的比例**。

| set | TP | FP | TN | FN | isolation failure | unsettled | rated/total | accuracy |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| rules unrecorded | 29 | 0 | 8 | 0 | 0 | 1 | 37/38 | 1 |
| rules gate-rules-2026-09-08f (frozen) | 14 | 0 | 4 | 0 | 0 | 2 | 18/20 | 1 |
| **cumulative** | 43 | 0 | 12 | 0 | 0 | 3 | 55/58 | 1 |

An isolation failure is not a judging error: the asset was hidden and its
content reached the model anyway, so calling it used was right and the
setup was what failed. Unsettled rows — capture that does not cover the
run, an alternative source, an arrival after the operation — count for
neither side; `rated/total` is how much of the batch measured anything.


## 这份数字测的是什么,不是什么

**测的**:归因判定与内容送达是否一致——判定器有没有凭空说"用了"。

**不测的**:这个资产是否真的帮助了任务。送达且被判使用,不等于它起了作用。

**样本极不平衡**:14 个真阳性对 4 个真阴性,**没有一个假阳性、没有一个假阴性**。在一个几乎没有反例的集合上,准确率 1.0 的信息量有限——它说明"没发现判定器凭空判定",不说明"判定器在困难情形下也对"。要让这个数字有分量,需要构造会让判定器出错的场景,那是扩展场景(阶段⑥)的事。

**判据是保守的**:凡是说不清的都归入未定。这意味着真实的错误率**不会被低估**,但可测样本会变小。

**批次一、二的 `rules_version` 未记录**:它们的冻结基线里没有这个字段,所以只能归到 `unrecorded`。它们描述的是旧规则下的历史,不能用来验证 `08f`。能验证 `08f` 的只有批次三那 18 个可测判定。

## 未定的三个是什么

批次三的两个,都来自同一次运行(`20260908T075637Z-gate-on-core`):被隐藏资产与被准入资产的 token **首次到达**都在 agent 自有知识文件里(经工具结果缓存读回),早于任何技能读取,归因跟随首次到达,所以两者都是"存在替代来源"。详见 `../runner/COMPARISON-2026-09-08.md`。

那份知识文件的 `updated_at` 落在批次三自己的窗口内,**跨运行累积发现**,是一个需要在扩展场景之前处理的污染源。
