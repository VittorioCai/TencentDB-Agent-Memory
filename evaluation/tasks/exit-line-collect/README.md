# 开发闭环第二任务 `exit-line-collect`:同一条笔记,另一个文件

第一任务(`../exit-code-fix/`)证明了闭环能闭合;这个任务只回答一个问题:**同一条经验笔记
(`eval-tool-result-exit-line`,正文写的是 `bridge-addr/verify.mjs`)在另一个文件的同类缺陷上
会不会被用到。** 闸门里对应的量是 `distinct_tasks` 与 `distinct_consumers`——第一任务闭合时两者都是 1。

## 与第一任务相同的部分

- 起点提交相同(141c044,树 631aa855);副本用 `git archive` 导出,笔记所在的两个任务目录和 `runs/` 都不在副本里,
  所以两个任务的副本一字不差。
- 验证器相同:本目录的 `verify.mjs` 只设置任务目录后导入 `../exit-code-fix/verify.mjs`(判据版本同一个),
  task.json 决定起点、修复范围与参考测试落点。
- 任务文本的第二段(团队经验以 skill 保存,动手前先检索一次)与第一任务逐字相同;第一段只描述症状。
- 每次运行新建消费者(`run-once.sh --fresh-consumer`),默认在身份 c 下——一个没有任何记录的用户。
- 笔记的家仍是 `../exit-code-fix/`(`tokens.json`、`fill-note.mjs`、`gate-*.mjs`);本任务不新增资产。
  判别值在第一任务闭合时已进 git 历史(REPORT.md、devloop-runs.json),按规则视为烧毁,跑本任务前已轮换为 v2
  (`tokens.json._history` 记 v1 的哈希与退役原因)。新版本不继承准入:v2 从 candidate 起,证据从零计。

## 不同的部分

| 项 | exit-code-fix | exit-line-collect |
|---|---|---|
| 缺陷所在 | `evaluation/tasks/bridge-addr/verify.mjs` `outcomeOfAttempt` | `evaluation/attribution/collect-artifacts.mjs` `outcomeOf`(每次运行的归因链都经过它) |
| 参考测试 | 超时 / 52 / 56 / 小写仍可读 | 退出码按 CodeBuddy 拼写可读、0 不是 null、小写仍可读、stderr 不变 |
| 修复范围 | `evaluation/tasks/bridge-addr/`、provenance 两文件 | `evaluation/attribution/` |
| 消费者用户 | b(`usr-4u07qc2kuj`) | c(`usr-8ypylzex49`,零记录) |

## 命令

```bash
bash evaluation/tasks/exit-line-collect/selfcheck.sh          # 验证器四段 + conditions.json;输出存 selfcheck-output.txt
bash evaluation/tasks/exit-line-collect/run-arm.sh --arm smoke --n 1       # 试跑(不计样本;§13)
bash evaluation/tasks/exit-line-collect/run-arm.sh --arm no-note --n 2     # 笔记 candidate 时
bash evaluation/tasks/exit-line-collect/run-arm.sh --arm note --n 2        # 笔记 approved+team 时(管理员准入,实验干预)
node evaluation/tasks/exit-line-collect/report.mjs                          # → REPORT.md(脚本生成)
```

## 这些数字测的是什么,不是什么

无笔记 / 有笔记各 2 次只用于演示笔记能否迁移到另一个文件,不是性能对照。副本里已有正确实现可参照
(`evaluation/gate0/verify-capture.mjs` 按真实拼写读退出行),笔记的作用是缩短定位而非提供唯一答案。
笔记正文点名的是另一个文件,模型把它用到这里才算迁移;没用到记 needs_review 或"未采用",照实报。
两个消费者用户、两个任务仍由同一个人操作;`distinct_consumers=2`、`distinct_tasks=2` 说明的是闸门读到的关系,
不是两个独立的人。
