# 交接状态(受控文件)

本文件是证据索引,不替代原始证据和实时核对(CLAUDE.md §15)。接手后先核对实时 HEAD
与本次操作依赖的运行状态,再动手。同一时刻只由一个指定执行会话修改本文件。

| 项 | 值 |
|---|---|
| 当前执行负责人 | 执行会话(Claude Code),worktree `.claude/worktrees/topic4-gate0` |
| **线上状态(接手先看)** | **2026-09-12 00:48Z(用户定"切")**:Core 跑的是**从本分支自建的镜像** `agentmemory/memory-core:topic4-11d30eaa720d`(id sha256:72d7076e…,构建提交 11d30ea 的 MemoryCore 树 == HEAD;package 2.0.0-beta.1),用产品的 `start-memory-core.sh` 起(`.env` 的 `MEMORY_CORE_IMAGE` 改指该 tag),**闸门内建于镜像、无挂载**(`eval-core.sh status`:gate built into the image,gate 路由 401 非 404);切换记录、备份与恢复命令 `gate/artifacts/core-image-switch-20260911T224508Z.json`;切换后读回:批次四两条 v4(right approved/admit、wrong failed/reject)与闭环笔记 v2(approved/admit)均与记录一致(`core-status-after-image-switch-20260912.json`、`core-status-note-after-image-switch-20260912.json`)。**与历史运行时的关系**:批次四与闭环跑在"同一 MemoryCore 代码的挂载 + 摘要未知的上游镜像"上,现在是"同一代码内建的自建镜像",`batch-conditions --check` 对旧清单报 `闸门来源 == 冻结值` FAIL 是故意的。Core 提取 **off**(2026-09-11T23:35:37Z 用 `core-extraction.sh off --record` 拨回,记录在 `tasks/exit-code-fix/extraction-switch.jsonl` 末条,审阅裁定 ③);proxy 强制身份 `agt-5e0y4l8a7a` / `task-5e6xp4mrrw`,上游直连、探针未路由;**无 tdai-clickhouse 容器**;备份 `~/Desktop/topic4-backup/core-data-20260911T224508Z-before-image-switch.tar.gz`(切换前停容器后取,sha256 在切换记录里)与更早的 `core-data.tar.gz` |
| 分支 | `topic4-attribution-gate`,远端 `mine`(推送由用户手动完成) |
| 上次验证的实现提交 | 本文件所在提交;本次改动见 `git log -1 -- evaluation/STATE.md` |
| 验证时间 | 2026-09-12 凌晨(交付复跑 `evaluation/delivery/2026-09-12b/SUMMARY.md`,线上栈;**干净克隆彩排** D:无密钥、无 Core、无 docker 的克隆 + 已烧毁值登记簿,判决类步骤全过、生成报告 diff 0——登记簿本身未入库,等用户定) |
| 测试 | evaluation 610(2026-09-12,从仓库根跑全 0 失败;含 exit-code-fix 反例 11 + 单测 14、证据包 +2、collect-artifacts 回归 1、运行时与闸门来源 +10、离线解析 +5、登记簿保留 +5);Core 122;proxy 24 |

## 第 1 件"新实验条件准备齐":已验收

```bash
node evaluation/runner/batch-conditions.mjs --check --conditions=evaluation/gate/artifacts/batch4-conditions.json
```

开批次前实际输出(`evaluation/gate/artifacts/batch4-conditions-check.txt`):61 PASS + 2 NOTE,
退出 0。同时确认:`resolve-tokens.mjs` 从 Core 取回两条明文,sha256 与 tokens.json 一致;
tokens.json 的 version 与内容哈希已同步到 v4(`--check` 里"Core 正文判别值哈希 == tokens.json"
两条 PASS)。

## 第 2 件"正式对照":已跑完并重判,报告在 `evaluation/runner/COMPARISON-2026-09-11-reparsed.md`

按"第 2 件的顺序"逐步:修通分析链 → `--check` 61/61 → gate-off 准备运行两次(`b4-prep`)→
`build-baseline` 冻结证据 → off/on 试跑一对 → 交错正式 off/on 各五次(顺序在
`evaluation/gate/artifacts/batch4-runs.json`)→ `collect-runs.sh` 收记录 → 报告。

2026-09-11 晚按审阅意见收口(顺序即优先级,1–4 已做):

1. **正式名单对齐**:主表只由 `batch4-runs.json` 十个 run id 生成(`calibrate-runs.mjs --manifest=`,
   `experimentOf`);准备、试跑各自另列;同一目录传两遍只算一次。旧解析下正式行:送达
   14/0/5/1、20/20、0.95;使用 13/0/6/0、未知 1、19/20、1.0、覆盖 0.95——与审阅独立重算一致。
2. **多目标解析按四条边界重写**(`verify.mjs` attempts-2026-09-11 + `provenance/shell-requests.mjs`;
   `judge-outcome.mjs` 按"带该资产值的那条请求"配对;`run-once.sh` 两遍验收,带服务端日志与
   探针)。十四次运行在仓库外副本上重判(`rejudge-runs.mjs`),差异 `REPARSE-DIFF-2026-09-11.md`:
   正式十次 4 变——第 1、3、7 次 PASS→ERROR(最后一条消息并发双拨,服务端日志证明 right
   在 0.1 s 内被应答、整条消息跑满 wrong 的超时,没有"最后一次"),第 5 次 FAIL→ERROR
   (一条命令连拨,本次探针没探 10.244.7.19:8096,结果不可分)。新口径:off PASS 1 / 不可判 4,
   on PASS 5/5;校准送达不变,使用 14/0/6/0、未知 0。
3. **三处口径**已改(见新报告):"3 次未观察到该类记忆读取,2 次确认受记忆影响";全批与
   未读子集分别报、不作无偏/保守估计;atomic 足迹是冻结前漏检不是批次后状态。
4. **第 9 次**单独一节:使用检测的真阴性;只关闭 REMAINING.md:94 的第 1 例。

## 第 5 件"最小开发闭环":已闭合(2026-09-11 16:54)

任务 `evaluation/tasks/exit-code-fix/`(README 有全貌)。审阅 2026-09-11 的五项:

1. 套件失败不得被误判 PASS:验证器固定 TAP 报告、退出码/失败计数/已解析失败项三者对账,
   解释不完整 → ERROR;基线豁免绑定(文件, 测试名)。反例 `verify.counterexamples.test.mjs`
   1a–1c 对 41d8620 的验证器失败(`counterexamples-before.txt`),现通过。
2. 冻结起点贯穿到最终验收:`verify.mjs --freeze` 在模型启动前记副本起始提交、树、测试清单
   (blob id)、测试内容 tar、套件自身结果;验收 diff 对照起始提交,受控套件跑原测试内容,
   模型改写/新增的测试另记(反例 2a–2d)。
3. 归因线索只取最终新增测试(新文件的名字/标题、加进已有文件的新标题)并关联实际写入调用
   (最后一次 Write/Edit/重定向,不是首个提到标记的搜索);关联不上标 needs_review;diff 其他
   位置的标记只列 `markers_elsewhere`(反例 3a–3c)。
4. 副本里已有正确答案:`git grep` 确认首选候选(curl 52/56)同样被 `gate0/verify-capture.mjs`
   给出通用解析,走次选改口径——"仓库内已有正确实现可参照,笔记的作用是缩短定位而非提供唯一
   答案";两类提示清单在 `conditions.json`。
5. 每次运行一个新消费者:`run-once.sh --fresh-consumer`(`fresh-consumer.mjs` 用消费者用户自己
   的 key 建 agent,创建时足迹核对为 0;`prepare.sh` 切 proxy 强制身份并重启),每次运行写
   `memory-channel.json`(读取次数、读回项、早于开跑、他 agent 的、无日期)。

验收命令与实际输出:`bash evaluation/tasks/exit-code-fix/selfcheck.sh`(`selfcheck-output.txt`,
【0】冻结 554/549/3 基线按文件列出、【1】FAIL 5/7、【2】PASS 7/7 对照冻结起点、【3】受控套件
OK 0 新增失败 3/3 基线仍在、【4】判别值来源唯一 2343 处)。
冒烟(不计样本)`20260911T135759Z-devloop-smoke`:新消费者 `agt-hnqxin11n9`,PASS,记忆通道
0 次读取,池未漂移,0 条送达/采用事件(模型未主动 `skill_search`;proxy 注入的
`<available_skills>` 对新 agent 为 "(none)",团队资产只经模型检索送达)。
无笔记组(任务文本改动前,作废留档):`20260911T140427Z`(PASS,根因修复)、`20260911T140806Z`
(FAIL,只改超时分支)。改动后重跑两次:`20260911T144347Z`、`20260911T144542Z` 均 PASS,模型各检索
团队池 3/2 次,candidate 的笔记不在结果里。
**有笔记组第一对作废**(`20260911T151132Z`、`20260911T151342Z`):笔记 `visibility: private`
(skill/create 默认),bridge 检索不含别人的私有 skill;第 1 次相关查询 4 次都只返回四项 team 资产,
第 2 次未检索;送达 0。配置缺陷,不是模型行为。已由作者身份置 team(`fill-note.mjs --fix-visibility`,
记录 `visibility-fix.json`,内容哈希不变、仍 v1 approved),池重新快照(旧快照留作
`asset-pool-snapshot.v1-note-private.json`),驱动加可见性守卫与 `--n 0` 短路(`seq 1 0` 倒数的缺陷
让状态检查启动了那两次运行)。之后:有笔记组两次(`20260911T154907Z`、`20260911T155035Z`,笔记 approved+team)均 PASS,检索返回笔记、
get-by-name 取回、送达 injected/recalled/fetched、新建带判别值的独立测试文件、尝试值关联到写入调用
(验证器 repo-2026-09-11d 修了"`node --test … 2>&1` 被当成写入"后在副本复判,validated 绑到 Write)。
用户已置回 candidate(16:00 前后)。
**回流**:第一轮四次写回在 `skill.extraction.enabled: false` 下只归档不提取(`tdai-core.ts` 932 不构造 worker;
记录 `write-back.attempt1.json`)。用户按序打开提取(16:25:58Z)→ 四次重写(16:26:56–16:28:03Z)→ 关闭
(16:52:28Z,配置 sha 回到原值);Core 提取出 10 项候选资产,owner user 与归档 agent 均等于该次消费者
(10/10);开关记录 `extraction-switch.jsonl`,池快照 `pool-before-extraction-on.json` / `pool-after-writeback.json` /
`pool-after-extraction-off.json`(作者 key 看不到消费者私有的候选,报告已说明)。
**闸门**:run-once 同步的结果行原本全部"不可信"(`core-gate.sh content_hash_of` 只从 bridge-addr 基线找作者
agent,笔记不在基线里,读不到内容哈希);已修(注册表/作者 key 回退),按复判副本重新同步后 2 行可信,
`evidence_revision` 2 → 6;apply 前两项确认写进报告(作者先验 "(reported, not used)",只定 review_priority;两次
验证 cross_user,消费者 user usr-4u07qc2kuj ≠ 作者 usr-n68ea5ythq,但同一消费者用户、同一任务);用户批准后
`gate-evaluate.mjs --apply`(16:54:11Z):decision admit,status candidate → **approved(规则判定,非人工准入)**,
与试算一致。记录 `gate-evaluations.jsonl`、`gate-observations.jsonl`。
**主分支**:无笔记第 1 次的修复(不含判别值)已应用(fb4edfa),参考测试 7/7、套件 580/580;批次四 14 次
运行按此代码复判(`/private/tmp/topic4-rejudge/2026-09-11b`),0 变化,差异文档
`evaluation/attribution/REPARSE-DIFF-2026-09-11-exitline.md`,既有报告数字不变。
运行清单 `evaluation/tasks/exit-code-fix/devloop-runs.json`(驱动 `run-arm.sh`);报告由
`report.mjs` 生成到 `REPORT.md`;回流 `write-back.mjs --run=<dir>`(产品 `/v3/skill/extract`,
以该次消费者身份;两组跑完再做,避免中途改池)。

**proxy 强制身份按运行切换(§10)**:每次运行前 `config.yaml.bak-<run_id>` 备份在同目录
(gitignored),`consumer.json.proxy_switch` 记 sha256 前后与恢复命令;运行结束不自动切回,
当前强制身份是最后一次运行的消费者。恢复到批次四消费者:
`cp deploy/global-images/.proxy-config/config.yaml.bak-20260911T135759Z-devloop-smoke deploy/global-images/.proxy-config/config.yaml && docker restart tdai-proxy`。

### 第 5 件续:第二任务 `exit-line-collect`(2026-09-11 深夜,已闭合)

同一条笔记(轮换为 v2:值只换标记,`tokens.json._history` 记 v1)、另一个文件的同类缺陷(`collect-artifacts.mjs` 的 `outcomeOf`)、
消费者用户 c(零记录)、自己的产品任务实体 `task-h1k7xruuhb`。验证器复用第一任务的(`DEVLOOP_TASK_DIR`),自检 0/1/0/1(seg4 因
值已进记录而 1,与第一任务同)。正式样本:无笔记 2 次(PASS 2,标记 0)、有笔记 4 次(PASS 4,笔记送达 4、标记进新增测试 4;
其中 1 次使用判定 needs_review 不计);第一任务在 v2 上用户 b 1 次 PASS validated。闸门对 v2:19:08:30Z 按规则 admit
(cross_user validated 4、distinct_consumers 2、distinct_tasks 2),作者上下文评估在理由里 "reported, not used"。
作者评估:A 对笔记 v2(medium / silent)、B 对自己回流的候选(medium / silent),管理员签名写入。作废留档 6 次:
任务目录缺 harness 读取的文件(tokens.json、pair.json…,已做成指向笔记之家的链接)与身份 c 的两处 harness 缺口(`LESSONS.md`)。
主分支已应用第二任务的修复(`REPARSE-DIFF-2026-09-11-exitline-collect.md`:批次四 95 条退出行全部可读,used 事件不受影响)。
报告 `evaluation/tasks/exit-line-collect/REPORT.md`;清单 `devloop-runs.json`;导读 `evaluation/REVIEW-GUIDE.md`。

## 批次里发现的三处缺陷(都已定位,处置各不同)

1. **记忆通道未隔离(设计缺口,需决策)。** profiles/ 快照不覆盖 atomic 记忆
   (`vectors.db`、`records/`、`skill_buffer/`)和 `conversations/`;流水线在会话进行中
   就写,模型经 `memory-bridge/v3/atomic/search`、`conversation/search|query` 读回。
   第 9 次 gate-off 经 `conversation/query` 拿到 prep 1 整个会话含最终报告。gate-on 五次
   都没读。已补检测:试跑检查点第 17 条"记忆通道"(`evaluation/runner/memory-channel.mjs`
   + 测试 12 条),`--check` 新项"消费者 atomic 记忆足迹为空"(现在 139 行 / 16 会话目录,
   FAIL)。**批次五之前要定隔离方案**,见需决策事项。
2. **快照先于清理(harness,已修)。** `run-once.sh` 把整树 tar 取在 `MEM_EXPECT_EMPTY`
   清理之前,还原时把残留装回,"运行后已回滚"检查点 10/10 FAIL;每次开跑起点仍是空基线
   (guard 生效,`pre_run_cleared_files` 4–5)。已抽成 `evaluation/runner/lib/agent-memory.sh`
   (先清理后快照),`agent-memory.test.mjs` 假 docker 跑真函数,先失败后 4/4。
   **改动未经真实运行**:批次五准备运行前先跑一次 harness 冒烟(不进批次)。
3. **一条命令拨两个目标 / 同一消息并发双拨(判定逻辑,已按审阅四条边界改,已重判)。**
   见上"第 2 件"第 2 点。待决的只剩并发组的判定规则(下)。

## 已决(2026-09-11 晚)与后续

- 闭环笔记 v2 **保留 approved**(2026-09-11T19:08:30Z 规则 admit;两个用户、两个任务实体、同一操作者)。v1 时的决定如下。
- 闭环笔记**保留 approved**:这次是闸门按规则 admit,decision 与 status 一致;上次人工 approved 时 gate 仍
  pending,状态与判定不一致,故置回。保留它,"回流闭合"才有实物支撑。admit 所依据的 2 次 cross_user validated
  来自同一消费者用户、同一任务(distinct_consumers=1、distinct_tasks=1):跨人成立、独立性不成立,报告同行写明。
- 下列三项**留作后续,不做**:记忆隔离方案(写进局限;要点:每次新 agent + 反证验证 + 查借入的 chat_memory)、
  并发最后一组维持 ERROR(已裁定)、bridge-name 不换解析(不在任何结论里)。
- **批次五不跑**:4 次不可判源于 gate-off 下两条冲突约定并存,换 trace 重跑会复现同一现象。

## 需决策事项(历史,已由上一节处理)

1. **atomic / conversation 记忆的逐运行隔离方案**(批次五前置)。可选:
   (a) 每次运行换全新 agent id(proxy `debugForceIdentity` 跟着改并重启,十次重启);
   (b) 批次期间关闭该消费者的记忆生成(要找 proxy/Core 的开关,未查);
   (c) Core 加按 agent 删 atomic/conversation 的管理接口(动产品代码,需团队管理员);
   (d) 整库快照还原(会连带别的 agent 的写入,不推荐)。执行会话倾向 (a) 或 (b)。
2. **并发发出、结果不一致的最后一组请求怎么判**:现按"不可读不是失败"记 ERROR;替代是
   按完成时间取最后(六次都是 wrong 最后完成 → FAIL)或"全部成功才 PASS"。任一种都不会
   把这六次判成 PASS。定了才能把批次三按新口径另报。
3. `bridge-name` 场景的验收仍用旧解析(整段含标记),是否同步改。
4. ~~开发闭环的送达~~ **已决(2026-09-11 晚)**:task.md 加一句"本仓库所属团队把过往经验以 skill
   形式保存在团队知识库中。动手之前先检索一次团队经验,有相关的就参考,没有就按自己的判断做。"
   (两组同文;只描述环境与流程);改动前的两次无笔记运行作废留档(`devloop-runs.json` 的
   `void`),重跑两次。参考测试覆盖范围与笔记正文的关系按决定 ② 写硬在 REPORT.md。
5. ~~笔记准入~~ 已按决定 ③ 做完(approved → 跑有笔记组 → 置回 candidate)。
6. ~~回流要不要临时打开提取~~ 已做(用户开、关;§10 记录)。
7. ~~闸门 apply~~ 已做(规则 admit → approved)。笔记保留 approved(已决,见上)。

## 下一步(审阅 2026-09-11 定的顺序)

5. **最小开发闭环**:历史资产 → 真实 BugFix/Feature → 测试 → 回执 → 候选处理;复用已有
   导入/抽取/检索,不建新组件。
6. **交付前**:demo 接真实工件、一次真实冒烟、交付复跑、整理 PR。
7. 有余量再做隔离反证验证或批次五;不得据此声称额外工作已完成。

## 批次五之前必须做的事(按序,仅当做到第 7 步)

1. 定决策 1(和 2、3)。
2. `fill-traces.mjs` 换新 trace(v4 已烧:明文在收集的记录、消费者残留,以及旧报告与
   已删测试文件的 git 历史里),资产升 v5;用户跑 `core-gate.sh --reset` 恢复 approved。
3. 新消费者或清空消费者(含 atomic/conversation,按决策 1);`--freeze` 记新的 `run-once.sh`
   哈希与 atomic 足迹;`--check` 全过(64 项)。
4. harness 冒烟一次(不进批次):`hash_restored == hash_before`、记忆通道 PASS、两遍验收产出
   `verdict.pass1.json` 与 `verdict.json`。
5. 准备运行 → build-baseline → 试跑一对逐条 17 条 → 正式交错。

## 第二人复核第二轮(2026-09-12,作者评估与两份闭环报告)已处置

复核对象:`evaluation/author/`(证据包、核对器、评估)与两个闭环 REPORT。六条意见全部成立,已改在实现与生成器里:

| 条 | 处置 |
|---|---|
| P1 作者评估在资产没有判别值时接受无关证据为"强矛盾" | 没有判别值时,**别的资产**上的结果一律记 `silent`(relevance unverifiable);同资产同版本同内容仍按身份关联(`check-citations.mjs`,先失败后通过的测试 2 个) |
| P1 "A 的来源链完整"只是三个集合各自非空 | `chainFacts()` 取代旧 chain:去掉 `complete`,写入者作为事实保留,生产来源记 `production_link: unproven` 并写明相邻关系未验证;空集合列为 `gaps`(测试 2 个);README 的"complete"说法改写 |
| P2 medium 是全部业务结果,不是所问领域 | 等级只由**被评估资产上**的业务结果得出,跨资产结果单列为历史(`domain_counts` / `cross_asset_history` / `scoped_to`);领域无结果 → `unknown`(测试 3 个) |
| P2 第二任务"采用待复核 0"掩盖了一次归因待复核 | 计数改为两个口径分列:参考采纳(验收器)4/4、判定器 used+validated 3/4、仅 needs_review 1/4;并按冻结的三态口径记一次弃权,同时写明二值口径下它是 FN |
| P2 第一任务把 v1 的解释套到 v2 的汇总上 | 按每次 apply 分别打印信号(v1:2/1/1;v2:4/2/2),并说明 v2 含第二任务的运行 |
| P2 "缩短定位"是未经证明的收益表述 | 两份 REPORT、两份 README、PR 统一改为"设计目的是帮助定位;没有单独测量定位时间,不能说已证明缩短" |

**重算结果**(`author/artifacts/assessment-recheck-2026-09-12.json`,用 `assess.mjs --recheck`,**没有重新调用模型**):
A 对笔记 v2 medium → medium(本资产上 2 条 validated);**B 对自己候选的评估 medium → unknown**;A 的 bridge 资产 medium → low;A 的冷启动候选 medium → unknown。
**已写回(2026-09-12T10:44:33Z,用户执行,管理员签名)**:B 的评估以 competence=unknown 写入 Core,闸门读回
`decision pending / review_priority **high** / assessment accepted`——作者信号只改复核优先级,不改 admit/reject,这正是设计。
写入记录 `author/artifacts/assessment-write-b-exit-line-2026-09-12.json`;读回核对 `author/artifacts/assessment-write-b-readback-2026-09-12.json`:
该脚本的 apply:true 只重判了这一条候选,**闭环笔记 v2 仍 approved/admit、批次四 right approved/admit 与 wrong failed/reject 均未变**(已逐条读回)。

## 第二人复核(2026-09-12)已完成并已处置

复核对象:`attribution/CALIBRATION-batch4-reparsed-2026-09-11.md` 与主报告。五条意见全部成立,**全部改在生成器**
(`calibration.mjs`、`calibrate-runs.mjs`)后重新生成报告,未手改:① 隔离失败不再被说成"判 used 是对的",送达表的 FN
明确为"已送达但未判使用";② 正文主结论只报正式样本组(20 项 / 10 次运行),累计(28 项)单列并标明含准备与试跑,
收益按组给出(正式 9/2/3,累计 13/5/3),并写明判定项 ≠ 独立实验;③ 独立性改为四项事实分别报告(起点一致、回滚未成功 10 次、
运行期间写入 10 次、未查出读到别人内容),结论"独立性未确认",并写明没有判别值泄漏 ≠ 没有记忆污染;④ 报告记真实复算命令
(去掉只决定输出位置的 `--md`)与全部运行 id;⑤ 威胁模型收紧为"已验证的产品读取路径受控 / 已覆盖通道可识别部分替代来源 /
其余未知"。两版数字差异已逐项说清:`20260910T232627Z-gate-off` 的 wrong 资产由"采纳未知"变 TP,因为重判后的
`verdict.json` 按目标拆出两条带值的 attempt,旧记录里有一条 attempt 的 value 为空、按判据整项不进分母。
先失败后通过的测试 9 个(`calibrate-runs.test.mjs`、`calibration.test.mjs`)。

## 干净克隆能不能复算(审阅 2026-09-12 的核心问题)

审阅指出分支里没有批次四与闭环的任何运行目录,"每个数字可从原始记录重算"在干净克隆上不成立。处置与结果:

| 步 | 做了什么 | 结果 |
|---|---|---|
| 入库 | 14 + 23 个运行目录强制入库(只排 `capture-before.jsonl`;真实密钥值扫描无命中) | eddefd0,pack 47 MiB |
| 彩排 A | 干净克隆 + 线上栈、无密钥 | 5 处缺口:gate0 夹具、REPORT 路径、probe.pid、密钥缺失即崩、重判需 Core |
| 离线路线 | `resolve-tokens.mjs` 对**已烧毁**值走登记簿(sha256 核验;有密钥时不参与);`build-burned-registry.mjs` 用 git grep 证明值已在提交树里才登记 | 4b0bb03、30e4f78 |
| 彩排 D → E | 干净克隆、无密钥、无 Core、无 docker;D 用会话里的登记簿,**E 用 git 带来的登记簿**(HEAD 6425619) | 套件 610/610;重判副本重生成 14;校准 / 汇总 / reparse / 两份 REPORT diff 0;判决类步骤全过 |
| 彩排 C | 同上但无登记簿 | 重判停在取不到值,校准 / 汇总 / 重判差异跑不了 |

**已定(2026-09-12,用户"入库")**:登记簿 `evaluation/attribution/burned-tokens.json` 入库(4 条:bridge-addr v4 ×2、闭环笔记 v1 / v2)。
规则例外写进 `CLAUDE.md` §16。两点如实记明:① 登记簿新增的是「值 → 资产版本」的映射——`tokens.json` 只有 sha256,评委自己 grep 只能得到
一堆字符串,不知道哪个属于哪条资产的哪个版本,这个映射别处没有;对已烧毁的值无害,但不是"什么都没多"。② 保留规则:只留已交付批次的条目,
新批次前用 `--archive=<仓库外文件>` 归档旧条目,builder 在有过期条目时拒绝写入(测试覆盖),不做永久累积。各步依赖见 `REVIEW-GUIDE.md` 的三组表(纯离线 / 需登记簿 / 需线上栈)。

## 证据位置

| 什么 | 在哪 |
|---|---|
| 批次四对照报告(新口径) | `evaluation/runner/COMPARISON-2026-09-11-reparsed.md`;表格 `summary-2026-09-11-reparsed{,-noread}.md`;校准 `attribution/CALIBRATION-batch4-reparsed-2026-09-11.md`;差异 `attribution/REPARSE-DIFF-2026-09-11.md` |
| 旧口径(保留,**正文是 2026-09-12 复核前的措辞,只作历史记录**) | `evaluation/runner/COMPARISON-2026-09-11.md`(顶部有取代说明)、`summary-2026-09-11.md`、`attribution/CALIBRATION.md`(名单已对齐;它自己头部那条模板命令复现不出它的 51 次运行——这正是复核挑出的问题,交付版已改)、`CALIBRATION-2026-09-11-as-committed-ef22463.md` |
| 重判副本(仓库外,可重生成) | `/private/tmp/topic4-rejudge/2026-09-11/<run_id>/`,命令在新报告开头;2026-09-12 起 `deliver-check.sh` 发现副本缺失会先用同一命令重生成(干净克隆也能复算) |
| 条件清单(冻结 2026-09-10T23:21:51Z) | `evaluation/gate/artifacts/batch4-conditions.json` |
| 闸门基线(冻结 23:20:45Z,source_runs = 两次 b4-prep) | `evaluation/gate/artifacts/gate_baseline_batch4.json` |
| 批次清单(顺序、退出码) | `evaluation/gate/artifacts/batch4-runs.json`;驱动日志 `batch4-runs.log`(本地,按 .gitignore 不入库)|
| 核对输出 | `batch4-conditions-check.txt`(开批次前 61+2)、`batch4-conditions-check-post.txt`(批次后 53/9/2);2026-09-12 起 `--check` 多出运行时行,对旧清单按设计 FAIL:`core 容器镜像摘要 == 冻结值`(冻结的 55fec… 本身是重建后的回填,历史摘要未知)、`闸门来源 == 冻结值`(冻结 mount,现 image);`core 闸门在线上`、`镜像构建提交的 MemoryCore 树 == HEAD` PASS |
| 检查点输出 | `batch4-trial-gate-{off,on}.txt`(开批次前 16 条)、`batch4-formal-checkpoints.txt`、`batch4-prep-trial-checkpoints.txt`(17 条) |
| 运行记录(**2026-09-12 入库**,审阅裁定) | `evaluation/runner/runs/20260910T23*` 14 个目录 + `20260911T1*-devloop-*` 23 个目录,强制加入(ignore 规则仍在);每目录只排除 `capture-before.jsonl`(运行前探针残留,无脚本读取,263 MB),其 sha256 在 `gate/artifacts/run-records-committed-2026-09-12.json`;入库前按 .env 与三把用户密钥的真实值扫描,无命中;旧批次未改动 |
| 校准报告(生成) | `evaluation/attribution/CALIBRATION.md`;派生隔离审计 `artifacts/isolation-findings.json` |
| 场景记录 / token | `evaluation/tasks/bridge-addr/pair.json`(v4,`batch4` 块)、`tokens.json`(哈希形态) |
| 多目标解析测试 | `evaluation/tasks/bridge-addr/verify.multi-target.test.mjs`、`evaluation/provenance/shell-requests.test.mjs`(待决提案文件已删,已进套件) |

## 线上状态的受控记录(CLAUDE.md §10)

**proxy 配置** `deploy/global-images/.proxy-config/config.yaml`(不受版本控制,含密钥)

| 项 | 值 |
|---|---|
| 变更 | `sessionInit.debugForceIdentity.agent_id` → `agt-giawngxum4`(2026-09-10T23:07:37Z 生效) |
| 备份 | `config.yaml.orig-20260909-before-consumer-switch`(原始,sha256 `4453c5fd…`)、`config.yaml.bak-20260911-before-b3-switch`(切换前);同目录,受 .gitignore 保护 |
| 当前 sha256 | `76428b8b…`(条件清单 `proxy.config_sha256`) |
| 恢复命令 | `cp deploy/global-images/.proxy-config/config.yaml.orig-20260909-before-consumer-switch deploy/global-images/.proxy-config/config.yaml && docker restart tdai-proxy` |
| 验证命令 | `docker logs tdai-proxy 2>&1 \| grep -F '→ initialized' \| tail -1` |

**Core 镜像**(2026-09-12 00:48Z 切换,用户决定;记录 `evaluation/gate/artifacts/core-image-switch-20260911T224508Z.json`)

| 项 | 值 |
|---|---|
| 变更 | `deploy/global-images/.env` `MEMORY_CORE_IMAGE`:`agentmemory/memory-core:latest`(上游,sha256:55fec3a6…)→ `agentmemory/memory-core:topic4-11d30eaa720d`(自建,sha256:72d7076e…);随后 `bash deploy/global-images/start-memory-core.sh`(删旧容器、保留数据卷、本地 tag 不拉远端) |
| 备份 | `.env.bak-20260911T224508Z-before-image-switch`(0600,受 .gitignore 保护);数据卷 `~/Desktop/topic4-backup/core-data-20260911T224508Z-before-image-switch.tar.gz`(停容器后 `docker cp` 取,2156 项,sha256 在记录里) |
| 恢复命令 | `sed -i '' 's#^MEMORY_CORE_IMAGE=.*#MEMORY_CORE_IMAGE=agentmemory/memory-core:latest#' deploy/global-images/.env && bash deploy/global-images/start-memory-core.sh`(镜像回上游;数据卷不动。若卷需回滚,记录里有从 tar 恢复的命令) |
| 验证命令 | `bash evaluation/eval-core.sh status`(应打印 gate built into the image、build 提交树 == HEAD);`bash evaluation/gate/core-gate.sh --status --baseline evaluation/gate/artifacts/gate_baseline_batch4.json`(两条 v4 读回 approved/admit、failed/reject) |

**Core 资产状态**:两条资产 v4;批次结束时 right `approved`、wrong `failed`(最后一次是
gate-on)。恢复 approved 由用户跑 `core-gate.sh --reset --baseline …gate_baseline_batch4.json`。
笔记 `skl-pXLc38dex6Zt` v1:team、**approved(闸门规则 2026-09-11T16:54:11Z)**;10 项由消费者会话提取的候选
(private,属 usr-4u07qc2kuj)。**Core 提取开关**:off(16:52:28Z 恢复,sha 66ebab0a…;备份与恢复命令在
`evaluation/tasks/exit-code-fix/extraction-switch.jsonl`)。**proxy 强制身份**:交付前已恢复为主线消费者
`agt-5e0y4l8a7a`(`prepare.sh --identity b`;备份与恢复命令在 `evaluation/tasks/exit-code-fix/proxy-identity-restore.json`)。

**消费者记忆**:profiles/ 下 `agt-giawngxum4` 现有 5 个残留文件(最后一次会话的迟到写入,
下一次运行前由 guard 清);atomic/conversation 足迹 139 行 / 16 会话目录,**没有清理办法**
(见需决策 1)。旧消费者 `agt-eiwlwrb0me` 不删。

**运行记录暂存**:`/private/tmp/topic4-runs/` 只剩 `probe-capture.jsonl`;会话目录
`/private/tmp/topic4-sessions/` 保留(含 23:05 那次被删掉的准备尝试 `20260910T230524Z-b4-prep.dqa0`,
它的会话写了记忆,是 prep 1 读到的冻结前残留的来源)。

## 历史节(保留,已完成)

- 冒烟运行 `20260910T154648Z-harness-smoke-v3`:证明有 shell 的模型能从进程表找到仓库并读
  记录文件 → 记录/探针/会话全部出仓库,`record` 类来源算污染。
- token 明文放哪:方案 2(仓库只存 sha256,明文只在 Core 正文)已实现并经 `--check` 验证。
- 方案 3 spike(容器内跑 CLI):可行但未搭起来,非阻塞。
