# 归因/校准 —— 剩余待办

本文件只管归因与校准这条线。题目四的总计划在文档分支。
每条都注明依据来自哪次实际输出,不引用早先的摘要。

---

## 第 0 件 · 已重写(原前提不成立)

**原提法**:`20260905T153518Z-gate-off` 的 `skl-sZFb3KatWY6m` 是全数据集唯一的假阳性,
模型没读到地址却被判 used;需要查清 `10.244.7.19` 的来路。

**现状**:那个前提**已被推翻**,不是靠重跑,是靠修扫描口径。
`delivery-audit.mjs` 记录了成因——SQLite FTS5 的 snippet 会在标点处切分并补空格,
被切开的 token 仍然是 token。按 snippet 还原后,该次运行两个资产都是 `delivered`:

```
| 20260905T153518Z-gate-off | ERROR | complete | skl-sZFb3KatWY6m | hidden=unknown | judged=true | delivered | unsettled | adopted=unknown |
| 20260905T153518Z-gate-off | ERROR | complete | skl-oBaDO5CceKnr | hidden=unknown | judged=true | delivered | unsettled | adopted=unknown |
```

所以:**内容确实送达了**,既不是判定器凭空判定,也不是隔离被绕过。
当初那个"唯一 FP"是**扫描器漏读**,而不是被测系统的错误。

**仍然要做的**:

1. token 的区分度至今没有独立验证。`47318` 是裸五位数,`10.244.7.19` 是部署地址;
   两者都出现在模型自己发出的 curl 命令行里。现有回显判据挡住了命令回显这条路,
   但没有回答"这个串是否可能从环境推出"。
   **办法**:同任务关掉 agent 记忆重跑,看模型是否仍能写出该地址。
2. 若决定更换 token,选环境推不出的高熵串,资产正文写成"地址 = \<高熵串\>"。
   按约定**另跑另报**,不与旧口径合并。这一步的排期影响整批数据,越早决定越省事。

## 第 1 件 · 关闭(附证据)

四项修复均已在代码中,逐条核对:

| 项 | 位置 |
|---|---|
| 回显从整个 `judged` 集合剔除,再排等级 | `delivery-audit.mjs` `const real = judged.filter((h) => h.kind !== "echo")` |
| 覆盖已断言时 `model_authored` / `model_echo` → `"no"` | `calibration.mjs` `reachedInTime(verdict, coverageAsserted)` |
| `gate` 缺失时 `hidden` 记 `null`,不折叠成 `false` | `calibrate-runs.mjs` `hiddenOf()`;`classify()` 对 `hidden === null` 单独返回 unsettled |
| per-run 表加 run verdict 一列 | `calibrate-runs.mjs` 输出表头 |

现表中"隐藏状态未记录 6 项"就是第三项生效的直接体现——批次一那 6 个判定不再被
静默记成真阴性。

## 第 2 件 · 保留

隔离要区分**两件不同的事**,现在只做到第一件:

1. **恢复同一记忆基线** —— 每次运行前后快照/还原 `profiles/<team|agent>/`,
   保证 N 次运行从同一状态出发。已实现(`run-once.sh`,`run.json` 的 `agent_memory`
   记 before/after 哈希与 `isolated`)。
2. **排除答案来源** —— 记忆基线本身可能已经含有答案(地址、SOP 结论)。
   把每次运行还原到"同一份已含答案的基线",五次运行是独立了,但五次**都被污染**。
   这一件**未做**。需要的是一个不含任何场景结论的干净基线,并在运行前校验它不含
   token 与场景地址。

**其余**:

- **污染记录这条路是断的,已核实**。`runInput` 读的是 `run.contaminated_by`,
  而 `runs/` 下**没有任何一次运行写过这个字段**(0/35),所以报告里"受污染的运行"
  一节永远不会出现——包括已知确实被污染的 `20260908T075637Z-gate-on-core`。
  与此同时 runner **确实**写了隔离信息,但在另一个字段:

  ```
  agent_memory: { hash_before, hash_after, written_during_run: false, isolated: true }
  ```

  `runInput` 不读它。**要做的是把 `agent_memory.isolated` 接进污染判定**,
  并注意第三种取值:隔离改造之前的运行根本没有 `agent_memory` 字段,
  那是 **未知**,不是 `isolated: false`,也不是 `true`。
- **on/off 对照要在同等隔离条件下重做**。已核实:`runs/` 下只有五次
  `*-gate-on-iso`,没有任何 `gate-off-iso`。两臂隔离条件不同,对照的说服力打折。
  这一步涉及模型重跑,不在本阶段范围。

## 第 3 件 · 保留

反例场景必须是**真实产生**的,不能靠手工填 `used` 标签来证明检测有效——
那样测的是分类函数,不是判定器。

按优先级:

1. **模型确实读了资产,但操作不使用它** —— 让使用检测的假阴性从"是 0"变成
   "可达而恰好是 0"。这是当前最缺的一格:两张表的 FN 列都是 0。
2. 不读而猜中(真假阳性)。
3. 两个资产共享同一 token —— `shared_with` 字段至今没有被任何真实数据验过。
4. 到达晚于操作。
5. 隐藏内容经系统提示 / 记忆到达 —— 应记隔离失败,不是假阳性。

---

## 需要决策

- **token 换不换**(见第 0 件)。换则旧数据按旧口径另报,不合并。
- **gate-off 臂是否在隔离条件下重跑**。不跑则对照两臂条件不同,报告须写明。
