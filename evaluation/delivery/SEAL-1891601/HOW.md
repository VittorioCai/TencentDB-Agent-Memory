# 封版那次验收是怎么跑的

**提交** `189160174184c2a459e296e0e91f5f8898565e13`,分支 `topic4-attribution-gate`。

```bash
git clone --branch topic4-attribution-gate --single-branch \
  https://github.com/VittorioCai/TencentDB-Agent-Memory.git
cd TencentDB-Agent-Memory
bash evaluation/deliver-check.sh
```

跑的是**从远端重新克隆的一份**,不是开发用的工作树;重判目录全新。

## 那台机器当时是什么条件(如实记)

| | |
|---|---|
| 密钥 | **无**。`.topic4-user-key` 与 `.admin-key` 都不在克隆里(未入库) |
| docker | 有(宿主机上装着) |
| Core | 宿主机上**可达** |
| ClickHouse | 宿主机上**可达** |

克隆里没有密钥,所以需要密钥的读取照样失败。**更早的彩排 I 是连 Core 与 docker 都没有,条件不同,分开记。**

## 为什么干净克隆也能自己重判

`rejudge-execute` 这一步要重算第三个闭环任务的采用归因,需要区分来源的标记明文。
这些标记**已经公开**(明文早已随记录进入提交树),由 `build-burned-registry.mjs` 用 `git grep`
逐个证明确在树里之后登记进 `evaluation/attribution/burned-tokens.json`,`resolve-tokens.mjs`
因此可以走**离线路线**。**评委不需要任何凭据,就能自己把那 9 次判定重算一遍**,而不必相信入库的 rows 文件。

登记簿只补一件事:「标记 → 资产版本」的对应关系。它**不引入新的明文**(每个值都已在提交树里);
按它自己的规则,已登记即已公开,**任何后续实验之前必须先换一条新标记**。

## 这次跑出来的结论

逐步记录在同目录 `rows.jsonl`(25 步),完整结论在同目录 `SUMMARY.md`,渲染成 `evaluation/SEAL-CHECK.md`。
**离线复算全部通过。** 唯一未通过的是 `conditions-check` —— 它要读 Core、要作者密钥、要容器镜像摘要,
干净克隆上不通过是正确的,原因在 `SEAL-CHECK.md` 的「干净克隆上必然不通过的部分」一节里逐条列着。

`rows.jsonl` 里两个自检步骤的说明字段带着这次克隆目录的绝对路径 —— 那是这次运行真实打印的内容,
按记录原样保留,不做美化(页面上被截断,不会显示)。
