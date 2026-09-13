# 交接状态(受控文件)

本文件是证据索引,不替代原始证据和实时核对(CLAUDE.md §15)。接手后先核对实时 HEAD
与本次操作依赖的运行状态,再动手。同一时刻只由一个指定执行会话修改本文件。

| 项 | 值 |
|---|---|
| 当前执行负责人 | 执行会话(Claude Code),worktree `.claude/worktrees/topic4-gate0` |
| **线上状态(接手先看)** | **2026-09-12 00:48Z(用户定"切")**:Core 跑的是**从本分支自建的镜像** `agentmemory/memory-core:topic4-66bc9aecd719`(**2026-09-12T11:33Z 第二次切换**:第三轮复核改了闸门理由串,必须重建;构建提交 66bc9ae 的 MemoryCore 树 == HEAD;记录 `gate/artifacts/core-image-switch-20260912T113253Z.json`;上一版 topic4-11d30eaa720d 的切换记录仍在),用产品的 `start-memory-core.sh` 起(`.env` 的 `MEMORY_CORE_IMAGE` 改指该 tag),**闸门内建于镜像、无挂载**(`eval-core.sh status`:gate built into the image,gate 路由 401 非 404);切换记录、备份与恢复命令 `gate/artifacts/core-image-switch-20260911T224508Z.json`;切换后读回:批次四两条 v4(right approved/admit、wrong failed/reject)与闭环笔记 v2(approved/admit)均与记录一致(`core-status-after-image-switch-20260912.json`、`core-status-note-after-image-switch-20260912.json`)。**与历史运行时的关系**:批次四与闭环跑在"同一 MemoryCore 代码的挂载 + 摘要未知的上游镜像"上,现在是"同一代码内建的自建镜像",`batch-conditions --check` 对旧清单报 `闸门来源 == 冻结值` FAIL 是故意的。Core 提取 **off**(**2026-09-12T17:56:07Z 第二次拨回**,记录在 `tasks/exit-code-fix/extraction-switch.jsonl` 末条,审阅裁定 ③)。**注意这里曾经漂移过 6 小时**:11:33Z 的第二次镜像切换用 `start-memory-core.sh` 起容器,而该脚本会重新生成整个挂载配置(`start-memory-core.sh:55` 的 `cat > "$CORE_CONFIG_FILE"`),把提取写回 on —— 正是提交 c88e955 记下的那个坑,切镜像后没有复查。17:55Z 发现(文件 sha `cdb5b484…`、容器读到 `enabled:true`、Core 11:33Z 日志 `extraction=true`),17:56Z 拨回并校验(sha `66ebab0a…`、文件与容器一致、Core healthy);漂移范围经比对只涉及这一个开关(见 `gate/artifacts/extraction-drift-20260912.json`)。**没有交付运行受影响**:9/12 全天零次运行,且 `runner/prepare.sh:81` 在提取不是 off 时硬失败、162 行会就地拨回,错的只是线上状态与 STATE 对它的描述。拨回后读回:批次四两条 v4 与闭环笔记 v2 均未变(`gate/artifacts/core-status-after-extraction-off-20260912.json`、`core-status-note-after-extraction-off-20260912.json`);proxy 强制身份 `agt-5e0y4l8a7a` / `task-5e6xp4mrrw`,上游直连、探针未路由;**无 tdai-clickhouse 容器**;备份 `~/Desktop/topic4-backup/core-data-20260911T224508Z-before-image-switch.tar.gz`(切换前停容器后取,sha256 在切换记录里)与更早的 `core-data.tar.gz` |
| 分支 / 交付载体 | `topic4-attribution-gate`,远端 `mine`;**交付载体是分支本身**:https://github.com/VittorioCai/TencentDB-Agent-Memory/tree/topic4-attribution-gate(导师要求为「分支代码 + 文档」,不要求 PR)。fork 内的 PR #1 曾作为浏览入口,**2026-09-12 用户决定关闭**—— 其 diff 基线是上游 `feat/server_team`,会把 fork 相对上游的 2596 个文件差异一并计入,不如直接读分支;关闭不影响分支与提交历史,`evaluation/PR-DESCRIPTION.md` 继续作为交付说明书。另:上游 PR **#1358** 是独立分支的贡献,仍然开着。推送由用户手动完成 |
| 上次验证的实现提交 | 本文件所在提交;本次改动见 `git log -1 -- evaluation/STATE.md` |
| 验证时间 | **2026-09-13T16:09Z(交付复跑 `evaluation/delivery/2026-09-13T160920Z/SUMMARY.md`,受测提交 `f8c1a7f`,**与已推送的 HEAD 一致**)**:套件 760/760;离线复算通过、线上检查通过、缺依赖无;十三份登记为重算的报告逐份对上本轮产物,其中十一份带 diff 的全为 0。**干净克隆彩排 I(同日 15:12Z,从 fork 克隆同一提交 `7429693`,无密钥、无 Core、无 docker)**:同样 745/745,离线全部通过(含新加的 `reports-executed` 与 `chain 3/3`);`conditions-check` 41 项 FAIL 属 C 组按设计不通过 |
| 测试 | evaluation **633**(2026-09-12,从仓库根跑全 0 失败;各轮第二人复核新增/改写的测试在内:运行时与闸门来源 +10、离线解析 +5、登记簿保留 +5、校准口径 +9、作者评估边界 +7、第四轮渲染器 +2);Core 122;proxy 24。另有上游候选二的 6 个测试,在另一个 worktree 的 vitest 下跑(`upstream-extract-flag`,不在这 630 里) |

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
**主分支**:无笔记第 1 次的修复(不含判别值)已应用(fb4edfa),参考测试 7/7、套件 580/580(当时的数);批次四 14 次
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

### 第 5 件续二:第三任务 `resource-download`(2026-09-13,**样本待重跑**)

**换一类工作**:前两个是修已有缺陷,这个是**新增一个功能**;**采用判定靠行为不靠标记** ——
参考测试断言零字节、错误信封透传,以及**请求打到哪个子路径**(`files/download` —— **未在注入的工具清单里直接给出**;源码与 PR 归档仍可能提供它)。
笔记 `skl-XAzqAgejM7O4`(`eval-skill-resource-download`,v1,team,**当前 candidate**),自带 `tokens.json`;
产品任务实体沿用 `task-h1k7xruuhb`。跑前已验证验收能区分:无笔记式实现 2/5,笔记式实现 5/5。

**无笔记组第一批 16 次全部作废(批次 `no-note-2026-09-13a`)。** 原因是实施者把验证用的
「看了笔记的写法」参考实现留在 `/private/tmp/scen-check/`(10:30:45Z),首次运行 10:52:39Z;
2 次实际读到(一次 `cat` 草稿,一次 `grep` 到前一次留下的工作副本),其余 14 次虽未读到,
但「这条知识只能来自笔记」的前提对整批不成立。**闸门没有失职**:两次的 `memory-channel.json` 都是 `reads: 0`。
详见 `LESSONS.md` 末条与 `tasks/resource-download/devloop-runs.json` 的 `voided_batches`。

已改(都带先失败的测试):`runner/contamination.mjs`(+8 测试)按内容查污染 ——
别的运行 id、参考测试用例标题、无笔记组里的判别值;`run-once.sh` 每次跑完写 `contamination.json`
并**删除工作副本**(`KEEP_SESSION=1` 可留);`run-arm.sh` 开跑前扫散落的答案,不过不跑,manifest 逐条记 `contaminated`;
`tasks/exit-code-fix/verify.mjs` 的标记必须对得上 `tokens.json` 登记的 sha256(含退休旧值),否则 `registered:false` 送复核(+4 测试)。
**没解决的一半**:同一用户的 shell 面前磁盘上没有真正读不到的位置,历次运行记录必然含答案 —— 靠逐次检测发现并作废,不靠隔离。

前两个任务的 23 次归档运行已全部重扫:**无一命中**,已有闭环结论不受影响。
**重跑后的正式样本(2026-09-13,污染守卫下)**:无笔记 **0/4**(四次全部只挂在「请求打到 files/download」这一条,
其余四条行为断言全过),有笔记 **4/4**;笔记提及 193–321 次对 0 次;8 次污染检查全部干净。报告
`tasks/resource-download/REPORT.md` 由 `report.mjs`(+9 测试)生成,结论句「有笔记组高出 100 个百分点(4/4 对 0/4)」。
准入用 `admit-note.sh --approve`(管理员密钥,用户执行,§10 记录在 `artifacts/note-admission-*.json`)。

三件必须连着讲的事:**① 使用判定全是 `needs_review`** —— 消费者自己 curl 了 skill bridge 取回笔记,早于被记账的那次 fetch,
归因不把说不清的算成用了(判别值确实在它写的 diff 里)。**② 工作副本里有我们自己的上游 PR 归档**
(`evaluation/upstream/download-telemetry/`、`evaluation/PR-DESCRIPTION.md`),用大白话写着 files/download 返回原始字节;
8 次里 6 次真读到了,但**两组读到的次数不同**(有笔记 4/4、无笔记 2/4)。**存在这样一个共同的替代信息源,尚不能确定它对组间差异的影响** —— 它可能与笔记共同作用于同一行为,凭这 8 次判断不出方向(第八轮复核指出,原写「只让基线更强、差值更保守」是没有依据的因果结论,已改)。报告按 capture 逐次计数
(`task.json` 的 `copy_exposure`)。**③ 污染规则改过两版**(b:按访问判不按文本判,首版误报 4 次;c:自查补三处),
每条运行保留历次判定(`contamination_history`),两次真污染在三版下都被抓住。

**收尾(2026-09-13 下午,用户逐项定)**:① 用户已 `admit-note.sh --revoke`,笔记回到 candidate(记录 `artifacts/note-admission-20260913T131034Z.json`)。
② 运行已归档(0f08a78):8 次样本 + 2 次事故运行全量,14 次作废运行只留 verdict 与污染判定(各目录 `ARCHIVE-MINIMAL.md`);
v1 判别值随之进入提交树即烧毁,已由 `build-burned-registry.mjs` 用 `git grep` 证明(≥44 个已提交文件)并登记;笔记已轮换到 **v2**
(仍 candidate/team,记录 `artifacts/note-rotated-2026-09-13.json`),v1 规格由 `fill-note.mjs` 自动退进 `tokens.json._history`。
③ PR 归档**不清**,报告如实写(用户定);若再加样本须改 `archive_excludes` 后两组一起另跑另报。④ 不写显著性。
⑤ 第三任务已接进 `deliver-check.sh`:`devloop-report-3`(diff 0)与 `contamination-3`(样本批检,污染与未知同样阻断)。
⑥ `needs_review` 如实写,归因器不改(用户定)。⑦ 归档范围同②。
**验收复跑(HEAD 1f5cf3e,`delivery/2026-09-13T133832Z`)离线全过、线上一项未登记:`proxy 强制身份 task`** —— 8 次运行把 proxy 强制身份
留在最后一个消费者(`agt-k9ic54p94e` / `task-h1k7xruuhb`),按前两个任务的收尾要恢复到主线消费者 b + `task-5e6xp4mrrw`
(`FRESH_CONSUMER_TASK=task-5e6xp4mrrw bash evaluation/runner/prepare.sh --identity b; bash evaluation/tasks/bridge-addr/use-identity.sh b`,
备份 + `proxy-identity-restore-3.json`)。**用户已于 13:45:32Z 恢复**(配置 sha `4453c5fd…`,与 9/11 两次恢复后一致),记录已入库。
**验收复跑(HEAD 16189f9,`delivery/2026-09-13T134641Z`):离线通过、线上通过、缺依赖无**;套件 702/702(当时的数)、
`devloop-report-3` diff 0、`contamination-3` 8 次样本全干净、`conditions-check` 21 项 FAIL 全部登记(15 / 5 / 1),未登记 0。
**两条分支已推(2026-09-13):** `topic4-attribution-gate`(`26808ce`)与 `gate-core-minimal`(`c372d80`),推后读回远端 SHA 与本地一致。
闸门抽取那份的措辞按复核方收紧:去掉「没有一处语义冲突」、比较基线钉在 `0468a2a...c372d80`、原始输出入库
(`gate/artifacts/port-*`);留档时纠出一处 —— 「新增 0 条」只对 `src/metadata` 成立(11 → 6),全树是 123 → 118、新增 2
(同两个未定义名字换了错误码),比较由 `compare-typecheck.mjs` 可复算。

**封版核对(2026-09-13 16:0xZ,交付候选 `f8c1a7f`)**:**从远端重新克隆**该提交(不是本机工作树)、无密钥、无 Core、无 docker、
重判目录全新,跑完整验收 —— **离线复算全部通过,带 diff 的 11 份全为 0**;`conditions-check` 41 项 FAIL 与两个 selfcheck
属干净克隆上的线上依赖,按设计不通过。那次的逐步记录入库在 `evaluation/delivery/SEAL-f8c1a7f/`(含 `HOW.md` 写明克隆命令与环境),
给评委看的一页 `evaluation/SEAL-CHECK.md` 由 `seal-record.mjs` 从它重算(+8 测试,已接进验收 `seal-record` 步,diff 0)。
还剩两件实施者做不到、要人工确认的:**评委能否打开两个链接**、**提交渠道是否已收到材料**,列在该页的勾选框里。
同轮按复核方意见把「抄不来」改成「未在注入的工具清单里直接给出」—— 源码与 PR 归档仍可能提供那条路径,原话说满了;
四个源头(task.json、参考测试注释、PR-DESCRIPTION、STATE)逐处改,生成的报告重算。

**第八轮复核(2026-09-13 傍晚,只读 + 内存反例)三条:**
**① 前两处阻断漏洞已在 `7429693` 修完并推送**,复核方读的是更早的树。当场用真程序复验:三次 `chain-cli` 用不存在的 case
真失败 → 外层 `ce=1`、`0/3 条 case 成功`;登记里填不存在的步骤 → `reports-executed` rc=1 并指名道姓。
需要说明的是 `checkRegistry` 本身确实不核步骤(复核方引的就是那一行)—— 那是**故意分成两步**:
`generated-reports` 只管登记完整,`reports-executed` 管执行完整,后者才是阻断点。
**② 套件规模检查漏掉 STATE 的当前值 —— 这条成立,已复现**(把「验证时间」行改成 999/999 照样通过)。
根因是我**用「带日期或提交号就算历史」去猜**,而当前声明恰恰也带日期和提交号。已改成**默认全查、历史必须显式标注**
(`当时的数` / `历史记录` / `<!-- suite-size:historical -->`);STATE 里五处历史记录逐行补了标注,当前声明从 1 处变成 **2 处**,
反例复验阻断。方向是有意选的:漏判的代价是放过一个陈旧数字,所以默认必须是「查」。
**③ 第三任务那句因果结论已收**:原写「两组副本相同,所以它只会让基线更强、让差值更保守」——
报告自己的表就写着**有笔记 4/4、无笔记 2/4**,两组读到的次数并不同,这句没有依据。改在生成器(`task.json` 的 `copy_exposure`)
并重新生成:**存在共同的替代信息源,尚不能确定它对组间差异的影响**;要判断只能另做一批排除它之后的对照。
同一句话在 `STATE.md` 与 `README.md` 里也各有一处,一并改。第二批的目的也按复核方的说法写进 `task.json`:
**问的是「排除已知替代来源后结果还复现吗」,不是把 4 次加到 6 次。**

**第七轮复核(2026-09-13 下午,只读核实 + 不落盘反例)四条已全部处置:**
**① 闭环展示的失败被最后一个 `echo` 掩盖**(已复现:三次调用全返回 7,外层仍是 0)。改为逐次保留退出码并记 `3/3 条 case 成功`;
判决器扩成**退出码为 0 的步骤也能要求 note 形态**,否则少跑一条 case 看不出来。同一种写法在 `live-state` 也有一处,一并改。
**② 登记完整 ≠ 执行完整**(两个反例均复现:改成不存在的步骤名、多登记一份而循环没跑,原来都放过)。新增 `checkExecution`:
每份登记为重算的报告要有**本轮**的执行记录(步骤在 rows.jsonl 且退出码 0)、**自己的 artifact**、且 `.diff` 为空 ——
五份作者评估共用一个步骤,只有逐份产物能分辨。新步骤 `reports-executed`,排在所有报告步骤之后。三个反例复验全部阻断。
**③ `exitline.md` 的替代说明改掉**:它比的是**验收器 verify.mjs 修复前后**,`exitline-collect.md` 比的是
**collect-artifacts 退出码采集修复前后**,不是同一项验证,后者不能替前者背书。限制保留,不扩实验。
**④ `pack.file` 统一为仓库根相对路径**(3 份入库评估已改,生成器同改)。性质说准:当前程序读的是必填参数 `--pack`,
**没有读存档里的 `pack.file`**,所以是引用可移植性,不是已证实的运行阻断;不加"找不到就猜另一个文件"的兜底。
写入记录(`assessment-write-*`)与演示快照里的绝对路径**不动** —— 那是当时用了哪把钥匙、Core 当时返回了什么,属原始记录。

修的过程中自己又暴露两处:`reports-executed` 原本排在 `comparison-figures` 之前,读不到它的行(顺序错,已挪后);
`live-state` 逐条累计退出码后报 141,查出是 `| head -6` 提前关管道造成的 SIGPIPE,不是 `prepare.sh` 真失败 —— 改成先整份落盘再截断。

**验收漏检收口(HEAD e488459,`delivery/2026-09-13T142640Z` 全绿,套件 729/729(当时的数)):** 验收此前不知道仓库里一共有哪些生成报告。
`check-generated-reports.mjs` 穷举 `evaluation/` 下 73 份入库 .md,逐份归类(叙述 44;regenerated 12、figures_checked 1、
historical 15、not_regenerable 1),**未登记即阻断**。由此补上两处真漏检:五份作者评估此前无人复核,现由 `author-recheck`
从 `raw_model_output` 重验并 diff(5 份全部 0 行);`REPARSE-DIFF-2026-09-11-exitline.md` 确实无法在验收里重算,
**登记为缺点**并写明代价与替代。另 `check-comparison-figures.mjs` 把对照报告主表与生成 summary 逐格钉住,首跑即抓到
「均墙钟 s」被抄成 47 / 15(应为 47.2 / 15.4),已按生成值改回。

**再复跑(HEAD 8f8eceb,`delivery/2026-09-13T135245Z`)同样全绿(套件 703/703,当时的数)**:README 补齐闸门抽取的尺度与类型检查数字、③ 措辞按用户决定改定、④ 报告加一句算出来的样本量限制(不写 p 值)。套件 703/703。

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

## 闸门在最新上游上重拆一遍(2026-09-13,不是为了提 PR)

回答"闸门放到今天的上游代码里还装不装得进去"。分支 `gate-core-minimal`、提交 `c372d80`,
基线 `origin/feat/server_team@0468a2a`,worktree `.claude/worktrees/gate-core-minimal`,
树里无 `evaluation/`。21 文件 `+4043/−34`;13 个双改文件用 `git merge-file` 逐文件三方合并
(`git apply -3` 对不上索引),**四处冲突全是 import 列表、每处 1 行,无语义冲突**。
`build:plugin` 通过、`npm test` 132/132;`npm run build` 与 `typecheck:metadata` 红,
但**纯净上游同样红**(另建纯净 worktree 做基线才敢这么说:123 → 118,新增 0、消掉 5)。
错误数按「文件+错误码+消息」归一化后比,直接比字符串会被行号位移骗到。
**不提 PR**:三个阻碍(默认启用语义、MongoDB 原子性、文档八项)未收口,部署行为兼容性未验证。
**分支已推到 fork**(2026-09-13,远端 SHA 读回 `c372d80` 与本地一致,树内 `evaluation/` 0 文件、
相对 `0468a2a` 为 21 文件 `+4043/−34`):<https://github.com/VittorioCai/TencentDB-Agent-Memory/tree/gate-core-minimal>;固定比较区间 <https://github.com/VittorioCai/TencentDB-Agent-Memory/compare/0468a2a...c372d80>。作为辅助验证材料,主交付仍是 `topic4-attribution-gate`。
事先设的"超过一天就停"没触发——实际约十分钟。详见 `evaluation/gate/PORT-TO-UPSTREAM.md`。

## 第六轮复核(2026-09-12 夜,上游候选二批)已处置其一

复核方在上游 `0468a2a` 上给了四条 proxy 缺陷,我逐条在代码里复现,**四条全部成立**,
并核出两处比复核方所述更硬的事实:① 那个写开关的**产品默认就是 false**
(`config.ts` 的 `DEFAULT_CONFIG` + `config.example.yaml:663`),所以不是"设置之后才出现";
④ download 分支里唯一一处埋点在 `catch` 里,**其注释表明有人已为失败路径补过同类洞、把成功路径落下了**——
契约是代码自己承认的。另修正复核方对 ② 的表述:`-o` 是纯客户端参数,服务端按**子路径**分流,
所以那句说明不只是端点写错,是断言了一个服务端不可能有的行为。

**已提:上游 PR [#1359](https://github.com/TencentCloud/TencentDB-Agent-Memory/pull/1359)**
(第 ① 条,2026-09-12T23:03Z 开,base `feat/server_team`,唯一提交 `2a60304`,带 DCO 签核,
`+146/−8`、3 文件)。**已提交上游,待审核;无任何自动检查结果**(`pr-ci.yml` 只在 base 为 `main` 时触发),
本地验证为 9 个测试(先写后改,3 个走真实注入路径)、`tsc` 前后同为 60 条既有错误、隔离守卫 PASS。
查重按全部历史刷新过:`skill_patch` / `40302` / `SKILL_LISTING_HEADER` 等词零命中;唯一文件级重叠
是 #1281,它改写的正是同一行 `new SkillInjector({...})`,但其 diff 不含写开关与写指令,不处理本问题——
已在 PR 正文写明冲突点与解法(两个字段都留)。归档 `evaluation/upstream/readonly-skill-listing/`。

**第 ④ 条已提:上游 PR [#1360](https://github.com/TencentCloud/TencentDB-Agent-Memory/pull/1360)**(2026-09-13,唯一提交 `59c3465`,带 DCO,`+133/−0`、2 文件,已提交待审核、无自动检查结果)。它是四条里论证最硬的一条:**契约由代码自己的注释承认**——那处 catch 分支的补丁注释写着"之前静默 return 导致 CH 少一条",失败路径补过、成功路径被落下。下游消费者经自己核实(`analytics-sql.ts` 的 `bridge_calls` CTE),非照抄复核方。推送前自查修掉三处:正文里一个没测过的数字(已补对照测试)、差点再添一个会烂的行号引用(该文件既有的 `:822` 已经烂了)、以及 `git stash -u` 导致的假 tsc 基线。归档 `evaluation/upstream/download-telemetry/`。

**②③ 保留待办**(下载配方指向 JSON 接口、合法空文件被当异常、成功下载缺埋点),按审阅裁定
排在交付验收通过之后。**一处自陈的缺点**:#1359 里只读那句替代文案是我们选的措辞,属产品表面的决定,
PR 正文当时没为它留讨论空间;已备好一条把该决定交还维护者的评论,是否发出由用户决定。

## 第五轮复核(2026-09-12 晚,只查上游候选,不查交付内容)已处置

复核对象是准备提给上游的候选二。复核者**先否掉了我们自己的问题定义**:把它写成"任务永不消费"是错的——
`trigger-service.ts` 161 写归档、179 拿 tasks mutex、209 `enqueueAgent`,归档成功时任务已登记并入队;
worker pool 的构造只看 `skill.enabled`,提取关闭时照样启动。而且上游按存储模式有两条 extractor 构造路径
(service 每实例一个、standalone 用进程单例,`skill-config.ts` 现在还多了 mongodb 后端),从单例缺失推不出所有部署。

重新定位为**响应可观测性修复**并全部照办:标题 `fix(memory-core): expose extraction configuration in skill archive
responses`;字段 `extraction_enabled` 而不是 `queued`,配置不可得时 `null` 不是 `false`;覆盖三个归档入口;
测试按复核者列的五类全做(外加 force-archive 两种返回,共 6 例);复现证据必须含任务登记记录与 worker 失败日志,
"候选池没新增"不得单独作证;PR 正文写明与 #1117 的区别,并声明不解决已排队任务的重试策略、不宣称各存储模式都遵守该开关;
查重覆盖仓库全部历史而非只九月。产物在 `evaluation/upstream/skill-extraction-flag/`。

**已提:上游 PR [#1358](https://github.com/TencentCloud/TencentDB-Agent-Memory/pull/1358)**(2026-09-12T18:40Z,base `feat/server_team`、head `VittorioCai:fix/skill-extraction-flag`,OPEN、非草稿、mergeable)。核过:2 个提交作者均 `Vittorio Cai <vittoriocaiyx@gmail.com>` 且都带 DCO 签核;+212/−5、5 个文件与本地一致;正文按上游 `.github/PULL_REQUEST_TEMPLATE.md` 排版(五节标题与六个勾选项与模板逐字一致,`diff` 无差异),**无 AI 生成标记**。**没有任何自动检查会跑**——`pr-ci.yml` 的触发条件是 `pull_request: branches: [main]`,而本 PR 的 base 是 `feat/server_team`,所以正文里的自测是唯一证据;本地已按真实 base 跑过 CI 里那个守卫(`BASE_REF=origin/feat/server_team bash scripts/ci/check-skill-queue-isolation.sh` → PASS)。要求维护者跑 CI 时不能把 base 改成 `main`(不相干历史),只能手动触发或本地复跑。

复核者的裁定(2026-09-12 晚):**"100 行以内"这条标准作废**——它与"实现主体 10–15 行 + 一个测试不能当完整提交范围"
自相矛盾,砍掉文档与 SDK 会退回成"加了个没人知道的字段",按 +212/−5 提;DCO 身份确认为
`Vittorio Cai <vittoriocaiyx@gmail.com>`;base 选 `feat/server_team`。候选一与候选三**已被上游他人占位**
(#1348 `fix(memory-core): preserve source fields in conversation search`、
#1349 `fix(proxy): send a configurable bearer on the auth verify call`,均 2026-09-11 开),不提。

## 第四轮复核(2026-09-12,口径写在文档里、代码不是那么算的)已处置

两条全部成立,改在生成器与渲染器,报告与评估重新生成:

| 条 | 处置 |
|---|---|
| 第二任务把一次假阴性写成"不计分母的弃权" | `unknown_adoption` 只适用于**参考答案不知道是否采纳**;那一次参考采纳成立(标记在新增测试里、绑到写入调用、验收 PASS)、判定器没说用,`classifyUsage({adopted:true,judgedUsed:false})` 返回 `false_negative` 且 `counts_toward_rate: true`。生成器那句、计数表那一行的标签、STATE 里第二轮的记录都已改;复核者是直接拿保存的工件调现有函数得出结论的,我复现了同一结果 |
| 给人看的 Markdown 没跟上 JSON 的事实/推断之分 | `assess.mjs` 的 `renderMd` 重写并导出(+2 测试):标题「作者评估(资产结果概况)」、`**本资产结果概况:<level>**`、逐条先 `记录事实(程序生成)` 再 `  - 模型表述(语义未核验)`、`**程序核到哪一步**: <scope_note>`;五份评估用 `--recheck` 重新渲染(未重新调模型),并修掉 recheck 路径把页头渲染成 `classes undefined` 的问题 |

## 第三轮复核(2026-09-12,只查"事实成立但结论多走一步")已处置

五条全部成立,改在生成器、核对器与 Core 里,报告重新生成:

| 条 | 处置 |
|---|---|
| "测试约定被采用"被扩大成"修复路径受笔记影响" | 两份报告改成:直接证据支持的是**测试约定被采用**,最终代码通过独立验收;**未单独证明**根因判断或修复方案来自笔记(副本里已有正确实现可参照)。"迁移"限定为可观察的约定迁移 |
| `validated` 被读成"笔记帮上了忙" | 两份报告写明操作定义:① 结果绑定的写入采用了笔记约定 **且** ② 该次运行最终副本通过独立验收,两件事并列;不表示这次写入促成了通过 |
| 只看同一资产仍不能把结果标签叫作者能力 | 字段仍叫 `competence`(与已签名摘要兼容),但一律读作**资产结果概况**;`asset-gate.ts` 的理由串改为 `asset-outcome profile … on this asset … not a verified measure of the author`,**因此重建镜像并切换**(见线上状态行),线上试算已读回新措辞 |
| "程序核对了事实"强过实际 | 核对器给每条保留的声明生成 `fact_sentence`(只用记录字段造句),模型原话另列 `model_statement`,输出带 `scope_note` 写明:自由文本的语义与适用范围不在核对范围内;两份 README 同步 |
| "回流闭合"把两条流程串成一条 | 第一任务报告拆开:① 初始笔记经 `skill/create` 整理入池 → 被使用 → 被验证 → 准入(走完);② 会话经 `skill/extract` 产生 10 条候选,只到回流,使用与验证尚未展示 |

另按用户提醒:`author/artifacts/` 下 8 个仍带 `chain_complete` 的历史件已逐个加 `schema_note_2026_09_12` 标明是旧形状(不改原记录);
`runner/runs/*/gate-apply.json` 里的同名字段是 Core 当时返回的原始运行记录,不修改;写进 Core 的那份摘要也仍是旧形状,要换需再写一次评估。

## 第二人复核第二轮(2026-09-12,作者评估与两份闭环报告)已处置

复核对象:`evaluation/author/`(证据包、核对器、评估)与两个闭环 REPORT。六条意见全部成立,已改在实现与生成器里:

| 条 | 处置 |
|---|---|
| P1 作者评估在资产没有判别值时接受无关证据为"强矛盾" | 没有判别值时,**别的资产**上的结果一律记 `silent`(relevance unverifiable);同资产同版本同内容仍按身份关联(`check-citations.mjs`,先失败后通过的测试 2 个) |
| P1 "A 的来源链完整"只是三个集合各自非空 | `chainFacts()` 取代旧 chain:去掉 `complete`,写入者作为事实保留,生产来源记 `production_link: unproven` 并写明相邻关系未验证;空集合列为 `gaps`(测试 2 个);README 的"complete"说法改写 |
| P2 medium 是全部业务结果,不是所问领域 | 等级只由**被评估资产上**的业务结果得出,跨资产结果单列为历史(`domain_counts` / `cross_asset_history` / `scoped_to`);领域无结果 → `unknown`(测试 3 个) |
| P2 第二任务"采用待复核 0"掩盖了一次归因待复核 | 计数改为两个口径分列:参考采纳(验收器)4/4、判定器 used+validated 3/4、仅 needs_review 1/4。**第四轮改正**:那 1 次不是"弃权",`unknown_adoption` 只适用于参考答案未知;参考采纳成立而判定器未产出 used,`classifyUsage` 给的是 **false_negative 且计入分母**,报告与生成器都已按此改 |
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
| 彩排 D → E | 干净克隆、无密钥、无 Core、无 docker;D 用会话里的登记簿,**E 用 git 带来的登记簿**(HEAD 6425619) | 套件 610/610(当时的数);重判副本重生成 14;校准 / 汇总 / reparse / 两份 REPORT diff 0;判决类步骤全过 |
| 彩排 G(最新) | 同上,当前 HEAD(两轮复核改动之后) | 套件 626/626(当时的数;现为 630);校准 / 汇总 / reparse / 两份 REPORT diff 0;判决类步骤全过 |
| 彩排 C | 同上但无登记簿 | 重判停在取不到值,校准 / 汇总 / 重判差异跑不了 |
| 彩排 I(最新,2026-09-13 15:12Z) | 从 fork 克隆 `7429693`(第七轮复核修完之后),无密钥、无 Core、无 docker | 套件 **745/745**;离线**全部通过**,含新加的 `reports-executed`(13 份逐份对上)与 `chain 3/3 条 case`;`conditions-check` 41 项 FAIL 属 C 组按设计不通过 |
| 彩排 H(2026-09-13 14:42Z) | 从 **fork 克隆**受测提交 `b14cb6b`(评委拿到的那份),无密钥、无 Core、无 docker | 套件 **729/729**;十一份生成报告 diff **全为 0**(含新加的第三任务 REPORT、五份作者评估);重判副本从登记簿重生成 14 份;污染批检 8 次样本全干净;生成报告登记 73 份无未登记;对照报告 26 格一致。`conditions-check` 41 项 FAIL 属 C 组按设计不通过 |

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
