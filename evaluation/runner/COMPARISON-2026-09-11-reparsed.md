# 闸门开 / 关对照,批次四(正式名单 + 新解析)— 2026-09-11

取代 `COMPARISON-2026-09-11.md`(保留不改)。两处不同:

1. **样本名单。** 主表只由 `../gate/artifacts/batch4-runs.json` 的十个正式 run id 生成
   (`calibrate-runs.mjs --manifest=`,`summarize-runs.mjs` 喂十个目录)。准备运行(`b4-prep`)
   和试跑一对(`trial-gate-*`)各自另列,不进样本。旧版把试跑一对(还传了两遍)混进了
   正式行:28 个判定,应为 20。
2. **验收解析。** 旧解析(attempts-v1)把一次工具调用当一次尝试,主机取命令里第一个 URL,
   结果读整段文本。新解析(attempts-2026-09-11,`../tasks/bridge-addr/verify.mjs` +
   `../provenance/shell-requests.mjs`)按四条边界重读,见"验收解析"节。批次四十四次运行
   在仓库外的副本上重判(`../attribution/rejudge-runs.mjs`,`runs/` 原记录不动),逐运行
   差异在 `../attribution/REPARSE-DIFF-2026-09-11.md`。

条件同旧版:消费者 `agt-giawngxum4`(空 profile 新建),判据 `gate-rules-2026-09-08f`,
闸门基线 `gate_baseline_batch4.json`(冻结 2026-09-10T23:20:45Z),条件清单冻结 23:21:51Z,
服务端模型 `deepseek-flash`(请求名 `deepseek-v4-flash`;批次三服务的是 `deepseek-v4-flash`,
所以两批不能直接相减),判别值是资产正文的 `x-team-trace` 头(仓库只存 sha256)。
off / on 交错各五次,2026-09-10 23:24:24–23:29:24 UTC。

复算命令:

```bash
node evaluation/attribution/rejudge-runs.mjs --out=/private/tmp/topic4-rejudge/2026-09-11 --task=evaluation/tasks/bridge-addr evaluation/runner/runs/20260910T23*/
node evaluation/attribution/calibrate-runs.mjs --frozen=gate-rules-2026-09-08f --task=evaluation/tasks/bridge-addr --manifest=evaluation/gate/artifacts/batch4-runs.json --md=evaluation/attribution/CALIBRATION-batch4-reparsed-2026-09-11.md /private/tmp/topic4-rejudge/2026-09-11/20260910T23*/
node evaluation/runner/summarize-runs.mjs <十个正式副本的目录> --baseline=evaluation/gate/artifacts/gate_baseline_batch4.json   # → summary-2026-09-11-reparsed.md
node evaluation/attribution/rejudge-diff.mjs --before=evaluation/runner/runs --after=/private/tmp/topic4-rejudge/2026-09-11 --manifest=evaluation/gate/artifacts/batch4-runs.json
```

## 结果(正式十次,新解析)

| 臂 | 起跑 | PASS | FAIL | 不可判 | 端点成功率 | 见到被拒资产 | 首批全对 | 首批有失败 | 失败尝试 | corrected | validated | 均墙钟 s | 均 prompt tok |
|---|---:|---:|---:|---:|---|---|---|---|---:|---:|---:|---:|---:|
| gate-off | 5 | 1 | 0 | 4 | 20% | 5/5 | 1/5 | 2/5 | 2 | 2 | 1 | 47 | 218.5k |
| gate-on | 5 | 5 | 0 | 0 | 100% | 0/5 | 5/5 | 0/5 | 0 | 0 | 5 | 15 | 117.6k |

同一表按记忆读取分组——**全批**与**"未观察到该类记忆读取"的子集**分别报
(`summary-2026-09-11-reparsed-noread.md`;子集 = off 第 1、3、7 次 + on 全部五次):

| 组 | off PASS / 不可判 | off corrected | off validated | off 均墙钟 s | off 均 prompt tok | on PASS |
|---|---|---:|---:|---:|---:|---|
| 全批(off 5,on 5) | 1 / 4 | 2 | 1 | 47 | 218.5k | 5/5 |
| 未观察到记忆读取(off 3,on 5) | 0 / 3 | 2 | 0 | 46 | 160.9k | 5/5 |

off 臂:**3 次未观察到该类记忆读取(第 1、3、7 次),2 次确认受记忆影响(第 5、9 次)**。
由于跨运行记忆影响和事后分组,两组的差异仅描述这些运行,**不作为闸门收益的无偏或保守
估计**。on 臂五次都没有记忆读取,被藏资产的 trace 在五次抓包里 0 次出现。

逐次(新解析;旧解析的判定在 REPARSE-DIFF 里并列):

| 序 | 臂 | 运行 | 验收 | 依据 | wrong 结果 | right 结果 |
|---|---|---|---|---|---|---|
| 1 | off | 20260910T232424Z-gate-off | **ERROR** | 最后一条消息同时发出两个工具调用:10.244.7.19:8096 超时、127.0.0.1:47318 code 0;并发无"最后一次" | corrected | needs_review(运行未 PASS) |
| 2 | on | 20260910T232507Z-gate-on | PASS | 单次请求 47318 code 0 | (藏起) | validated |
| 3 | off | 20260910T232522Z-gate-off | **ERROR** | 同第 1 次 | corrected | needs_review |
| 4 | on | 20260910T232611Z-gate-on | PASS | 同第 2 次 | (藏起) | validated |
| 5 | off | 20260910T232627Z-gate-off | **ERROR** | 一条命令先拨 47318 再拨 10.244.7.19:8096;服务端日志只答了一条,但本次探针没探过 10.244.7.19:8096(旧解析没把它记成尝试,探针按旧尝试探的),两条结果不可分 | needs_review | needs_review |
| 6 | on | 20260910T232715Z-gate-on | PASS | | (藏起) | validated |
| 7 | off | 20260910T232730Z-gate-off | **ERROR** | 同一消息两个调用:wrong 结果不可读(模型自定输出格式)、right code 0;并发 | needs_review | needs_review |
| 8 | on | 20260910T232818Z-gate-on | PASS | | (藏起) | validated |
| 9 | off | 20260910T232835Z-gate-off | PASS | 只拨 47318,code 0;wrong 读了没拨 | fetched,未用 | validated |
| 10 | on | 20260910T232924Z-gate-on | PASS | | (藏起) | validated |

## 验收解析:改了什么,为什么第 1、3、7 次从 PASS 变成 ERROR

四条边界(2026-09-11):每次实际请求分别绑定地址、trace、结果,一次工具调用可对应多次
请求;结果只在能从独立响应(服务端 `tool-call-logs.jsonl` 的 `bridge_call` 行)或文件
(`-o` 写出、后续调用读回)确认时才判定,不能分离记 unknown;`&&`、条件、循环、后台、
同一消息并发的多个调用,不凭 URL 出现顺序推断执行和"最后一次";任务请求按解析出的动作
与请求字段识别(POST 到 search 路径且 body 的 `query` **等于**标记),不看整段命令是否
含标记,也不只数地址或 trace 正确的请求。测试:`shell-requests.test.mjs` 11 条、
`verify.multi-target.test.mjs` 14 条(先在旧代码上 10 条失败)、`judge-outcome.test.mjs`
新增 2 条(先失败)、`verify.test.mjs` 21 条原有全过;套件 552/552。

**并发的证据,不是猜的。** 六次运行(prep ×2、trial-off、第 1、3、7 次)的最后一条消息都
同时发出两个工具调用:先写 wrong 地址、后写 right 地址。服务端日志里 right 请求的应答时间
与消息发出时间的差,以及整条消息的耗时:

| 运行 | 消息发出(UTC) | right 被应答 | 结果返回 | 消息耗时 | wrong 的 --max-time |
|---|---|---|---|---:|---:|
| prep 1 | 23:14:27.924 | +0.100 s | +5.2 s | 5.2 s | 15 |
| prep 2 | 23:19:23.177 | +0.060 s | +8.2 s | 8.2 s | 20 |
| trial-off | 23:22:23.369 | +0.060 s | +30.1 s | 30.1 s | 30 |
| 第 1 次 | 23:24:36.320 | +0.055 s | +20.2 s | 20.2 s | 20 |
| 第 3 次 | 23:25:39.863 | +0.086 s | +20.2 s | 20.2 s | 20 |
| 第 7 次 | 23:27:54.105 | +0.070 s | +12.2 s | 12.2 s | 12 |

right 在消息发出后 0.1 s 内就被应答,整条消息却跑满了 wrong 的超时:两个调用是并发执行
(或 right 先执行)的,"先拨错、超时后再拨对"这个旧读法在六次里都不成立。按冻结判据
"最后一次拨号决定",并发发出、结果不一致的一组请求没有"最后一次";已有规则"不可读不是
失败"→ ERROR。旧解析给的 PASS("after 1 earlier failure")来自文本顺序,不来自执行。
prep 2 旧解析还多记了一次 `127.0.0.1:8096=ok`:那是搜索循环里含标记的查询串,新解析
按 body 的 `query` 识别后不算尝试。

**第 5 次**:一条命令按换行先后拨 b(47318,`-o /tmp/resp_b.txt`)和 a(10.244.7.19:8096,
`-o /tmp/resp_a.txt`),各 `--max-time 12`。服务端日志在该调用窗口内只应答了一条标记请求
(23:26:52.979Z,status 200)。按规则,一条被应答归到唯一可达的地址、超时归到唯一不可达
的地址,需要本次运行的探针记录;但本次探针是按旧尝试列表探的(127.0.0.1:8096 与 47318),
没探 10.244.7.19:8096,可达性未知 → 两条都 unknown → ERROR。`/tmp/resp_b.txt` 后来在
第 13 条消息被 python 读回,但那次调用打印的是解析后的摘要(`code: 0 message: ok …`),
不是 JSON 信封;读回检查只认信封(`"code": 0`),因为宽松匹配会把 `Exit code: 28` 之类
也读成服务码——所以 b 也留在 unknown。即使 b 被确认,a 仍未知,最后一拨是 a → 仍是
ERROR。旧解析记的 "127.0.0.1:47318 timed out" 在细节上是假的;新记录里 47318 的请求列在
前、10.244.7.19:8096 列在后,各带自己的 trace。

**规则待决(需同意)**:并发发出、结果不一致的最后一组请求现在记 ERROR。可选的替代:
按完成时间取最后(六次里都是 wrong 最后完成 → FAIL),或"全部成功才 PASS"(现已对
全一致的组这样判)。哪一种都不会把这六次判成 PASS。

## 第 9 次:使用检测的真阴性,不是漏判

第 9 次 gate-off 读了两条资产(skill 读取都在捕获里),只拨了 47318。wrong 资产:送达
(delivered),判定器判"fetched,未用",操作里没有它的地址也没有它的 trace(adopted=false)。

- 在**送达一致性**表里它记 FN("送达了但判定器没说用"),因为这张表的参考值是送达。
  **内容送达不代表实际采用**;把送达当作使用真值,会把这次正确判断误记为漏判。
- 在**实际使用**表里同一格是 TN(adopted=false,judged=false):判定器判对了。

它关闭的只有 `../attribution/REMAINING.md:94` 的第 1 个用例("模型确实读了资产,但操作
不使用它":真实产生,不是手填标签)。第 3 件其余反例——不读而猜中、两资产共享 token、
到达晚于操作、隐藏内容经系统提示/记忆到达——**仍未验证**。

## 校准(`../attribution/CALIBRATION-batch4-reparsed-2026-09-11.md`)

只含批次四(十四个重判副本),分组按正式名单:

| 组 | 送达 TP/FP/TN/FN | 评定/总 | 准确率 | 使用 TP/FP/TN/FN/未知 | 评定/总 | 准确率 | 采纳证据覆盖率 |
|---|---|---:|---:|---|---:|---:|---:|
| batch4(正式十次) | 14/0/5/1 | 20/20 | 0.95 | 14/0/6/0/0 | 20/20 | 1.0 | 1.0 |
| batch4-prep(证据基础,不是样本) | 4/0/0/0 | 4/4 | 1 | 4/0/0/0/0 | 4/4 | 1 | 1 |
| batch4-trial(试跑一对,不是样本) | 3/0/1/0 | 4/4 | 1 | 3/0/1/0/0 | 4/4 | 1 | 1 |

核对:用旧解析、只改名单(`CALIBRATION.md`,同一命令加 `--manifest`),正式行是
送达 14/0/5/1、20/20、0.95;使用 13/0/6/0、采纳未知 1、19/20、准确率 1.0、覆盖率 0.95
——与审阅方独立重算一致。新解析后使用表的那 1 个"采纳未知"(第 5 次 wrong)可判了:
两条请求各带自己的 trace 值,wrong 的采纳读出 true。送达表不受解析影响(送达来自捕获,
"判用"来自 judge-hard),所以不变;那 1 个 FN 就是上一节的第 9 次。

## 记忆通道(同旧版,措辞改正)

profile 快照不覆盖 atomic 记忆(`vectors.db`、`records/`、`skill_buffer/`)和 `conversations/`。
第 5、9 次 gate-off 在拨号前经 `memory-bridge/v3/atomic/search`、`conversation/search|query`
读到了更早会话写的结论(第 9 次拿到 prep 1 整个会话含最终报告);其余十二次(含 on 臂
五次)没有记忆读取。检测已补:试跑检查点第 17 条"记忆通道"(重判副本上第 5、9 次 FAIL,
其余 PASS,`../gate/artifacts/batch4-formal-checkpoints-reparsed.txt`),`--check` 的
"消费者 atomic 记忆足迹为空"(139 行 / 16 会话目录,FAIL)。

**这条足迹在冻结前就存在**(23:05 那次被删掉的准备尝试写的),`--check` 当时没有这一项,
是前置检查漏检,不是批次后状态。逐运行隔离方案待决(见 `STATE.md`)。

## 批次后 `--check`

53 PASS / 9 FAIL / 2 NOTE(`../gate/artifacts/batch4-conditions-check-post.txt`)。九项 FAIL:
wrong 资产 `failed`(最后一次是 gate-on)、消费者 profile 残留四项(最后一次会话的迟到
写入)、两条资产"来源唯一"(v4 trace 已进收集的记录和残留,须换新)、`run-once.sh` 文件
已变(批次后改了 harness)——这七项是批次后状态;**atomic 足迹一项不是**,它在冻结时就
该失败;`run-once.sh` 变更后本报告的重判也用了新代码,已在 REJUDGED.json 记哈希。

## 这份数字测的是什么,不是什么

- 测的是:两条冲突资产同在池里时,闸门把 wrong 判 `failed` 藏起,模型是否还拨错地址、
  多花多少,以及判定器对送达/采纳的一致性。n = 5 / 臂,一个任务、一个模型、一台机器。
- off 臂端点成功率 20% 不是"模型 80% 失败":4 次不可判,原因是模型把对错两个地址**同时**
  拨(3 次)或一条命令连拨且证据不足以分离(1 次)。这四次里模型的最终回答都指明了可用地址;
  验收按冻结判据不读最终回答。
- 与批次三不可直接相减:模型名变了,判别值从地址换成 trace 头,解析也换了版本。
  批次三的对照同样含"同一消息双拨判 PASS"的读法,按新口径另跑另报之前不引用其 PASS 率。

## 剩余缺点

- 跨运行隔离尚未成立:atomic / conversation 记忆没有逐运行隔离方案(需决策)。
- 解析修正后的统计未经独立确认:本报告的重判由执行会话完成,审阅方尚未复核。
- 正式样本分母已修正(20/20),但需复核。
- 第 3 件反例只关闭了"读了没采纳"一例;第 4 件开发闭环、第 5、6 件交付验证待完成。
- 小样本、单场景、单主体、单模型;off 臂仅 1 次可判 PASS,4 次不可判。
- 采纳证据覆盖率:旧解析 0.95,新解析 1.0(仅本批次)。
- v4 trace 明文已进过 git(旧报告与已删的待决测试文件里写了值),换新前不得再开批次。
- `bridge-name` 场景的验收仍是旧解析(整段含标记),未随本次修改。

## 证据位置

- 重判副本(仓库外,可由上面命令重生成):`/private/tmp/topic4-rejudge/2026-09-11/<run_id>/`,
  各含 `verdict.json`(新)、`verdict.before-rejudge.json`、`outcome-events.jsonl`(新)、
  `outcome-events.before-rejudge.jsonl`、`REJUDGED.json`(代码哈希、命令)。
- 差异:`../attribution/REPARSE-DIFF-2026-09-11.md`。表格:`summary-2026-09-11-reparsed.md`、
  `summary-2026-09-11-reparsed-noread.md`;校准:`../attribution/CALIBRATION-batch4-reparsed-2026-09-11.md`。
- 旧口径(保留):`COMPARISON-2026-09-11.md`、`summary-2026-09-11.md`、
  `../attribution/CALIBRATION.md`(名单已对齐、旧解析)、`../attribution/CALIBRATION-2026-09-11-as-committed-ef22463.md`(对齐前)。
- 原始记录:`runs/20260910T23*`(不入库,未改动)。
