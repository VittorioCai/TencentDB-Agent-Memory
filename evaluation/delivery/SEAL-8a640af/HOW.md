# 封版那次验收是怎么跑的

**提交** `8a640af5bcf8cade6fd423eb637c48bf2215d42c`,分支 `topic4-attribution-gate`。

```bash
git clone --branch topic4-attribution-gate --single-branch \
  https://github.com/VittorioCai/TencentDB-Agent-Memory.git
cd TencentDB-Agent-Memory
bash evaluation/deliver-check.sh
```

跑的是**从远端重新克隆的一份**,不是开发用的工作树:6002 个文件,重判目录全新。

## 那台机器当时是什么条件(如实记,不套用上一次的说法)

| | |
|---|---|
| 密钥 | **无**。`deploy/global-images/.topic4-user-key` 与 `.admin-key` 都不在克隆里(未入库) |
| docker | 有(宿主机上装着) |
| Core | 宿主机上**可达** |
| ClickHouse | 宿主机上**可达** |

**与彩排 I(2026-09-12)条件不同**:那次是无 Core、无 docker。这次 Core 与 ClickHouse 在宿主机上是通的,
但克隆里没有密钥,所以需要密钥的读取照样失败。**不把这次说成「无 Core」** —— 条件不同就分开记。

## 判别值:为什么这次干净克隆也能重判

`rejudge-execute` 这一步要重算第三任务的采用归因,需要判别值明文。
这些值**已经烧毁**(明文已在提交树里,CLAUDE.md §16),由 `build-burned-registry.mjs` 用 `git grep`
逐个证明确在树里之后登记进 `evaluation/attribution/burned-tokens.json`;`resolve-tokens.mjs` 因此可以走
**离线路线**,不需要密钥、不需要 Core。所以评委拿到这份克隆,**不用任何凭据**就能自己把那 9 次 `used` 重算一遍,
而不必相信入库的 rows 文件。

登记簿只做一件事:补上「值 → 资产版本」这个映射。它**不引入新的明文**(每个值都已在提交树里),
而按它自己的规则,已登记即已烧毁,**任何后续运行前必须先轮换笔记**。

## 这次跑出来的结论

逐步记录在同目录 `rows.jsonl`(25 步),渲染成 `evaluation/SEAL-CHECK.md`;本次的完整 SUMMARY 也在同目录。
**离线复算全部通过**。唯一未通过的是 `conditions-check` —— 它要读 Core、要作者密钥、要容器镜像摘要,
干净克隆上不通过是正确的,原因在 `SEAL-CHECK.md` 的「干净克隆上必然不通过的部分」一节里逐条列着。
