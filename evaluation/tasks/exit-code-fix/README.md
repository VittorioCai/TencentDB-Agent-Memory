# 开发闭环任务 `exit-code-fix` —— 一个真实的小 BugFix

**缺陷**(在提交 141c044 上只读复现):`evaluation/tasks/bridge-addr/verify.mjs` 的 `outcomeOfAttempt`
用 `/(?:^|\n)Exit code:\s*(\d+)/` 读退出码,而 CodeBuddy 的工具结果写的是 `Exit Code:`(批次四
记录 329 处全是大写 C,0 处小写)。退出码从来没被读到;`-s` 抑制了 stderr 的超时只剩
`Exit Code: 28`,被记成"不可读";52/56 同样。

**闭环**:历史材料(批次四记录 + 代码)→ 经验笔记入池(`fill-note.mjs`,值只在 Core)→ 人工准入
(管理员,实验准备动作)→ 无笔记 / 有笔记各跑 2–3 次(笔记 candidate 即不可见 / 准入后可见)→ 模型改
仓库副本 → 验收器独立执行 → 归因与回执 → 会话新经验回流候选池。
先无笔记后有笔记用于闭环演示,不包装成严格性能对照。

## 关于"副本里已有正确答案"(2026-09-11 审阅第 4 项)

起点副本里 `evaluation/gate0/verify-capture.mjs` 已经用 `\nExit Code: (-?\d+)` 正确读退出行(:136),
也已经通用解析 `curl: (N)` 错误行(:178);`bridge-name/verify.test.mjs` 两种拼法并存。无笔记组
`grep -ri "exit code"` 就能照抄。审阅的首选是换一个副本里无正确实现可参照的判别点(如 curl 52/56),
`git grep` 确认后发现同一文件同样给出了通用 curl 解析,这个候选也有现成答案;因此保留本缺陷、改口径:

> **仓库内已有正确实现可参照,笔记的作用是缩短定位而非提供唯一答案。**

提示清单由 `selfcheck.sh` 用 `git grep` 从起点提交生成,写在 `conditions.json` 的
`known_hints_in_tracked_files`(两类:写着 `Exit Code:` 的文件、通用解析 curl 错误行的文件),不剔除——
它们是被测代码的一部分。报告引用两组差异时必须带上这一句。

## 四条约束怎么落地

| 约束 | 机制 |
|---|---|
| 指定测试名只作归因线索 | 两组功能验收完全相同:验证器把 `reference/regression.reference.mjs` 写进**验证副本**执行 + 受控套件无新增已识别失败 + 起点的测试文件缺一个即 FAIL。笔记建议的 `bt-…` 标记只进 `attempts[].value`,给采纳判定用;换个名字的正确修复照样 PASS |
| 先复现并冻结起点 | `task.json.start_commit` = 141c044;副本用 `git archive` 导出受版本控制的文件再 `git init` 成单提交仓库——`runs/`(未受控)与本任务目录(晚于起点)都不在副本里,也看不到之后的提交。模型启动前 harness 跑 `verify.mjs --freeze` 记下副本的起始提交、树、测试清单(blob id)、测试内容 tar、套件自身结果;结束后始终与这份记录比较,不看副本当时的 HEAD |
| 验收检查模型改出的仓库 | `verify.mjs --repo=<副本> --start=<冻结记录>`:diff 对照起始提交(含未跟踪文件);把模型的树复制到验证副本,恢复起点测试的原内容,再写入参考测试执行;受控套件 = 起点测试(原内容)+ 参考测试,基线豁免绑定(文件, 测试名);模型新增的测试另跑另记,不进判决;退出码、失败计数、已解析失败项三者不一致 → ERROR 不放行;记录 diff 文件、越界改动、改动验证器目录、模型提交数、被改写的原有测试 |
| 少量运行仍需隔离 | 每次独立副本、会话目录、缓存;**每次运行一个新消费者 agent**(run-once `--fresh-consumer`),开跑前 atomic 足迹为空,结束后核对记忆通道读回的项没有早于本次开跑或来自别的 agent |

## 归因线索的取法(审阅第 3 项)

只看最终状态:模型新增的测试文件,其**文件名**和**测试标题**里的 `bt-…` 标记才是 `attempts[].value`,
并关联到实际写入该文件(且含该标记)的那次工具调用(Write / Edit / 带重定向的 shell 命令,取最后一次),
不是第一个提到标记的调用(往往是搜索);关联不上则保留标记并标 `needs_review`。diff 里删除行、上下文行、
非测试文件里的标记只列入 `checks.markers_elsewhere` 供复核,不算尝试。没加测试或测试没标记,各记一条
"none: …" 的尝试,让采纳判定读到"未采纳"而不是"未知"。

## 送达机制(冒烟观测)

proxy 在系统提示里注入 `<skill_tools>`(如何 curl `skill_search` / `skill_view`)和 `<available_skills>`;
后者对从未跑过的新 agent 是 "(none)",团队资产只在模型主动 `skill_search` 时送达。task.md 不提知识池,
冒烟里模型一次也没检索:有笔记组是否"送达",按事件如实报,不靠改任务文本补。

## 验收命令

```bash
bash evaluation/tasks/exit-code-fix/selfcheck.sh
```

期望:【0】起点冻结,套件结果可解释(3 条读未受控工件的测试失败,记为基线);【1】起点 FAIL,参考测试 7 条里 2 条失败
(超时只剩退出行、非零退出码);【2】打参考补丁后 PASS,7/7,对照冻结起点;【3】受控套件 OK,无新增已识别失败,
基线失败 3 条仍在(按文件+测试名列出);【4】笔记判别值全部 OK、零未扫描缺口;末行"验证器四段全过,可以跑模型"。
实际输出存档在 `selfcheck-output.txt`。

审阅反例(先失败后通过):`verify.counterexamples.test.mjs` 10 条,对 41d8620 的验证器全部失败
(`counterexamples-before.txt`:TAP 输出下回归被判 PASS、同名测试基线按名字豁免、模型提交后删测试仍 PASS、
改写原测试藏回归仍 PASS、删除行里的标记被计为尝试、call_id 取到搜索命令),对本版全部通过
(`counterexamples-after.txt`)。

## 文件

| 文件 | 作用 |
|---|---|
| `task.md` | 给模型的任务;只说"部分超时未被正确识别",不提退出码、不提大小写 |
| `task.json` | 起点提交/树、副本剔除项、验收范围 |
| `verify.mjs` | 仓库验收器:`--freeze` 冻结起点;`--repo --start` 判决;`--capture` 关联写入调用;`--diff-out` 存最终 diff |
| `verify.test.mjs` | 单测(夹具仓库:冻结 / 有缺陷 / 已修 / 删测试 / 越界 / 标记 / 基线 / TAP 对账) |
| `verify.counterexamples.test.mjs` | 2026-09-11 审阅的 10 条反例;`counterexamples-before.txt` / `-after.txt` 是实际输出 |
| `reference/regression.reference.mjs` | 验证器自带的参考回归测试(写进验证副本时改名为 `*.test.mjs` 执行;源文件不叫 `.test.mjs`,主仓库套件不会误跑它) |
| `reference/fix.patch` | 参考补丁,只用于 selfcheck 证明验证器有效;**不给模型** |
| `assets/note.md` | 经验笔记占位(`{{TRACE}}`);真值只在 Core |
| `fill-note.mjs` | 入池 / 更新 / 校验 / 来源唯一扫描;仓库只写 sha256 |
| `tokens.json` / `pair.json` | 判别值哈希与身份记录 |
| `conditions.json` | selfcheck 写出的冻结条件,含已知提示清单 |
| `run-arm.sh` | 按组跑:`--arm no-note\|note\|smoke --n N`;开跑前读 Core 里笔记状态并拒绝不匹配的组;每次 `run-once.sh --task … --auto --fresh-consumer`;追加 `devloop-runs.json` |
| `devloop-runs.json` | 闭环运行的正式清单(组、run_id、消费者、验收、尝试值、记忆通道);驱动日志 `.log` 不入库 |
| `asset-pool-snapshot.json` | 本实验冻结的团队池(7 项;笔记 candidate);run-once 用它做送达/漂移判断 |
| `confounders.watch` | 上下文里会泄答案的短语清单,每次运行记录是否在场 |
| `write-back.mjs` | 回流:以该次消费者身份把会话贴给产品的 `/v3/skill/extract`,记录作者、来源会话、提取任务、出现的资产与实际状态 |
| `report.mjs` | 由清单与运行记录生成 `REPORT.md`;结论句全由数据算出 |
