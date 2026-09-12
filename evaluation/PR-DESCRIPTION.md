# 题目四:可信归因与闸门 —— 分支 `topic4-attribution-gate`

交付形式(CLAUDE.md §9):分支 + 提交号 + 验收命令及其输出 + 脚本生成的报告 + 剩余缺点与需决策事项。
最终 HEAD 见 `git log -1`;下面每一项都指向仓库里的文件,不另抄数字。评审导读:`evaluation/REVIEW-GUIDE.md`。
交付载体是**分支本身**:https://github.com/VittorioCai/TencentDB-Agent-Memory/tree/topic4-attribution-gate
(导师的要求是「GitHub 分支代码 + 文档」,不要求 PR。fork 内曾开过 PR #1 作为浏览入口,2026-09-12 由用户决定关闭 —— 它的 diff 基线是上游 `feat/server_team`,会把 fork 相对上游的全部差异(2596 个文件)一起算进去,反而不如直接读分支。分支与提交历史不受影响。)

## 做了什么

1. **归因判定与校准(批次四)**:送达、采纳、收益三件事分开命名;判定按四条边界解析每次实际请求
   (地址、trace、结果各自绑定;能从服务端日志或读回文件分离才判定,分不开记 unknown;并发发出、结果不一致
   的最后一组记 ERROR);正式样本只由 `evaluation/gate/artifacts/batch4-runs.json` 十个 run id 生成。
   报告:`evaluation/runner/COMPARISON-2026-09-11-reparsed.md`(主报告)、
   `evaluation/attribution/CALIBRATION-batch4-reparsed-2026-09-11.md`、`evaluation/attribution/REPARSE-DIFF-2026-09-11.md`。
2. **闸门在产品里**:结果行经 `/v3/meta/asset/outcome/append` 以管理员身份记入 Core(可信行要带 call id、版本、
   内容哈希),`gate/evaluate` 由 Core 按规则(`gate-rules-2026-09-08f`)判定并写 status;冻结基线
   `evaluation/gate/artifacts/gate_baseline_batch4.json`(right admit / wrong reject)。
3. **开发闭环,第一任务(`evaluation/tasks/exit-code-fix/`)**:一个真实缺陷(工具结果退出行拼写)→ 经验笔记入池
   (值只在 Core,仓库存 sha256)→ 冻结起点的仓库副本、每次运行新建消费者 → 验证器独立验收(自带参考测试、
   受控套件跑起点测试原内容、模型自测只记不判、TAP 对账、归因取最终新增测试与写入调用)→ 无笔记 2 次 / 有笔记
   3 次(2 次在 v1、1 次在 v2)→ 结果行可信记入 → 会话经验经产品 `/v3/skill/extract` 回流(10 项候选)→ 闸门按规则 admit。
   报告 `REPORT.md`(脚本生成);清单 `devloop-runs.json`;记录 `extraction-switch.jsonl`、`gate-evaluations.jsonl`、
   `gate-observations.jsonl`、`visibility-fix.json`。
4. **开发闭环,第二任务(`evaluation/tasks/exit-line-collect/`)**:同一条笔记(轮换为 v2,正文不变只换标记)、
   另一个文件里的同类缺陷(`evaluation/attribution/collect-artifacts.mjs` 读不到真实工具结果的退出状态)、
   另一个消费者用户(c,零记录)、自己的产品任务实体(`product-task.json`)。验证器复用第一任务的(按任务目录参数化)。
   无笔记 2 次 / 有笔记 4 次(2 次绑第一任务实体、2 次绑自己的实体)+ 第一任务在 v2 上 1 次(用户 b)。闸门对 v2
   按规则 admit:cross_user validated 4、distinct_consumers 2、distinct_tasks 2(`gate-evaluations.jsonl` 末条)。
   报告 `REPORT.md`;清单 `devloop-runs.json`(含作废运行与原因、配置修正)。
5. **作者上下文评估进闭环(`evaluation/author/`)**:对作者 A 在笔记 v2 上、对消费者 B 在它自己回流出的候选上各做一次
   评估(证据包 → 模型逐条引用 → 程序核**引用真实性与结构化事实** → 管理员签名写入 → 闸门读),闸门理由里出现该评估并标明
   "reported, not used"(只定复核优先级)。证据包新增"作者作为消费者产生的结果"一本账(此前漏查,B 读成 unknown)。
   记录 `author/artifacts/assessment-{a,b}-exit-line.*`、`assessment-write-*.json`、`submit-b-*.json`。
   **2026-09-12 第二人复核后收紧**:① 资产没有判别值时,别的资产上的结果不能当支持/反驳(记 silent,relevance unverifiable);
   ② 能力等级只由被评估资产上的业务结果得出,跨资产结果单列为历史,领域无结果即 unknown——A 对笔记 medium(本资产 2 条 validated)、
   B 对自己候选 unknown(原 medium);③ 证据包不再声称"来源链完整",改为"相关证据汇集"并标 `production_link: unproven`(相邻记录
   的关系未验证)。重算用 `assess.mjs --recheck`,没有重新调用模型;记录 `author/artifacts/assessment-recheck-2026-09-12.json`。
   **第三轮复核后再收紧**:④ 这个等级是**资产结果概况**,不是经验证的人的能力——字段名 `competence` 保持不变(已签名摘要要兼容),
   但 Core 的闸门理由串改为 `asset-outcome profile … on this asset … a profile of results, not a verified measure of the author`
   (因此重建镜像并切换);⑤ 程序核不了自由文本的语义与适用范围,所以每条保留的声明带程序造的 `fact_sentence`,模型原话另列
   `model_statement`,输出带 `scope_note` 说明边界。
6. **主分支应用闭环接受的修复**:第一任务 → `evaluation/tasks/bridge-addr/verify.mjs`(批次四复判 14 次 0 变化,
   `REPARSE-DIFF-2026-09-11-exitline.md`);第二任务 → `collect-artifacts.mjs`(批次四 14 次记录的 95 条退出行由全 null
   变为全部可读,used 事件按代码事实不受影响,`REPARSE-DIFF-2026-09-11-exitline-collect.md`)。
7. **demo** `bash evaluation/demo.sh --plain`:7 段(第 7 段:第二任务与作者维度),`evaluation/demo-output.txt`。
8. **成本并排**(审阅 2026-09-12 ②):批次四汇总表与两份闭环 REPORT 各加一表,只用 `cost.json` 已有字段按组列均模型调用次数、墙钟、
   prompt / total / cached token;口径:这是两组运行的实际开销对比,不是闸门机制的成本模型。

## 原始记录在分支里(2026-09-12 起)

审阅发现干净克隆里没有批次四与开发闭环的任何运行目录,"每个数字可从原始记录重算"当时不成立。现已把 14 个批次四目录
(`evaluation/runner/runs/20260910T23*`)与 23 个闭环目录(`20260911T1*-devloop-*`,含作废运行)强制加入分支,每目录只排除
`capture-before.jsonl`(运行前探针残留,无脚本读取;哈希在 `evaluation/gate/artifacts/run-records-committed-2026-09-12.json`);
入库前按 `.env` 与三把用户密钥的真实值逐文件扫描,无命中(捕获里的 user-key 头本来就是 `[REDACTED]`)。批次四的重判副本不入库,
`deliver-check.sh` 发现缺失会用报告开头的同一命令重生成。**干净克隆彩排**(无密钥、无 Core、无 docker):套件全过,批次四重判副本
重生成、校准 / 汇总 / reparse 与两份闭环 REPORT 均与提交副本 diff 0。这依赖已烧毁值登记簿
`evaluation/attribution/burned-tokens.json`(`resolve-tokens.mjs` 的离线路线,只收已在提交树里的值,登记前用 `git grep` 逐个证明)。
登记簿新增的**不是新明文,而是「值 → 资产版本」的映射**:`tokens.json` 只有 sha256,光看记录并不知道某个字符串属于哪条资产的哪个版本。
它只对已烧毁(按规则必须轮换、不再使用)的值开放,且只保留已交付批次的条目,新批次前归档旧条目。规则见 `CLAUDE.md` §16;
每一步需要什么(纯离线 / 需登记簿 / 需线上栈)列在 `evaluation/REVIEW-GUIDE.md`。

## 五轮外部复核,提出的问题全部改在代码或生成器里

交付期间请了一位复核者做了五轮独立核对,共二十条意见,全部成立、全部处置,报告一律重新生成而不是手改:

| 轮次 | 查什么 | 结果 |
|---|---|---|
| 第一轮 | 批次四校准报告 | 五条:送达 ≠ 采用、正式组与累计不得合并、独立性推导不成立、复算命令要是真跑过的、威胁模型措辞过满 |
| 第二轮 | 作者评估与两份闭环报告 | 六条,其中两条是实现缺口(没有判别值时接受无关证据、能力等级跨领域统计) |
| 第三轮 | 只查"事实成立但结论多走一步" | 五条:约定被采用 ≠ 修复来自笔记、`validated` 的操作定义、结果概况 ≠ 人的能力、程序核不了自由文本语义、回流是两条流程 |
| 第四轮 | 口径写在文档里、代码不是那么算的 | 两条:一次 `needs_review` 被写成"弃权"(按 `classifyUsage` 实为**假阴性且计入分母**)、作者评估的 JSON 分了事实与推断而给人看的 Markdown 没跟上 |
| 第五轮 | 给上游提的候选(不查交付内容) | 否掉了我们自己的问题定义("任务永不消费"是错的),重新定位为响应可观测性修复,并规定复现证据的下限 |

逐条对照见 `evaluation/runner/COMPARISON-2026-09-11-reparsed.md` 的复核一节与 `evaluation/STATE.md`;
`evaluation/REVIEW-GUIDE.md` 的失败案例卡里也各留了一条。

## 顺手给上游提的两个修复(与本题目无关,独立分支,均待审核)

做题目四时实测撞到的两个产品缺陷,**已提给上游,都还在等审核**——
[#1358](https://github.com/TencentCloud/TencentDB-Agent-Memory/pull/1358) 与
[#1359](https://github.com/TencentCloud/TencentDB-Agent-Memory/pull/1359)(均 2026-09-12,base `feat/server_team`)。
两条都**不在本分支里**:各自从上游默认分支 `feat/server_team` 的 `0468a2a` 切出,单独的 worktree,
`evaluation/` 零文件混入。**两条都没有自动检查结果**:上游 `pr-ci.yml` 只在 base 为 `main` 时触发,
所以下面写的"验证"一律指本地跑的单元测试与类型检查,不是 CI 绿,更不是已合并。

**#1359 `fix(proxy): honor read-only mode in skill listing instructions`**:
`skillRuntime.allowLlmWrite` 的产品默认是 `false`,此时 skill-bridge 对写子路径回 40302/403、
工具清单也正确地不给 `skill_patch`;但 `<available_skills>` 的头部仍无条件写着"skill 有问题就用
`skill_patch` 修""结束前更新它"。**默认部署下,产品指示模型去用一个从未给过它的工具。**
修法是把那两句按同一个开关渲染(开关就在隔壁一行为另一个注入器算好),`+43/−8` 实现 + 9 个测试
(其中 3 个走真实注入路径)。归档见 `evaluation/upstream/readonly-skill-listing/`。

**#1358** 的问题如下。

`/v3/skill/extract`、`/v3/skill/conversation/add`、`/v3/skill/conversation/force-archive` 三个归档入口的成功响应
只回 `ok`/`status` + `task_id`。这句话没错——`SkillTriggerService.archive()` 在 tasks mutex 内写归档、追加
`SkillTaskEntry`、`enqueueAgent`,三件事都做了——但它和"任务会被真正抽取"的响应长得一模一样:
`skill.extraction.enabled=false` 时任务照样被接收,随后在当前配置下无法执行,响应里没有任何字段提示这一点。
修复是加一个 `extraction_enabled`,只回报配置开关(`true` 不代表 worker 就绪或抽取完成;读不到配置时是 `null`
而不是 `false`)。实现 26 行 + 6 个测试 + API 文档与两个 SDK 的类型说明。

**我们自己就是在这上面吃了亏**:闭环第一轮四次写回(提取关闭)的记录里,我们当时只能写下
"extract accepted but no new asset appeared … nothing is claimed"——那句"无法断定"正是这个字段要消除的。

复现脚本、三项证据(响应原文 / `_tasks.json` 里的任务登记 / worker 的 `standalone SkillExtractor unavailable` 重试)
与 PR 正文:`evaluation/upstream/skill-extraction-flag/`。**"候选池没有新增"没有被当作证据**——正常抽取也可能一个候选都不产出。

一个容易踩的坑记在这里:**上游的默认分支是 `feat/server_team`,不是 `main`**;`main` 是另一份不相干历史的公开分支,
根本没有 skill 这套代码(`git ls-tree origin/main` 里没有 `MemoryCore/`)。提 PR 的 base 必须选 `feat/server_team`。

## 验收命令与输出

| 命令 | 期望 | 实际输出 |
|---|---|---|
| `node --test evaluation/**/*.test.mjs`(仓库根) | 0 失败 | `evaluation/delivery/2026-09-12b/suite.txt` |
| `bash evaluation/tasks/exit-code-fix/selfcheck.sh` | 【0】起点可解释、【1】FAIL、【2】PASS、【3】0 新增失败;【4】闭环后判别值已进记录,该段失败属预期 | `evaluation/delivery/2026-09-12b/selfcheck.txt` |
| `bash evaluation/tasks/exit-line-collect/selfcheck.sh` | 同上;链接目标冻在 conditions.json | `evaluation/delivery/2026-09-12b/selfcheck-exit-line-collect.txt` |
| `bash evaluation/deliver-check.sh` | 各生成报告与提交副本 diff 0 | `evaluation/delivery/2026-09-12b/SUMMARY.md`(线上栈);干净克隆见 REVIEW-GUIDE 的表 |
| `node evaluation/runner/batch-conditions.mjs --check --conditions=…batch4-conditions.json` | 批次后按设计 FAIL 的项 | `evaluation/delivery/2026-09-12b/conditions-check.txt` |
| `bash evaluation/demo.sh --plain` | 7 段无 fixture | `evaluation/delivery/2026-09-12b/demo.txt` |

## 这些数字测的是什么,不是什么

- 批次四是 5+5 的小样本、单场景、单主体(同一人操作全部身份)、单模型;PASS 是端点请求成功率不是任务完成率;
  gate-off 四次不可判是 harness 的问题不是资产的,留在分母里。
- 开发闭环两任务各无/有笔记 2 次(第二任务有笔记 4 次),只用于演示闭环与迁移,不是性能对照;仓库内已有正确实现可参照,
  笔记的设计目的是帮助定位、不是唯一答案;本实验没有单独测量定位时间,不能说已证明缩短定位;第一任务的笔记正文列出 52/56 而任务文本只描述超时,有笔记组在该例的通过含
  "笔记披露了验收覆盖范围"成分。
- 闸门 admit 的 4 次 cross_user validated 来自两个消费者用户、两个任务实体,但全部身份由同一人操作:跨人关系与跨任务关系
  在产品记录里成立,独立性不成立。第二任务有 1 次验收判"采用"而使用判定为 needs_review(取用绑定不唯一),按规则不计。
- 采用证据来自送达事件与写入调用的关联,不依赖模型自述;模型自报的测试结果不采信。
- 作者评估影响复核优先级,不影响 admit/reject;能力等级永不推出 high;两份评估的断言核验结果都是 silent(记录不支持
  也不反驳笔记的断言)。

## 剩余缺点

- 跨运行隔离(批次四层面)尚未成立;闭环改为每次运行新建消费者,只对这些运行有效。
- 解析修正后的统计已经第二人复核(2026-09-12):五条口径问题成立并已改在生成器里(送达 ≠ 采用、
  正式组与准备/试跑不得合并、"写过记忆"推不出"本次不独立"、报告要记真实复算命令与运行名单、
  威胁模型措辞收紧),报告重新生成;正式组 20 项判定逐项未变。逐条处置见
  `evaluation/runner/COMPARISON-2026-09-11-reparsed.md` 的"第二人复核(2026-09-12)与处置"。
- 第二轮复核(2026-09-12,作者评估与两份闭环报告)六条意见亦已处置:作者评估的相关性与领域边界、证据包的链路措辞、第二任务的
  两个采用口径分列、第一任务 v1/v2 分开讲、"缩短定位"改为未经测量的设计目的。B 的那份评估已按重算结果写回线上 Core
  (2026-09-12T10:44:33Z,管理员密钥由用户执行,CLAUDE.md §14):`competence` 由 medium 改为 unknown,读回核对见
  `evaluation/author/artifacts/assessment-write-b-readback-2026-09-12.json` —— 闸门据此把复核优先级提到 high,
  admit/reject 未变,这正是"作者信号只排队、不定生死"的线上证据。
- 小样本、单场景、单主体、单模型;采纳证据覆盖率 0.95(批次四)。
- 判别值已随记录进入 git(批次四 v4、闭环笔记 v1 与 v2),再用须先轮换。
- 提取出的 skill 与 create 的 skill 默认 private;进池脚本已加 team 可见性校验,产品默认未改。
- `bridge-name` 场景仍用旧解析。
- 第二任务的五次早期运行因任务目录缺 harness 读取的文件而作废留档(`devloop-runs.json`);写入作者评估会重判并撤销
  刚置的准入,准入须放在评估之后(`LESSONS.md`)。
- 记录运行时的 Core 镜像摘要没有冻结,事后不可考(重建后拉到的上游镜像已证明不是它);从 2026-09-12 起条件清单冻结镜像摘要与
  闸门来源(`batch-conditions.mjs --freeze/--check`),线上改为自建镜像(`eval-core.sh status` 能从镜像核出是不是当前代码)。

## 已决与后续

- 闭环笔记 v2 保留 approved:闸门按规则 admit,decision 与 status 一致(`gate-observations.jsonl` 末条)。
- 留作后续,不做:跨运行记忆隔离方案、并发最后一组维持 ERROR、bridge-name 不换解析、批次五不跑。

## 线上状态(接手先看)

Core 跑的是从本分支自建的镜像 `agentmemory/memory-core:topic4-66bc9aecd719`(闸门内建、无挂载;构建提交的 MemoryCore 树 == HEAD;
`bash evaluation/eval-core.sh status` 打印 gate built into the image)。2026-09-12 切了两次:先从上游 `:latest` 切到自建镜像
(`core-image-switch-20260911T224508Z.json`),再因第三轮复核改了闸门理由串而重建切换(`core-image-switch-20260912T113253Z.json`);
两份记录都带备份与恢复命令。批次四与两个闭环任务当时跑在"同一 MemoryCore 代码的挂载 +
摘要未记的上游镜像"上(重建后拉到的上游镜像已证明不是它,`core-mount-accept-failure-20260912.log`),所以运行时镜像对那些记录
只能写"未知",对现在的线上是自建镜像的摘要。proxy 强制身份为主线消费者 `agt-5e0y4l8a7a` / 任务 `task-5e6xp4mrrw`,CodeBuddy
密钥为身份 b(记录 `evaluation/tasks/exit-code-fix/proxy-identity-restore-2.json`);Core 提取 **off**(最后一次拨回 2026-09-12T17:56Z,带 §10 记录)。**这一项曾经漂移六小时**:产品启动脚本 `start-memory-core.sh` 每次都重新生成整个挂载配置(第 55 行),11:33Z 那次切镜像因此把提取写回 on,直到 17:55Z 才被发现——我们自己在提交 c88e955 里记过这个坑,但只当成跑批次的前置、没当成切镜像后的复查项(失败案例卡里单独留了一条)。漂移范围经比对只涉及这一个开关,没有交付运行受影响(9/12 零次运行,且 `prepare.sh` 在开关不是 off 时硬失败),拨回后三条资产读回未变:`gate/artifacts/extraction-drift-20260912.json`;无 tdai-clickhouse 容器;闭环笔记 v2 approved(规则);
批次四资产 right approved / wrong failed;10 项由消费者会话提取的候选属 usr-4u07qc2kuj、private,其中 `skl-z0V6zwphUvhB` 已由所有者
提交复核并带签名评估(2026-09-12 按复核意见重算后写回:competence unknown,闸门 pending、复核优先级 high);第二任务的产品任务实体 `task-h1k7xruuhb`(用户 c 创建)。
