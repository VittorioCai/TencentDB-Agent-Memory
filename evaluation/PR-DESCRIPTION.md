# 题目四:可信归因与闸门 —— 分支 `topic4-attribution-gate`

交付形式(CLAUDE.md §9):分支 + 提交号 + 验收命令及其输出 + 脚本生成的报告 + 剩余缺点与需决策事项。
最终 HEAD 见 `git log -1`;下面每一项都指向仓库里的文件,不另抄数字。评审导读:`evaluation/REVIEW-GUIDE.md`。

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
   2 次 → 结果行可信记入 → 会话经验经产品 `/v3/skill/extract` 回流(10 项候选)→ 闸门按规则 admit。
   报告 `REPORT.md`(脚本生成);清单 `devloop-runs.json`;记录 `extraction-switch.jsonl`、`gate-evaluations.jsonl`、
   `gate-observations.jsonl`、`visibility-fix.json`。
4. **开发闭环,第二任务(`evaluation/tasks/exit-line-collect/`)**:同一条笔记(轮换为 v2,正文不变只换标记)、
   另一个文件里的同类缺陷(`evaluation/attribution/collect-artifacts.mjs` 读不到真实工具结果的退出状态)、
   另一个消费者用户(c,零记录)、自己的产品任务实体(`product-task.json`)。验证器复用第一任务的(按任务目录参数化)。
   无笔记 2 次 / 有笔记 4 次(2 次绑第一任务实体、2 次绑自己的实体)+ 第一任务在 v2 上 1 次(用户 b)。闸门对 v2
   按规则 admit:cross_user validated 4、distinct_consumers 2、distinct_tasks 2(`gate-evaluations.jsonl` 末条)。
   报告 `REPORT.md`;清单 `devloop-runs.json`(含作废运行与原因、配置修正)。
5. **作者上下文评估进闭环(`evaluation/author/`)**:对作者 A 在笔记 v2 上、对消费者 B 在它自己回流出的候选上各做一次
   评估(证据包 → 模型逐条引用 → 程序核事实 → 管理员签名写入 → 闸门读),闸门理由里出现该评估并标明
   "reported, not used"(只定复核优先级)。证据包新增"作者作为消费者产生的结果"一本账(此前漏查,B 读成 unknown)。
   记录 `author/artifacts/assessment-{a,b}-exit-line.*`、`assessment-write-*.json`、`submit-b-*.json`。
6. **主分支应用闭环接受的修复**:第一任务 → `evaluation/tasks/bridge-addr/verify.mjs`(批次四复判 14 次 0 变化,
   `REPARSE-DIFF-2026-09-11-exitline.md`);第二任务 → `collect-artifacts.mjs`(批次四 14 次记录的 95 条退出行由全 null
   变为全部可读,used 事件按代码事实不受影响,`REPARSE-DIFF-2026-09-11-exitline-collect.md`)。
7. **demo** `bash evaluation/demo.sh --plain`:7 段(第 7 段:第二任务与作者维度),`evaluation/demo-output.txt`。

## 验收命令与输出

| 命令 | 期望 | 实际输出 |
|---|---|---|
| `node --test evaluation/**/*.test.mjs`(仓库根) | 0 失败 | `evaluation/delivery/2026-09-11b/suite.txt` |
| `bash evaluation/tasks/exit-code-fix/selfcheck.sh` | 【0】起点可解释、【1】FAIL、【2】PASS、【3】0 新增失败;【4】闭环后判别值已进记录,该段失败属预期 | `evaluation/delivery/2026-09-11b/selfcheck.txt` |
| `bash evaluation/tasks/exit-line-collect/selfcheck.sh` | 同上;链接目标冻在 conditions.json | `evaluation/delivery/2026-09-11b/selfcheck-exit-line-collect.txt` |
| `bash evaluation/deliver-check.sh` | 各生成报告与提交副本 diff 0 | `evaluation/delivery/2026-09-11b/SUMMARY.md` |
| `node evaluation/runner/batch-conditions.mjs --check --conditions=…batch4-conditions.json` | 批次后按设计 FAIL 的项 | `evaluation/delivery/2026-09-11b/conditions-check.txt` |
| `bash evaluation/demo.sh --plain` | 7 段无 fixture | `evaluation/delivery/2026-09-11b/demo.txt` |

## 这些数字测的是什么,不是什么

- 批次四是 5+5 的小样本、单场景、单主体(同一人操作全部身份)、单模型;PASS 是端点请求成功率不是任务完成率;
  gate-off 四次不可判是 harness 的问题不是资产的,留在分母里。
- 开发闭环两任务各无/有笔记 2 次(第二任务有笔记 4 次),只用于演示闭环与迁移,不是性能对照;仓库内已有正确实现可参照,
  笔记的作用是缩短定位而非提供唯一答案;第一任务的笔记正文列出 52/56 而任务文本只描述超时,有笔记组在该例的通过含
  "笔记披露了验收覆盖范围"成分。
- 闸门 admit 的 4 次 cross_user validated 来自两个消费者用户、两个任务实体,但全部身份由同一人操作:跨人关系与跨任务关系
  在产品记录里成立,独立性不成立。第二任务有 1 次验收判"采用"而使用判定为 needs_review(取用绑定不唯一),按规则不计。
- 采用证据来自送达事件与写入调用的关联,不依赖模型自述;模型自报的测试结果不采信。
- 作者评估影响复核优先级,不影响 admit/reject;能力等级永不推出 high;两份评估的断言核验结果都是 silent(记录不支持
  也不反驳笔记的断言)。

## 剩余缺点

- 跨运行隔离(批次四层面)尚未成立;闭环改为每次运行新建消费者,只对这些运行有效。
- 解析修正后的统计未经第二人复核。
- 小样本、单场景、单主体、单模型;采纳证据覆盖率 0.95(批次四)。
- 判别值已随记录进入 git(批次四 v4、闭环笔记 v1 与 v2),再用须先轮换。
- 提取出的 skill 与 create 的 skill 默认 private;进池脚本已加 team 可见性校验,产品默认未改。
- `bridge-name` 场景仍用旧解析。
- 第二任务的五次早期运行因任务目录缺 harness 读取的文件而作废留档(`devloop-runs.json`);写入作者评估会重判并撤销
  刚置的准入,准入须放在评估之后(`LESSONS.md`)。

## 已决与后续

- 闭环笔记 v2 保留 approved:闸门按规则 admit,decision 与 status 一致(`gate-observations.jsonl` 末条)。
- 留作后续,不做:跨运行记忆隔离方案、并发最后一组维持 ERROR、bridge-name 不换解析、批次五不跑。

## 线上状态(接手先看)

proxy 强制身份已恢复为主线消费者 `agt-5e0y4l8a7a` / 任务 `task-5e6xp4mrrw`,CodeBuddy 密钥回到身份 b
(记录 `evaluation/tasks/exit-code-fix/proxy-identity-restore-2.json`);Core 提取 off(`extraction-switch.jsonl`);
闭环笔记 v2 approved(规则);批次四资产 right approved / wrong failed;10 项由消费者会话提取的候选属 usr-4u07qc2kuj、private,
其中 `skl-z0V6zwphUvhB` 已由所有者提交复核并带签名评估;第二任务的产品任务实体 `task-h1k7xruuhb`(用户 c 创建)。
