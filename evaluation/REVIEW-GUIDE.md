# 评审导读:先看成果,再看证据,最后才是过程

问题 → 一条真实的链 → 三项发现与边界 → 官方六项任务 → 一条复算命令 → 证据入口。
协作约定与逐轮复核历史在第十二节。

数字都在各报告里,**能重算的范围以 [`generated-reports.json`](./generated-reports.json) 的登记为准**
(其中一份登记为不能在验收里重算,原因与代价同页写明)。

## 一、解决什么问题,这个分支新增了什么

产品会把团队资产注入 agent 上下文,但**线索到此为止**:没有记录说 agent 有没有真取回内容、
内容有没有影响改动、结果站不站得住。题目四要的正是这段缺失,而且明确要求**检索和注入不得当作有效使用上报**。

本分支新增四样,都不重新实现检索:

| 新增 | 落在哪 |
|---|---|
| 资产结果记录(送达 / 采用 / 验证 / 贡献,逐层不等价) | [`evaluation/attribution/`](./attribution/)、[`evaluation/provenance/`](./provenance/) |
| **准入闸门写进产品 Core**,按可信结果置 status | [`gate/README.md`](./gate/README.md)、[`MemoryCore/src/metadata/service/asset-gate.ts`](../MemoryCore/src/metadata/service/asset-gate.ts) |
| 用户可感知回执 | [`receipt/README.md`](./receipt/README.md) |
| 判定器校准与留一法收益 | [`calibration/README.md`](./calibration/README.md) |

检索、注入、skill bridge 都是**产品自己的**,本分支一行没有重写。

## 二、一条真实的链:资产 → 操作 → 结果 → 回执

```bash
node evaluation/receipt/chain-cli.mjs --case=main --expand
```

它打印的是**一次真实运行**(`20260911T155035Z-devloop-note`)的七个环节,每环都能打开看证据:

| 环 | 这次跑出什么 |
|---|---|
| 1 原始经验 | 笔记由批次四的运行记录与代码整理而来,不是凭空写的 |
| 2 适用条件 | 写在笔记里:工具结果只给退出码、看不到失败详情时 |
| 3 检索与取回 | 送达 1 次(`fetched`)。**注入清单对这个新 agent 是空的** —— 送达不是注入来的,是模型自己检索拿到的 |
| 4 实际改动 | 1 次尝试,其中带判别值的 1 次 |
| 5 独立验收 | PASS(判据版本 `repo-2026-09-11c`) |
| 6 Core 判定 | 结果已回写产品:1 条,状态 `validated` |
| 7 新候选 | **未证明** —— 本次没有观察到新候选 |

**七环已证 6 环,断在第 7 环,而且就这么显示。** 链条允许断,不允许糊:某一环没有证据就写「未证明」
并说明为什么,绝不拿相邻证据顶替。另外两条 case(`delivered_not_adopted`、`adopted_but_flagged`)
是刻意留的反例 —— 送达了却没采用、采用了却被保守漏判。

## 三、三项最重要的发现,连边界一起说

**① 归因能闭合,但闭不闭合取决于证据有没有收全。**
第三个闭环任务三批共 16 次有笔记运行(计入样本 15 次),按运行当时的记录 **0 次 `used`**。根因不是模型没用笔记,
而是本任务的笔记从来不在冻结的资产池快照里,事件构建器对不在快照里的资产不写任何事件。
补上快照重判:计入样本的有笔记运行 **9/11 出现 `used`**,无笔记运行 **11 次仍 0 条笔记事件**。
**边界**:那份快照是事后补录的资产索引,不是当时冻结的历史池;它支持「笔记内容进入了后续操作并被记账」,
**不能单凭 `used` 宣称任务成功由这条笔记造成**。逐次数字与两组保真对照:
[`tasks/resource-download/REJUDGE-POOL.md`](./tasks/resource-download/REJUDGE-POOL.md)。

**② 闸门是在产品里写状态,不是评测脚本里的一个判断。**
准入决定写进 Core 的 asset status,pending 资产按复核优先级排队;闸门以**上游最新代码**为基线
单独重拆过一遍,证明装得进去(21 文件,四处冲突全是 import 列表)。
**边界**:`confidence` 无证据时为 `null` 而不是 0,且**只定复核优先级,从不做 admit/reject 的依据**;
作者评估同理。见 [`gate/README.md`](./gate/README.md)。

**③ 送达 ≠ 使用 ≠ 收益,三者分开计量,而且每一层都有反例在册。**
送达按捕获与服务端受信行;使用要求证据把**这份资产的内容**关联到后续具体操作,
且被记账的那次取回必须是内容最早到达模型的途径;收益只由留一法对照产出。
**边界**:样本小、单模型,不做显著性检验;「最小上下文」这一项目前只有**两层过滤的分开计数**,
**没有做优化效果的对照**,不能读成已证明省了上下文。

## 四、官方六项任务 → 本分支

| 任务 | 做了什么 | 证据文件 | 复算命令 |
|---|---|---|---|
| 一 历史经验学习 | 经验笔记从批次四记录与代码整理而来,入池只存 sha256;任务结束由产品 `/v3/skill/extract` 从会话提取候选 | [`tasks/exit-code-fix/assets/note.md`](./tasks/exit-code-fix/assets/note.md)(占位符)、`write-back.json` 各运行目录、`REPORT.md` "新经验回流候选池" | `node evaluation/tasks/exit-code-fix/report.mjs` |
| 二 检索与最小上下文 | 未另建检索;送达只经产品自己的 `skill_search`,注入块对新 agent 为空。**两层过滤分开展示**:准入由产品闸门做(与任务无关),任务相关性由模型检索时做 | `node evaluation/attribution/selection-cli.mjs` —— 一次真实运行:池中 7 项 → 闸门挡下 2 项(candidate / failed)→ 已准入 5 项 → 模型取回 1 项 → 进入上下文 2729 **字符**(未测量 token,没有分词器就不报)→ 够不够只引独立验收(PASS 6/6),不另下结论 |
| 三 使用链路与可信归因 | recalled / **selected** / injected / fetched / used / validated / corrected 七态(`selected` 由 `build-early-events.mjs` 在候选清单里观察到:池 → 清单 → 注入这条路径可见;模型自己 `curl` 取回那条路径只到 `fetched`,没有筛选步骤可观察);结果按调用不按运行;关系 cross_user 由服务端推导;只读受信行 | [`evaluation/README.md`](./README.md)、[`gate/README.md`](./gate/README.md) "The rules"、[`attribution/`](./attribution) | `node evaluation/attribution/calibrate-runs.mjs …`(命令在报告开头) |
| 四 用户可感知回执 | 一资产一行一标记;来源与消费者同行;"相关测试 X 通过"措辞;低置信风险来自闸门 confidence | [`receipt/README.md`](./receipt/README.md)、各运行 `receipt.txt` | `node evaluation/receipt/render-cli.mjs <run>/receipt.json` |
| 五 效果评测与反事实 | 批次四 gate-off / gate-on 交错各 5 次;留一法 contributed;开发闭环:前两个任务无 / 有笔记各 2 次,第三个任务(新增功能、行为判定)跑了三批、条件不同不合并,逐批数字见该页(**每批无笔记组都是 0 通过**;有笔记组一、三批全过,**第二批 4/5**,把因污染排除的那次计回去是 4/6);采用归因见 [`tasks/resource-download/REJUDGE-POOL.md`](./tasks/resource-download/REJUDGE-POOL.md) —— 按运行当时的记录 0 次 `used`,根因是本任务的笔记不在冻结池快照里,补上后重判多数给出 `used`、无笔记组仍 0 条笔记事件;首批 16 次因环境污染整批作废(演示,非性能对照) | [`runner/COMPARISON-2026-09-11-reparsed.md`](./runner/COMPARISON-2026-09-11-reparsed.md)、`tasks/*/REPORT.md` | `bash evaluation/deliver-check.sh` |
| 六 经验回流与候选 | 提取候选默认 candidate、私有;闸门规则 admit 需跨人 validated ≥ 1 且无 corrected;作者上下文评估只定复核优先级 | [`tasks/exit-code-fix/REPORT.md`](./tasks/exit-code-fix/REPORT.md) "闸门有没有动"、`gate-evaluations.jsonl`、[`author/README.md`](./author/README.md) | `node evaluation/tasks/exit-code-fix/gate-evaluate.mjs --dry-run` |

## 五、一条命令复算,以及怎么读它的输出

```bash
git clone --branch topic4-attribution-gate --single-branch https://github.com/VittorioCai/TencentDB-Agent-Memory.git
cd TencentDB-Agent-Memory
bash evaluation/deliver-check.sh          # 存档到 evaluation/delivery/<时间>/
```

**先说清楚会看到什么,免得把「按设计」读成「复现失败」:**

- **两类检查都通过时退出码是 0**(线上栈在位的机器上实测如此)。缺线上依赖时整条命令可能非零 ——
  **历史实验的复算不需要任何密钥**,线上环境检查是另一类。**非零不等于复算失败,也不是「正常现象」**:
  真正的离线失败同样会让它非零,所以每次都要看下面那句分开判的结论。
- 结论句在 `evaluation/delivery/<时间>/SUMMARY.md` 末尾,**把两类分开判**:
  「离线复算 通过 / 失败」与「线上检查 通过 / 失败」。**只看离线那半句**就知道能不能复算。
- 另有几步是**按设计应当失败**的(判别值已烧毁的自检、需要 Core 与作者密钥的条件核对),
  判决器会核对它们的**失败形态**对不对,并单独列出原因 —— 它们不算复算失败。
- 干净克隆上实测过一次,逐步记录在 [`delivery/SEAL-8a640af/`](./delivery/SEAL-8a640af/),
  结论页 [`SEAL-CHECK.md`](./SEAL-CHECK.md):**离线复算全部通过**,唯一不通过的是需要 Core 的那一项。

只想跑纯离线的部分:

```bash
node --test $(find evaluation -name '*.test.mjs' -not -path '*/node_modules/*' | sort)
```

## 六、一句话主张,和三个否定

**我们把"资产被使用"从模型自述变成了被校准过的可测量量,并让闸门按可信结果在产品里写状态。**

| 否定 | 证据 | 复算 |
|---|---|---|
| 召回 ≠ 使用 | 送达、采纳、收益三件事分开命名(`evaluation/README.md` §8 约定);送达按捕获与服务端日志,采纳按判别值出现在写入调用 / 请求里 | `evaluation/attribution/CALIBRATION-batch4-reparsed-2026-09-11.md` |
| 自述 ≠ 事实 | 模型自报的测试结果只记不判;验收器跑起点测试原内容、自带参考测试 | `evaluation/tasks/exit-code-fix/REPORT.md`"不信模型自报"一节 |
| 省 token ≠ 收益 | contributed 只由留一法对照产出,原始值随事件走 | `evaluation/calibration/README.md` "contributed" 一节,`contributed-events.jsonl` |

## 七、干净克隆上什么能复算,什么需要线上(封版实测:提交 `8a640af`,记录在 `delivery/SEAL-8a640af/`)

`bash evaluation/deliver-check.sh` 在从远端重新克隆的一份上跑过。**封版那次(`8a640af`)克隆里没有任何密钥**,
宿主机上 docker、Core、ClickHouse 可达,但需要密钥的读取照样失败;更早的彩排 I 是连 Core 与 docker 都没有。
条件不同就分开记,不套用旧说法。下面按**依赖**分三组,最上面一组不需要本仓库以外的任何东西。

**A. 纯离线可跑(克隆下来就能复算)**

| 步骤 | 结果 |
|---|---|
| 单元套件 `node --test evaluation/**/*.test.mjs` | 全过 |
| 三个闭环 REPORT `node evaluation/tasks/*/report.mjs` | 与提交副本 diff 0 |
| 五份作者评估 `assess.mjs --recheck`(不调模型) | 渲染页与提交副本 diff 0 |
| 生成报告登记核对 / 对照报告逐格 / 套件规模声明 | 73 份全部有归属;26 格一致;文档声明与实跑一致 |
| 登记报告的执行核对 `--run-out` | 13 份逐份对上本轮的执行记录与自己的产物 |
| 闭环展示 `chain-cli` | 3/3 条 case 成功,逐次记退出码 |
| 第三任务样本污染批检 `contamination.mjs --batch` | 计入样本的运行全部明确判为干净;已判污染的逐条点名、不进扫描集(与报告同口径)|
| 退出行 reparse `reparse-exit-status.mjs` | 与 `REPARSE-DIFF-2026-09-11-exitline-collect.md` diff 0 |
| 两个 selfcheck 的【0】–【3】段 | 冻结起点、参考测试先失败后通过、套件不回归 |
| demo 的 record 段(7 段中 5 段) | 读已提交记录 |
| 第三任务采用归因**实跑重判** `rejudge-execute` | 三份 rows 从入库归档重算,逐行与入库一致 —— 详见下面 B 组的说明,判别值已烧毁并登记,**不需要密钥** |

**B. 还需要已烧毁值登记簿 `attribution/burned-tokens.json`(已入库,无需密钥)**

| 步骤 | 结果 | 为什么需要 |
|---|---|---|
| 批次四重判副本重生成 `rejudge-runs.mjs` | 14 份副本 | 重判要把判别值明文喂给判定器 |
| 校准表 `calibrate-runs.mjs` | 与 `CALIBRATION-batch4-reparsed-2026-09-11.md` diff 0 | 同上 |
| 汇总表 `summarize-runs.mjs` | 与 `summary-2026-09-11-reparsed.md` diff 0 | 同上 |
| 重判差异 `rejudge-diff.mjs` | 与 `REPARSE-DIFF-2026-09-11.md` 只差副本路径一行 | 同上 |
| 两个 selfcheck 的【4】段 | 只核版本与 sha256;可见性与 content_hash 标 SKIP | 离线核不了 Core 里的正文 |
| 第三任务重判 `rejudge-execute` | 三份 rows 逐行与入库一致(封版那次实测) | 重判要把判别值明文喂给判定器;这些版本已烧毁并登记,所以离线可解析 |

登记簿只对**已烧毁**的值开放(明文早已在提交的记录里),它新增的是「值 → 资产版本」的映射;规则与理由见
`CLAUDE.md` §16 与 `attribution/README.md`。无登记簿时 B 组全部跑不了(彩排 C 实测),A 组不受影响。

**C. 需要线上栈(Core + 作者密钥 + docker),干净克隆上按设计不通过**

| 步骤 | 干净克隆上的表现 |
|---|---|
| 条件核对 `batch-conditions --check` | 文件哈希、基线等本地项照常判;Core 读取、容器镜像、消费者记忆各行标 unreadable / 未冻结,**不算通过** |
| demo 第 1、5 段(资产池、判定准确性) | 第 1 段降为夹具,第 5 段不跑 |
| 线上状态一节 `prepare.sh --status`、`gate-observe.mjs` | 只记录不判决;无密钥时明说"nothing observed" |

## 八、离线 / 在线两类指标,对应到代码里的名字

| 导师用词 | 本分支的名字 | 在哪 |
|---|---|---|
| 在线指标 | `signals.online`:按调用收拢的 validated / corrected / used、cross_user_validated、distinct_tasks、distinct_consumers,只读受信行 | `asset-gate.ts`,每条 gate 决定的 `signals` |
| 离线指标 | 判定器校准(送达一致性、使用检测 precision / recall,含隐藏组真阴性)、留一法 contributed、冻结基线 `as_of` | `attribution/CALIBRATION-*.md`、`calibration/`、`gate/artifacts/gate_baseline_batch4.json` |

## 九、失败案例卡(比正向数字更说明理解)

- 并发双拨、结果不一致的最后一组 → ERROR 不 PASS:`runner/COMPARISON-2026-09-11-reparsed.md`、`attribution/REPARSE-DIFF-2026-09-11.md`。
- 笔记 approved 但 private,检索不到,表现为"未采用":`tasks/exit-code-fix/REPORT.md` "可见性事故"、`visibility-fix.json`。
- 自测全绿、验收 FAIL 的一次:同报告"不信模型自报"。
- 提取关着时 extract 只归档:`extraction-switch.jsonl`、`LESSONS.md`。
- 写入作者评估会重判并撤销刚置的准入:`LESSONS.md`(2026-09-11 第二任务)。
- 证据包漏掉"作者作为消费者"的一本账:`LESSONS.md`、`author/build-evidence-pack.test.mjs`。
- 作者评估在资产没有判别值时,把**别的资产**上的失败当成本资产的强矛盾(第二人复核构造的反例);同一轮还发现能力等级
  统计的是作者的全部业务结果、不按被评估领域筛选:`author/README.md`「这个等级说的是什么:资产结果概况,不是人的能力」、`author/check-citations.mjs`。
- 「来源链完整」其实是三个集合各自非空,相邻关系从未验证:`author/build-evidence-pack.mjs` 的 `chainFacts`、`author/README.md`。
- 报告把「内容送达」读成「判定正确」,被第二人复核挑出:`runner/COMPARISON-2026-09-11-reparsed.md` 复核一节、`attribution/calibration.mjs`。
- **唯一一个"自己记录过这个坑、之后还是踩了"的案例**:提取开关在 2026-09-12 漂移了六小时。我们在提交 c88e955 里
  写下过"部署脚本会把提取写回 on,所以每次运行前必须强制拨回",但只把它当成**跑批次的前置**,没当成**切镜像后的复查项**;
  11:33Z 第二次切镜像用 `start-memory-core.sh` 起容器,该脚本 `cat >` 重新生成整个挂载配置(第 55 行),裁定 ③ 于是在
  11:33Z–17:56Z 之间不在生效,STATE 还一直写着 off。发现纯属偶然——为上游候选二找复现条件时顺手读了一眼线上开关。
  教训:**只复查自己刚改的那一项不够,跑过会重新生成配置的脚本之后,要把它改过的每一项重新读一遍**;
  "曾经设置过"不等于"现在是这个值"。处置、漂移范围比对与拨回后的三条资产读回:`gate/artifacts/extraction-drift-20260912.json`、
  `LESSONS.md` 末条。**没有交付运行受影响**(9/12 零次运行,且 `runner/prepare.sh:81` 在开关不是 off 时硬失败)——
  错的是线上状态和文档对它的描述,不是任何已记录的结果。这一条与上面第四张卡(提取关着时 extract 只归档)是同一个开关的两面:
  那张说产品在这个配置下的行为,这张说我们自己的流程漏了哪一步。

## 十、每份报告都有"测的是什么,不是什么"

批次四:`runner/COMPARISON-2026-09-11-reparsed.md` 开头;闭环:`tasks/exit-code-fix/REPORT.md`、`tasks/exit-line-collect/REPORT.md` 第一节,`tasks/resource-download/REPORT.md` 末节(另有"工作副本里本不该有的那份说明"与"作废批次"两节);作者:`author/README.md` "Limits, stated"。
共同的局限:单操作者操作全部身份(跨人是两个用户 id,不是两个人)、单模型、小样本、判别值进过 git 的版本已烧毁。

## 十一、导师意见 → 本分支(两条)

| 条 | 对应 | 文件 |
|---|---|---|
| ① 置信度是入池 / 回池门禁,系统辅助人判断;离线 + 在线两类指标 | 闸门在 Core 写 status;`confidence` = **该资产跨人结果中 validated 的占比**,带分母 `confidence_n`,无证据为 null(不是 0);人可推翻、可撤回结果行。**复核优先级是另一件事**,由作者上下文评估等信号排序,`confidence` 不参与 admit/reject | `gate/README.md`、`MemoryCore/src/metadata/service/asset-gate.ts` |
| ② 人的因素:作者历史表现、泛化性、使用侧效果 | 作者:闸门信号里其他资产的跨人 validated / corrected 与 30 天内判错资产;`evaluation/author/` 从作者自己的记录做评估(逐条引用、程序核事实、能力只由核实结果推出、永不推出 high)。泛化:`distinct_tasks` / `distinct_consumers` 报告不设阈值;第二任务测同一笔记在另一文件上的迁移;第三任务换一类工作(新增功能)、换一份笔记、采用靠行为判定(`tasks/resource-download/REPORT.md`:三批分列不合并,作废批次与污染检查同页写明;采用归因的更正与两组保真对照在 `REJUDGE-POOL.md`)。使用侧:结果按调用绑定,收益经留一法 | `author/README.md`、`author/artifacts/assessment-*-exit-line.md`、`tasks/exit-line-collect/REPORT.md` |

## 十二、协作约定、原始记录清单与复核历史

<details>
<summary>展开:AI 标记裁定、原始运行记录清单、闸门重拆、逐轮复核处置</summary>


**PR 正文一律按 `PR-DESCRIPTION.md` 原样提交,不加 AI 生成标记**(用户裁定 2026-09-12:这份工作是用户主导 + 多方复核,那行标记会让人低估实际投入;提到腾讯官方仓库的 PR 尤其不能带)。本文件与 `PR-DESCRIPTION.md` 里都没有这类行——曾出现在 fork PR #1 的线上正文里(建 PR 时被自动追加),已用 `gh pr edit --body-file` 覆盖;该 PR 随后按用户决定关闭,交付载体改回分支本身。四条上游 PR(#1358 / #1359 / #1360 / #1361)的正文均已核过,无该标记。

原始运行记录在分支里:`evaluation/runner/runs/20260910T23*`(批次四,14)、`20260911T1*-devloop-*`(前两个闭环任务,23)与 `20260913T1*`(第三个闭环任务:前两批样本与事故运行全量,作废运行只留判决与污染判定;第三批 12 次已入库(与前两批同一套文件,各 48 个)),每目录只少一个无脚本读取的
`capture-before.jsonl`(清单与哈希 `evaluation/gate/artifacts/run-records-committed-2026-09-12.json`);重判副本由 `deliver-check.sh` 按需重生成。

**闸门装得进今天的产品**:分支 `gate-core-minimal`(`c372d80`)以上游 `feat/server_team@0468a2a` 为基线重拆,21 文件 `+4043/−34`,四处**文本合并**冲突全是 import 列表;`build:plugin` 通过、`npm test` 132 个全过;`build` 与 `typecheck:metadata` 红,但纯净上游同样红(`src/metadata` 子树 11 → 6、新增 0;全树 123 → 118、新增 2,那 2 条是同两个未定义名字换了错误码)。**部署后的行为兼容性尚未验证;它支持「具备移植可行性」,不支持「已达上游合入或生产条件」。** 比较基线钉在 `0468a2a...c372d80`。见 `evaluation/gate/PORT-TO-UPSTREAM.md`,原始输出在 `gate/artifacts/port-*`。

### 第二人复核做过了,而且改了东西(2026-09-12)

一位复核者逐条核对了批次四的校准报告,提了五条,全部成立、全部改在生成器里(报告重新生成,没有手改):
送达 ≠ 采用(隔离失败不能推出使用判定正确)、正文不得把正式样本与准备/试跑合并、
「写过记忆」推不出「本次不独立」、报告里的复算命令要是真跑过的那条、威胁模型的措辞收紧。
处置与逐条对照见 `runner/COMPARISON-2026-09-11-reparsed.md` 的「第二人复核(2026-09-12)与处置」一节;
正式组的 20 项判定在复核前后逐项相同——改的是口径,不是数字。

**第二轮**(作者评估与两份闭环报告)又提了六条,同样全部成立、全部改在实现与生成器里:作者评估的相关性边界与领域边界
(两处实际判定缺口)、证据包不再声称"来源链完整"、第二任务的两个采用口径分列、第一任务 v1/v2 分开讲、"缩短定位"改为
未经测量的设计目的。重算用 `assess.mjs --recheck`(不重新调用模型),结果与线上写回见
`author/artifacts/assessment-recheck-2026-09-12.json` 与 `assessment-write-b-readback-2026-09-12.json`:B 的评估由 medium 变
unknown,闸门据此把复核优先级提到 high,admit/reject 不变——作者信号只排队、不定生死,这一条现在有了线上证据。

**第三轮**只查一类问题:事实成立、结论多走了一步。五条全部成立并已收紧:① 直接证据支持的是"测试约定被采用",
不能读成"修复方案来自笔记";② `validated` 的操作定义写进报告(采用了约定的写入 **且** 最终副本通过独立验收,
两件事并列,不表示这次写入促成了通过);③ 结果标签不是人的能力——字段仍叫 `competence`(与 Core 摘要兼容),
但读作**资产结果概况**,Core 的闸门理由串已同步改成 `asset-outcome profile … on this asset`;④ 程序核的是引用
真实性、结构化结果一致性与资产关联,**自由文本的语义和适用范围核不了**,所以每条声明现在带程序造的
`fact_sentence`,模型原话另列为 `model_statement`,边界写在输出的 `scope_note` 里;⑤ "回流闭合"拆成两条流程:
初始笔记(整理入池)走完了使用 → 验证 → 准入,自动提取的 10 条候选只走到回流,使用与验证尚未展示。

**第四轮**两条,都是"口径写在文档里、代码不是那么算的":① 第二任务报告把一次 `needs_review` 写成"按三态口径记弃权、
不计入分母"——错,`unknown_adoption` 只适用于**参考答案不知道是否采纳**;那一次参考采纳成立、判定器没说用,
`classifyUsage({adopted:true,judgedUsed:false})` 返回 `false_negative` 且 `counts_toward_rate: true`,生成器与计数表
都已按此改;② 作者评估的 JSON 早已分开"程序核过的事实"与"模型表述",给人看的 Markdown 还在标题写 `Competence: medium`、
正文直接铺模型原话——渲染器已重写,标题改为「作者评估(资产结果概况)」,每条先 `记录事实(程序生成)` 再
`模型表述(语义未核验)`,五份评估用 `assess.mjs --recheck` 重新渲染(未重新调模型)。

**第五轮**(2026-09-12 晚)不查交付内容,查的是给上游提的那个候选:复核者先否掉了我们自己的问题定义
(说成"任务永不消费"是错的——`trigger-service.ts` 161/179/209 表明归档成功时任务已登记并入队,worker pool 也照样启动),
重新定位为**响应可观测性修复**,并要求复现证据必须包含任务登记记录与 worker 失败日志、"候选池没新增"不得单独作证。
处置与三项证据见 `evaluation/upstream/skill-extraction-flag/`。

**第六轮**(2026-09-12 夜)给了四条 proxy 缺陷,四条全部复现成立;第 ① 条已提为上游 PR **#1359**(只读模式下系统提示仍要求模型改 Skill——而只读是产品默认),②③④ 排在交付验收之后。两条上游 PR 的问题定义、证据、查重与剩余缺点见 `evaluation/upstream/`(含索引);**两条都只是「已提交,待审核」,且都没有自动检查结果**,归档里写的"通过"一律指本地验证。

**第七、八轮**(2026-09-13,只读核实 + 不落盘反例)查的是同一件事:**"这次跑通了"不等于"出错时一定会被挡住"**。
复核方构造反例,发现验收本身有两处**会放过失败**:① 闭环展示的三次调用全部失败,退出码却被循环末尾的 `echo` 盖成 0,
总验收照样通过;② 报告登记填一个不存在的执行步骤、或多登记一份而循环根本没跑它,登记核对都通过。
两处都已复现并修:退出码逐次保留、判决器支持对退出码为 0 的步骤要求 note 形态(`chain` 必须写出 `3/3 条 case 成功`);
新增 `reports-executed`,把**每份报告 → 本轮执行记录 → 自己的产物与 diff**对应起来(五份作者评估共用一个步骤,
只有逐份产物能分辨)。第八轮又指出套件规模检查**靠"带日期就算历史"去猜**,而当前声明恰恰也带日期 ——
已改成默认全查、历史必须显式标注,当前声明从 1 处变成 2 处。同轮还纠正了第三任务报告里一句没有依据的因果结论
(见上文第 5 条的 ②)。修的过程中自己又暴露两处:执行核对排在了它要读的那一步之前;`live-state` 逐条累计退出码后报 141,
查出是 `| head -6` 提前关管道造成的 SIGPIPE,不是真失败。逐条处置见 `evaluation/STATE.md`。

</details>
