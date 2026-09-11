# 交接状态(受控文件)

本文件是证据索引,不替代原始证据和实时核对(CLAUDE.md §15)。接手后先核对实时 HEAD
与本次操作依赖的运行状态,再动手。同一时刻只由一个指定执行会话修改本文件。

| 项 | 值 |
|---|---|
| 当前执行负责人 | 执行会话(Claude Code),worktree `.claude/worktrees/topic4-gate0` |
| 分支 | `topic4-attribution-gate`,远端 `mine`(推送由用户手动完成) |
| 上次验证的实现提交 | 本文件所在提交;本次改动见 `git log -1 -- evaluation/STATE.md` |
| 验证时间 | 2026-09-11 晚(第 5 件最小开发闭环闭合:无/有笔记各 2 次、回流 10 项候选、闸门按规则 admit;第 6 件交付复跑见 `evaluation/delivery/2026-09-11/SUMMARY.md`) |
| 测试 | evaluation 580(2026-09-11 晚,全 0 失败;含 exit-code-fix 反例 11 + 单测 14,主分支已含闭环接受的修复及其回归测试);Core 122;proxy 24 |

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

## 需决策事项

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
7. ~~闸门 apply~~ 已做(规则 admit → approved)。笔记现为 approved,是产品规则的判定;若要回到实验前状态由
   管理员置 candidate。

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

## 证据位置

| 什么 | 在哪 |
|---|---|
| 批次四对照报告(新口径) | `evaluation/runner/COMPARISON-2026-09-11-reparsed.md`;表格 `summary-2026-09-11-reparsed{,-noread}.md`;校准 `attribution/CALIBRATION-batch4-reparsed-2026-09-11.md`;差异 `attribution/REPARSE-DIFF-2026-09-11.md` |
| 旧口径(保留) | `evaluation/runner/COMPARISON-2026-09-11.md`(顶部有取代说明)、`summary-2026-09-11.md`、`attribution/CALIBRATION.md`(名单已对齐)、`CALIBRATION-2026-09-11-as-committed-ef22463.md` |
| 重判副本(仓库外,可重生成) | `/private/tmp/topic4-rejudge/2026-09-11/<run_id>/`,命令在新报告开头 |
| 条件清单(冻结 2026-09-10T23:21:51Z) | `evaluation/gate/artifacts/batch4-conditions.json` |
| 闸门基线(冻结 23:20:45Z,source_runs = 两次 b4-prep) | `evaluation/gate/artifacts/gate_baseline_batch4.json` |
| 批次清单(顺序、退出码) | `evaluation/gate/artifacts/batch4-runs.json`;驱动日志 `batch4-runs.log`(本地,按 .gitignore 不入库)|
| 核对输出 | `batch4-conditions-check.txt`(开批次前 61+2)、`batch4-conditions-check-post.txt`(批次后 53/9/2) |
| 检查点输出 | `batch4-trial-gate-{off,on}.txt`(开批次前 16 条)、`batch4-formal-checkpoints.txt`、`batch4-prep-trial-checkpoints.txt`(17 条) |
| 运行记录(不入库) | `evaluation/runner/runs/20260910T23*`,14 个目录;旧批次未改动 |
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

**Core 资产状态**:两条资产 v4;批次结束时 right `approved`、wrong `failed`(最后一次是
gate-on)。恢复 approved 由用户跑 `core-gate.sh --reset --baseline …gate_baseline_batch4.json`。
笔记 `skl-pXLc38dex6Zt` v1:team、**approved(闸门规则 2026-09-11T16:54:11Z)**;10 项由消费者会话提取的候选
(private,属 usr-4u07qc2kuj)。**Core 提取开关**:off(16:52:28Z 恢复,sha 66ebab0a…;备份与恢复命令在
`evaluation/tasks/exit-code-fix/extraction-switch.jsonl`)。**proxy 强制身份**:最后一次运行的消费者
`agt-hsylov19pn`;回到批次四消费者的命令见上文第 5 件。

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
