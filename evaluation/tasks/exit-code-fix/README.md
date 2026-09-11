# 开发闭环任务 `exit-code-fix` —— 一个真实的小 BugFix

**缺陷**(在提交 141c044 上只读复现):`evaluation/tasks/bridge-addr/verify.mjs` 的 `outcomeOfAttempt`
用 `/(?:^|\n)Exit code:\s*(\d+)/` 读退出码,而 CodeBuddy 的工具结果写的是 `Exit Code:`(批次四
记录 329 处全是大写 C,0 处小写)。退出码从来没被读到;`-s` 抑制了 stderr 的超时只剩
`Exit Code: 28`,被记成"不可读";52/56 同样。

**闭环**:历史材料(批次四记录 + 代码)→ 经验笔记入池(`fill-note.mjs`,值只在 Core)→ 人工准入
(管理员,实验准备动作)→ 有笔记 / 无笔记各跑 2–3 次(闸门 reset / 笔记置 candidate)→ 模型改
仓库副本 → 验收器独立执行 → 归因与回执 → 会话新经验回流候选池。

## 四条约束怎么落地

| 约束 | 机制 |
|---|---|
| 指定测试名只作归因线索 | 两组功能验收完全相同:验证器把 `reference/regression.test.mjs` 写进副本执行 + 全套通过 + 无测试文件被删。笔记建议的 `bt-…` 标记只进 `attempts[].value`,给采纳判定用 |
| 先复现并冻结起点 | `task.json.start_commit` = 141c044;副本用 `git archive` 导出受版本控制的文件再 `git init` 成单提交仓库——`runs/`(未受控)与本任务目录(晚于起点)都不在副本里,也看不到之后的提交。`selfcheck.sh` 证明剔除后任务仍可完成 |
| 验收检查模型改出的仓库 | `verify.mjs --repo=<副本>`:自己写参考测试再跑;跑全套;起点存在的测试文件缺一个即 FAIL;记录 diff 文件、越界改动、改动验证器目录 |
| 少量运行仍需隔离 | 每次独立副本、会话目录、缓存;消费者用未跑过会话的新 agent(pair.json 的 consumer 开跑前填) |

已知提示(不剔除,它们是被测代码的一部分):起点里已有 5 个受控文件写着 `Exit Code:`
(`gate0/verify-capture.mjs` 用 `\nExit Code: (-?\d+)` 正确读取;其余是测试夹具)。见 `conditions.json`。

## 验收命令

```bash
bash evaluation/tasks/exit-code-fix/selfcheck.sh
```

期望:【1】起点 FAIL,参考测试 7 条里 2 条失败(超时只剩退出行、非零退出码);【2】打参考补丁后 PASS,7/7;【3】全套通过,
计数;【4】笔记判别值全部 OK、零未扫描缺口;末行"验证器四段全过,可以跑模型"。

## 文件

| 文件 | 作用 |
|---|---|
| `task.md` | 给模型的任务;只说"部分超时未被正确识别",不提退出码、不提大小写 |
| `task.json` | 起点提交/树、副本剔除项、验收范围 |
| `verify.mjs` / `verify.test.mjs` | 仓库验收器与其单测(夹具仓库:有缺陷 / 已修 / 删测试 / 越界 / 标记) |
| `reference/regression.reference.mjs` | 验证器自带的参考回归测试(写进副本时改名为 `*.test.mjs` 执行;源文件不叫 `.test.mjs`,主仓库套件不会误跑它) |
| `reference/fix.patch` | 参考补丁,只用于 selfcheck 证明验证器有效;**不给模型** |
| `assets/note.md` | 经验笔记占位(`{{TRACE}}`);真值只在 Core |
| `fill-note.mjs` | 入池 / 更新 / 校验 / 来源唯一扫描;仓库只写 sha256 |
| `tokens.json` / `pair.json` | 判别值哈希与身份记录 |
| `conditions.json` | selfcheck 写出的冻结条件 |
