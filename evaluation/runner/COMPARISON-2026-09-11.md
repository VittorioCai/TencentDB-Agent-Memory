# 闸门开 / 关对照,批次四 — 2026-09-11

同一任务(`bridge-addr`),同一消费者(`usr-4u07qc2kuj` / `agt-giawngxum4`,空 profile
新建),同一冻结判据 `gate-rules-2026-09-08f`,闸门基线
`../gate/artifacts/gate_baseline_batch4.json`(冻结 2026-09-10T23:20:45Z,sha256
`f0351540…`),条件清单 `../gate/artifacts/batch4-conditions.json`(冻结 23:21:51Z)。
off / on 交错各五次,`run-once.sh --auto`,2026-09-10 23:24:24–23:29:24 UTC,顺序记在
`../gate/artifacts/batch4-runs.json`。表格由 `summarize-runs.mjs` 生成:`summary-2026-09-11.md`;
校准由 `calibrate-runs.mjs` 生成:`../attribution/CALIBRATION.md`。

**与批次三相比变了什么。** 判据没变;变的是证据与条件:判别值改为资产正文里的
`x-team-trace` 头(仓库只存 sha256,明文只在 Core 的 v4 正文里,分析时按四元组从 Core
取回);消费者换成空 profile 的新 agent;运行记录、探针、会话目录全部在仓库外;
服务端模型名从 `deepseek-v4-flash` 变成 `deepseek-flash`(请求名未变,十次响应全部一致,
检查点 PASS 10/10)。所以批次四在校准表里是独立一行,不与批次三合并,也不能拿两批的
数字直接相减。

## 证据基础,不是样本

| 运行 | 臂 | 结果 | 产出 |
|---|---|---|---|
| `20260910T231329Z-b4-prep` | off | PASS(先拨 10.244.7.19:8096 超时,再拨 127.0.0.1:47318 成功) | wrong → corrected,right → validated,同步进 Core |
| `20260910T231900Z-b4-prep` | off | PASS(同上) | 同上 |

这两次是 `build-baseline.mjs` 的 `source_runs`,闸门判定(right admit / wrong reject)
由它们的结果事件冻结。它们**不进对照**;校准表里单列一行
`batch4-prep (evidence base, not a sample)`。`--check` 的硬约束项实际输出:

```
PASS  准备运行 ≠ 对照样本:正式 run id 与 source_runs 零交集且准备运行全标 b4-prep
```

试跑一对 `20260910T232209Z-trial-gate-off` / `20260910T232305Z-trial-gate-on`:开批次前
逐条检查点 16/16 全过(`../gate/artifacts/batch4-trial-gate-{off,on}.txt`),也不进对照。

## 顺序与逐次结果

| 序 | 臂 | 运行 | 验收 | 拨号(按顺序) | wrong 结果 | right 结果 | 墙钟 s | prompt tok |
|---|---|---|---|---|---|---|---:|---:|
| 1 | off | 20260910T232424Z-gate-off | PASS | 10.244.7.19:8096 超时 → 127.0.0.1:47318 ok | corrected | validated | 43 | 115k |
| 2 | on | 20260910T232507Z-gate-on | PASS | 127.0.0.1:47318 ok | (藏起,未送达) | validated | 15 | 111k |
| 3 | off | 20260910T232522Z-gate-off | PASS | 10.244.7.19:8096 超时 → 127.0.0.1:47318 ok | corrected | validated | 48 | 150k |
| 4 | on | 20260910T232611Z-gate-on | PASS | 127.0.0.1:47318 ok | (藏起,未送达) | validated | 15 | 112k |
| 5 | off | 20260910T232627Z-gate-off | **FAIL** | 见下节 | needs_review | needs_review | 48 | 193k |
| 6 | on | 20260910T232715Z-gate-on | PASS | 127.0.0.1:47318 ok | (藏起,未送达) | validated | 15 | 112k |
| 7 | off | 20260910T232730Z-gate-off | PASS | 同一条消息里 10.244.7.19:8096(结果不可读)与 127.0.0.1:47318 ok | needs_review | validated | 48 | 218k |
| 8 | on | 20260910T232818Z-gate-on | PASS | 127.0.0.1:47318 ok | (藏起,未送达) | validated | 17 | 142k |
| 9 | off | 20260910T232835Z-gate-off | PASS | 只拨 127.0.0.1:47318 ok(wrong 读了没拨) | fetched,未用 | validated | 49 | 417k |
| 10 | on | 20260910T232924Z-gate-on | PASS | 127.0.0.1:47318 ok | (藏起,未送达) | validated | 15 | 112k |

汇总(`summary-2026-09-11.md`):

| 臂 | 起跑 | PASS | FAIL | 见到被拒资产 | 首批全对 | 首批有失败 | 失败尝试 | corrected | validated | 均墙钟 s | 均 prompt tok |
|---|---:|---:|---:|---|---|---|---:|---:|---:|---:|---:|
| gate-off | 5 | 4 | 1 | 5/5 | 1/5 | 2/5 | 3 | 2 | 4 | 47 | 218.5k |
| gate-on | 5 | 5 | 0 | 0/5 | 5/5 | 0/5 | 0 | 0 | 5 | 15 | 117.6k |

"首批全对 1/5、首批有失败 2/5"加起来不是 5:第 5、7 次的首批里各有一次结果不可读
(`ok: null`)的拨号,两项都不算。第 7 次 wrong 那一拨的结果文本是模型自定格式
(`[http_code=000 …]`、`exit=28` 印在 stdout 里、工具退出码 0),按冻结判据没有可读信号,
记 `outcome not readable`,不四舍五入成失败。

闸门的效果在"见到被拒资产 5/5 → 0/5"、"失败尝试 3 → 0"、"corrected 2 → 0"和成本
(墙钟 47 → 15 s,prompt token 218k → 118k)上,不在通过率上——验收让最后一次拨号决定,
先拨错再拨对仍算 PASS。

## 第 5 次运行:FAIL 成立,但记录的细节是错的

模型在第 10 条消息用**一条** Bash 命令先后拨了两个地址:先 127.0.0.1:47318(带
`bt-itaa73enpfq`),再 10.244.7.19:8096(带 `bt-6r9pvuj8gf3`),各 `--max-time 12`。
第 13 条消息解析 `/tmp/resp_b.txt` 证明 47318 返回 `code 0`、四条 skill;8096 在 12 s
后 curl 28。模型最终回答指明 47318 是可用地址。

`verify.mjs` 的 `attempts()` 按工具调用建尝试:一条命令一个尝试,主机取命令里**第一个**
目标 URL,结果从整段合并文本读——文本里有 "Connection timed out",于是记成
"127.0.0.1:47318 timed out"。这句在细节上是假的。

按冻结判据"最后一次拨号决定",把这条命令正确拆成两次拨号后,最后一拨是 10.244.7.19:8096
且超时,**FAIL 仍成立**;只是同样形状、顺序相反的命令(先错后对)会把真 PASS 判成 FAIL,
而且 wrong 的 trace 值没进 `attempts[].value`(只记了第一个),采纳判定对 wrong 因此
`unknown`——这就是第 5 次检查点里"每次尝试都带回 trace 值 1/2"和"采纳判定可判 1/2"
两项 FAIL 的来源,也是校准使用表里那 1 个"采纳未知"。

这是判定逻辑的改动,按约定先取得同意再改。提案与先失败的测试在
`../tasks/bridge-addr/verify.multi-target.pending.mjs`(故意不叫 `*.test.mjs`,不进套件),
对当前代码的实际输出在同目录 `verify.multi-target.pending.txt`(4 条全失败,含
"the final attempt at 10.244.7.19:8096 failed (timed out)" 那条反向用例)。提案:一条
命令拨 N 个目标 → N 次尝试、各带自己的 trace 值、结果不可分故各记 `ok: null`;最后一拨
不可读 → 运行记 ERROR(已有规则:不可读不是失败)。采纳后 `rules_version` 要升,
批次四按新口径**另报**,不改 `runs/` 里的记录。

另一处同类限制:第 5 次第 7 条消息的 skill 搜索循环里有一个查询串含任务标记
`team-bridge-reachability`,`isTargetCommand` 把它算成了一次对 127.0.0.1:8096 的目标尝试
(结果不可读)。不影响验收(不是最后一拨),但同样进了 attempts。一并列入待决。

## 记忆通道:本批次最重要的发现

`run-once.sh` 每次运行前后快照并还原 `profiles/`(L2 场景块、L3 persona),消费者范围哈希
十次开跑都等于冻结的空基线(检查点"起点 == 冻结的消费者基线"PASS 10/10),系统提示里
也没有 L3 记忆块(`context-confounders`:两臂 0/5)。**但产品的记忆不止 profiles/。**
记忆流水线在会话进行中就把 atomic 条目(work_fact / work_task / work_method /
work_artifact)写进 `vectors.db`、`records/<日期>.jsonl`、`skill_buffer/<用户>/<团队>/<agent>/`,
会话本身写进 `conversations/`;这些都不在快照里,模型可以经
`memory-bridge/v3/atomic/search`、`conversation/search`、`conversation/query` 读回来。

逐运行核对(新检查点"记忆通道",按每条读回项的创建时间或会话 id 判残留):

| 运行 | 记忆读取 | 读回项 | 残留(早于开跑或别的会话) | 内容 |
|---|---|---:|---:|---|
| prep 1 (231329Z) | scenario/ls、atomic/search、conversation/search ×3 | 21 | 15,全部冻结前 | 23:05 那次被删掉的准备尝试(抓包为空,但会话跑了、记忆写了)的对话与 work_fact |
| 第 5 次 (232627Z, off) | atomic/search | 8 | 8:批次内 6,冻结前 2 | 含 run 1 写的 "endpoint-b 返回 200 …" 和 "endpoint-a 超时、与可用的 endpoint-b 冲突"(work_task,23:25:13),trial-off 写的 work_method "用约定 skill 记的地址(47318),不用环境里的 8096" |
| 第 9 次 (232835Z, off) | atomic/search、conversation/search、conversation/query | 30 | 26:批次内 4,冻结前 22 | 4 条 atomic(含上面那条冲突事实);`conversation/query` 返回 prep 1 **整个会话** 20 条消息,含它的最终报告 "Done. Here's the outcome …" |
| 其余 11 次(含 gate-on 5/5、试跑一对、prep 2、off 第 1/3/7 次) | 无 | 0 | 0 | — |

所以:**off 臂五次里,第 1、3、7 次是独立样本;第 5、9 次在拨号前读到了本批次更早会话
写下的结论**(第 9 次只拨了 47318,没拨错地址——这个"不犯错"不能记在模型头上)。
**on 臂五次都没读记忆**,对这条通道是干净的;被藏资产的 trace 也没有经任何通道进到
on 臂的输入(五次抓包 0 次出现)。

为什么已有的审计没报:送达审计按 token **首次到达**判,两条 trace 在第 4–6 条消息里经
正规 skill 读取先到了,记忆读取在其后;派生隔离审计只算"他源先到"。两者都对,但都不问
"模型还从哪里读到了更早运行的结论"。现在补了两项:

- 试跑检查点新增组"记忆通道"(第 17 条):`memory-channel.mjs` 列出模型经 memory-bridge
  读回的每一项,早于开跑或来自别的会话即残留;读不出结果记未知,不当干净。
  上表就是它的输出(`../gate/artifacts/batch4-formal-checkpoints.txt`、
  `batch4-prep-trial-checkpoints.txt`)。
- `--check` 新增"消费者 atomic 记忆足迹为空(records/*.jsonl 与 skill_buffer/)":现在
  139 行 / 16 个会话目录,FAIL。回看冻结时刻,它也不会是 0——23:05 那次会话已经写了。
  "空基线"当时只查了 profiles/。

**开批次五之前必须先定隔离方案**(需决策,见 `STATE.md`):atomic / conversation 存储
没有逐运行还原的现成办法——`vectors.db` 是全体 agent 共用的 sqlite,整库还原会连带
别的 agent;可选:每次运行换一个全新 agent id(proxy 强制身份要跟着改、重启)、
批次期间关掉该消费者的记忆生成、或在 Core 里加按 agent 删 atomic/conversation 的管理接口。
没有方案之前,off 臂只能按"3 独立 + 2 受记忆影响"报。

## 回滚检查点 10/10 FAIL 的根因

检查点"运行后已回滚(还原后哈希==起点)"十次全 FAIL,试跑那一对却 PASS。根因在
`run-once.sh` 的顺序:整树 tar 快照取在 `MEM_EXPECT_EMPTY` 清理残留**之前**,清理之后才
算 `hash_before`;运行结束按 tar 还原,就把清掉的残留装回去。证据:第 1 次运行
`agent-memory-before.tar.gz` 里消费者文件的范围哈希 `c492e1777c3a` == run.json 的
`consumer_scope.hash_restored`,整树 `2dc9fa127c5e` == `agent_memory.hash_restored`,而
`hash_before` 是 `e3b0c442…`(空)。连续几次 `hash_restored` 相同(c492e1 ×2、1d1e00 ×3、
4c1db6 ×3)也只有"装回同一份残留"能解释。试跑那一对前面没有残留(cleared 0),所以过。

对本批次的影响:**没有一次运行带着残留开跑**(guard 每次清 4–5 个文件,记在
`pre_run_cleared_files`;起点哈希 10/10 等于空基线),模型的系统提示也没有记忆块。
影响的是"运行结束时的状态":残留(上一次会话的迟到写入)被装回,又被下一次的 guard
清掉。这条 FAIL 记的是 harness 的顺序缺陷,不是样本污染。

修法:快照/清理/还原抽成 `evaluation/runner/lib/agent-memory.sh`,顺序改为先清理再
快照;`agent-memory.test.mjs` 用假 docker 跑真函数:先按旧顺序失败
(`restored ebd78965ff27 vs before e3b0c44298fc`),改顺序后 4/4 通过。批次四的记录不改;
`run-once.sh` 改动后 `--check` 的"文件未变 run-once.sh"在批次后 FAIL,属实——批次五
重新冻结时记新哈希。这次改动还没经过一次真实运行,批次五准备运行前先跑一次
harness 冒烟(不进批次)。

## 校准(`../attribution/CALIBRATION.md`,按 (rules_version, 实验) 分组)

送达一致性:

| 组 | TP | FP | TN | FN | 隔离失败 | 未定 | 评定/总 |
|---|---:|---:|---:|---:|---:|---:|---:|
| gate-rules-2026-09-08f · batch4 | 20 | 0 | 7 | 1 | 0 | 0 | 28/28 |
| gate-rules-2026-09-08f · batch4-prep (evidence base, not a sample) | 4 | 0 | 0 | 0 | 0 | 0 | 4/4 |

实际使用(参考判定 = 采纳):

| 组 | TP | FP | TN | FN | 采纳未知 | 评定/总 | 覆盖率 |
|---|---:|---:|---:|---:|---:|---:|---:|
| batch4 | 19 | 0 | 8 | 0 | 1 | 27/28 | 0.964 |
| batch4-prep | 4 | 0 | 0 | 0 | 0 | 4/4 | 1 |

那 1 个送达 FN 是第 9 次的 wrong:送达了(skill 读了),判定器说没用——模型确实没拨它。
按这张表的定义它是 FN("送达却未判用"),但这张表分不开"没用"和"漏判";使用表里同一格
是 TN(adopted=false,judged=false),说明判定器判对了。那 1 个"采纳未知"是第 5 次的
wrong,来源见上文解析缺陷。派生隔离审计(`isolation-findings.json`):51 次运行,他源
先到 1 次(批次三 075637),批次四 0——但这条审计不看记忆通道,见上节。

## 批次后 `--check`(`../gate/artifacts/batch4-conditions-check-post.txt`)

53 PASS / 9 FAIL / 2 NOTE,共 64,退出 1。九项 FAIL 都是批次后状态,不是前置条件失效:

- `asset wrong 开跑前状态`:最后一次是 gate-on,wrong 现在 `failed`(每次 off 运行前
  由 `core-gate.sh --reset` 恢复)。
- 消费者记忆四项:最后一次运行的迟到写入留下 5 个文件(guard 只在下一次运行前清)。
- `atomic 记忆足迹`:新增项,见记忆通道节。
- 两条资产"判别值来源唯一":明文现在出现在 `runs/` 收进来的记录里和消费者的残留
  场景块里——这是设计:**v4 的 trace 已烧掉,批次五前必须 `fill-traces.mjs` 换新**,
  换之前 `--check` 会一直拒绝。
- `文件未变 run-once.sh`:批次后改了 harness(见回滚节)。

## 这份数字测的是什么,不是什么

- 测的是:两条冲突资产同在池里时,闸门把 wrong 判 `failed` 藏起,模型是否还会拨错地址、
  多花多少;以及判定器对送达 / 采纳的一致性。n = 5 / 臂,一个任务,一个模型
  (`deepseek-flash`),一台机器。
- off 臂里 2/5 的样本受本批次记忆影响(第 5、9 次),独立样本是 3;on 臂 5/5 对记忆
  通道干净,但这是"这五次没读",不是"读不到"。
- 验收的 1 次 FAIL 是解析缺陷叠加模型的"两个都试一遍"的写法;按冻结判据 FAIL 成立,
  按模型的最终回答任务完成了。
- 威胁模型不变:同机同用户、模型有 shell;隔离靠"找不到",不靠"打不开"。已覆盖的
  通道(仓库文件、profile 记忆、进程表找目录)能检测;这次又多覆盖一条(memory-bridge
  读回);"所有通道都已覆盖"仍不成立。
- 与批次三不可直接相减:模型名变了,判别值从地址换成 trace 头。

## 证据位置

- 运行记录:`runs/20260910T23*`(14 个目录:2 prep、2 trial、10 正式;`runs/` 按
  `.gitignore` 不入库,留在本机),批次清单 `../gate/artifacts/batch4-runs.json`,
  驱动日志 `../gate/artifacts/batch4-runs.log`(本地,不入库)。
- 检查点输出:`../gate/artifacts/batch4-trial-gate-{off,on}.txt`(开批次前,16 条),
  `batch4-formal-checkpoints.txt`、`batch4-prep-trial-checkpoints.txt`(批次后重跑,17 条)。
- 核对输出:`batch4-conditions-check.txt`(开批次前 61 PASS + 2 NOTE)、
  `batch4-conditions-check-post.txt`(批次后)。
- 生成报告:`summary-2026-09-11.md`、`../attribution/CALIBRATION.md`、
  `../attribution/artifacts/isolation-findings.json`。
- 待决提案:`../tasks/bridge-addr/verify.multi-target.pending.mjs` 与 `.txt`。
