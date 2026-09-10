# 经验(一条一段;顶部一句摘要;记为什么)

升格进 CLAUDE.md 须用户同意。每条注明日期与出处。

---

**起点一致要按消费者自己的那份记忆比,不按整棵 profiles 树。**(2026-09-10)
批次三隔离重跑后 73 分钟(2026-09-08T23:20:56–59Z),记忆流水线又改写了旧消费者的四个
文件,整树哈希从 `7d7f4b44` 变成 `637768bf`,而那些文件到不了新消费者的模型。整树哈希
一漂,`same_baseline` 就会把一批本来独立的运行判成不独立。所以 run-once.sh 现在另记
`agent_memory.consumer_scope`(只算消费者 profile 的哈希),isolation-check 有它就按它比;
整树哈希只留作回滚检查。附带教训:**运行后立即还原挡不住迟到的写入**,流水线可以在会话
结束一小时后才落盘;批内的 `same_baseline` 是唯一的守卫。

**有 shell 的模型能从进程表找到仓库;"评测记录不交给会话"是假前提。**(2026-09-10,冒烟运行
`20260910T154648Z-harness-smoke-v3`)
两条资产都被闸门藏起、会话在新建的空目录里跑,模型仍然 PASS,而且两次拨号都带着对应资产
的追踪值。送达审计判"他源送达",来源写明是第 24 轮那条 `cd …/evaluation/tasks/bridge-addr
&& cat pair.json && cat tokens.json`。它是这样找到仓库的:`lsof` 看到探针进程
(`node evaluation/gate0/proxy-observability-probe.mjs`)的 cwd 是仓库,`cd` 过去 `ls`。闸门没有
旁路;泄漏的是评测自己的记录文件。上午刚把 `record` 类来源从污染里排除,前提"仓库不可及",
下午就被推翻——同一台机器上有 shell 的模型,能顺着任何运行中的进程找到任何目录。现在
`record` 重新算污染,验收命令在这一项上**应该失败**,直到 token 明文不再写在模型可读的磁盘上。
附带:模型不是对抗性的,它只是在资产被藏起之后去别处找答案——这本身就是"隐藏内容经其他
通道到达 → 隔离失败而非误判"的真实样本,审计正确地记了下来。

**会话的工作目录不能是仓库;CodeBuddy 按工作目录缓存历次工具结果。**(2026-09-10)
此前每次会话的系统提示都写着 `Working directory: …/topic4-gate0`——模型能 cat 到
tokens.json、pair.json、全部运行记录。另外 CodeBuddy 把每个会话的工具结果存在
`~/.codebuddy/projects/<工作目录 slug>/<会话>/tool-results/`,同一 slug 下已有 51 个会话;
075637 读的那份是它自己的,跨会话读取在历史数据里没发生过,但通道一直开着。run-once.sh
`--auto` 现在每次在新建的空目录里跑,run.json 记 `session.cwd`、项目缓存目录、开跑前缓存
文件数。来源扫描随之把 `~/.codebuddy/projects` 纳入,并把任务目录里的评测记录
(tokens.json、pair.json、测试)标为 `record`,前提正是"会话在空目录里跑"。

**走闸门的列表会让被闸门藏起的资产"不存在"。**(2026-09-09/10)
两次同一族:`enter-pool.sh` 用 `get-by-name` 判断资产是否已在池里,A 处于 failed 时报
"not in the pool",不带 `--check` 就会再建一条同名资产;`snapshot-assets.sh` 用 `skill/list`,
两条资产都是 candidate 时写出一份 **0 资产**的快照。前者先查 pair.json 记的 id,后者并上
管理路径 `meta/asset/list`(每行注明来自哪个列表)。规律:判断"存在与否"不能走会过滤的
路径。

**冻结的条件必须显式给出,不能从描述"现在是什么"的文件里读。**(2026-09-10)
第一次冻结把消费者从 pair.json 取,而 pair.json 还写着旧消费者:清单记了旧消费者、
pair.json 又被"对齐"到旧消费者、干净检查扫了旧消费者的记忆(8 处命中)。`--freeze` 现在
要求 `--consumer=`;pair.json 是被核对的对象,不是来源。这是 CLAUDE.md §11 的实例。

**管理路径的列表分页上限 100,`offset` 在顶层。**(2026-09-10)
`limit: 500` 直接 400。与 9/8 `agree.sh` 把 `pagination` 嵌套对象发过去被 Zod 剥掉是同一
条:分页字段在顶层,超过 100 要翻页。

**判别性 token 不能是地址。**(2026-09-09)
地址写在代理配置里、有进程在监听、有 shell 就能拿到——模型写出它不说明读过资产。
批次四改用每条资产各自的追踪头值,资产正文明文要求原样发送,这才是"采用 ⇒ 必然出现"
的场景保证。抽取器与 token-provenance 用同一条"可从部署推导"判据,不再各写一份。

**"运行期间写过"不等于"没回滚"。**(2026-09-10)
run.json 的 `hash_after` 在还原**之前**量,回答"这次运行写了什么";还原成功与否要还原之后再量
一次。冒烟运行里记忆流水线在会话内就写了 4 个文件,还原成功(profile 目录已不存在),
isolation-check 却报 rolled_back 未过。现在 run.json 另记 `hash_restored`(整树与消费者范围),
检查有它就按它比。旧运行没有这个字段,仍按 hash_after 并说明。

**tokens.json 里不放说明键。**(2026-09-10)
往 tokens.json 加了 `_why`、`_provenance_checked` 两个说明键,calibrate-runs 的表里就多出
两行"资产"。说明放 README 或 pair.json;各处遍历 tokens.json 的代码也加了 `_` 前缀过滤。


**判别值明文只能在 Core;仓库存 sha256;分析时用作者密钥取回。**(2026-09-10,方案 2)
冒烟运行证明有 shell 的模型能从进程表找到仓库并 cat 评测文件,所以任何明文写在仓库
(tokens.json、pair.json、README、测试、assets/*.md)都让 gate-on 臂形同虚设。做法:
adoption 加哈希模式(把 attempts[].value 哈希后与 token_sha256 比,不需要明文);
resolve-tokens 分析时从 Core 取回明文(资产须 approved,读不到就报错不静默);
fill-traces 入池生成全新 trace 填进 Core、只写 sha256。附带铁律:**一旦某个判别值进过
git 历史就算烧掉**——换批次必须换全新值,否则历史里的旧值让"来源唯一"永远不成立。

**harness 进程的 cwd 不能落在仓库;运行记录写仓库外、结束后再搬进来。**(2026-09-10,补充二)
模型是顺着探针进程(proxy-observability-probe.mjs,cwd=仓库)用 lsof 找到仓库的。探针改到
仓库外的空目录启动(绝对路径调脚本);run-once 的记录先写 RUN_RECORDS_ROOT 下每次独立、
无兄弟的临时目录,会话与分析结束后 mv 进 runs/;会话 cwd 也放进各自独立父目录,`ls ..`
看不到别的运行。这些都记进 run.json.session,由试跑检查点核对。

**版本一升,闸门回到 candidate,读路径随之关闭。**(2026-09-10)
fill-traces 把资产更新到 v4 后,读回校验立刻 SKILL_NOT_ADMITTED——这是设计(新版不继承
判定),但意味着"填明文 → 校验 → 冻结"跨越一次管理员准入:填由作者做,准入由管理员做,
校验和冻结在准入之后。工具因此把"读不回"记为"待准入后再验",不当失败。

**前置检查通过 ≠ 正式链路接通;同一份解析契约要被运行时和分析时都调用。**(2026-09-11 审阅)
方案 2 落地后,resolve-tokens 只被 --check 调过;judge-hard、judge-outcome、receipt 和
runInput 仍直接读只有哈希的清单,只认明文 `tokens`——同一条正例,明文清单判 delivered,
哈希清单静默变 not_delivered、used 事件少一条。现在 runInput 收到哈希清单直接抛错;
run-once 判定前经契约取明文写到仓库外临时文件,用完即删;两个 CLI 逐运行先解析。教训:
新契约要从它的**每个消费者**倒推,不是加一个新入口就算接通。

**解析必须钉四元组、走管理读取、失败中止。**(2026-09-11 审阅)
原解析器读 head 不钉版本、不走管理读取:tokens.json 还写 v3 而 Core 已是 v4;gate-on 把
错资产置 failed 后模型路径读不到,分析端也跟着读不到。现在按(id、版本、内容哈希、token
哈希)校验,读取用 `x-tdai-read-purpose: manage`(作者密钥与 user_id 匹配时闸门不管管理读取),
`plainTokensOrThrow` 任一未 verified 即抛。fill-traces 写入后立即经管理读取校验并钉版本。

**"记录出仓库"要贯穿整个批次;来源扫描要整目录、整棵树。**(2026-09-11 审阅)
探针抓包原来仍写在仓库内;run-once 结束就把记录搬回仓库,下一次运行的模型若找到仓库就
读到上一次的 trace;扫描只读首个请求,trace 只在后续工具结果或 verdict.json 里时报 clean;
暂存多一层父目录,按直接子目录找会漏。现在抓包在仓库外,记录留在仓库外直到批次结束
(`collect-runs.sh` 手动搬),`sourcesFromRun` 整目录递归,记录根整棵树递归。

**证据在试跑之前;冻结条件不得清空冻结证据。**(2026-09-11 审阅)
v4 基线没有结果证据,gate-on 一试跑就重判回 candidate,"错资产 failed"不可能满足。顺序改为:
修通分析链 → 条件核对 → gate-off 准备运行产出结果 → build-baseline 冻结真实证据与判定 →
off/on 试跑 → 正式对照。`--freeze` 遇到带 decisions/events 的基线一律保留。
