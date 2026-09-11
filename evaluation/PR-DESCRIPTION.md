# 题目四:可信归因与闸门 —— 分支 `topic4-attribution-gate`

交付形式(CLAUDE.md §9):分支 + 提交号 + 验收命令及其输出 + 脚本生成的报告 + 剩余缺点与需决策事项。
最终 HEAD 见 `git log -1`;下面每一项都指向仓库里的文件,不另抄数字。

## 做了什么

1. **归因判定与校准(批次四)**:送达、采纳、收益三件事分开命名;判定按四条边界解析每次实际请求
   (地址、trace、结果各自绑定;能从服务端日志或读回文件分离才判定,分不开记 unknown;并发发出、结果不一致
   的最后一组记 ERROR);正式样本只由 `evaluation/gate/artifacts/batch4-runs.json` 十个 run id 生成。
   报告:`evaluation/runner/COMPARISON-2026-09-11-reparsed.md`(主报告)、
   `evaluation/attribution/CALIBRATION-batch4-reparsed-2026-09-11.md`(送达一致性 14/0/5/1,0.95;使用检测
   14/0/6/0,1.0,覆盖 1)、`evaluation/attribution/REPARSE-DIFF-2026-09-11.md`(重判前后逐运行差异)。
2. **闸门在产品里**:结果行经 `/v3/meta/asset/outcome/append` 以管理员身份记入 Core(可信行要带 call id、版本、
   内容哈希),`gate/evaluate` 由 Core 按规则(`gate-rules-2026-09-08f`)判定并写 status;冻结基线
   `evaluation/gate/artifacts/gate_baseline_batch4.json`(right admit / wrong reject)。
3. **最小开发闭环(`evaluation/tasks/exit-code-fix/`)**:一个真实缺陷(工具结果退出行拼写)→ 经验笔记入池
   (值只在 Core,仓库存 sha256)→ 冻结起点的仓库副本、每次运行新建消费者 → 验证器独立验收(自带参考测试、
   受控套件跑起点测试原内容、模型自测只记不判、TAP 对账、归因取最终新增测试与写入调用)→ 无笔记 2 次 / 有笔记
   2 次 → 结果行可信记入 → 会话经验经产品 `/v3/skill/extract` 回流(10 项候选)→ 闸门按规则 admit。
   报告:`evaluation/tasks/exit-code-fix/REPORT.md`(脚本生成);清单 `devloop-runs.json`;记录
   `extraction-switch.jsonl`、`gate-evaluations.jsonl`、`gate-observations.jsonl`、`visibility-fix.json`。
4. **主分支应用闭环接受的修复**(`evaluation/tasks/bridge-addr/verify.mjs`,无笔记第 1 次的 diff,不含判别值),
   批次四按此复判 14 次 0 变化(`evaluation/attribution/REPARSE-DIFF-2026-09-11-exitline.md`)。
5. **demo** `bash evaluation/demo.sh --plain`:6 段,2 live / 4 record / 0 fixture(`evaluation/demo-output.txt`)。

## 验收命令与输出

| 命令 | 期望 | 实际输出 |
|---|---|---|
| `node --test evaluation/**/*.test.mjs` | 0 失败 | `evaluation/delivery/2026-09-11/suite.txt` |
| `bash evaluation/tasks/exit-code-fix/selfcheck.sh` | 【0】起点可解释、【1】FAIL、【2】PASS、【3】0 新增失败;【4】闭环后判别值已进记录,该段失败属预期 | `evaluation/delivery/2026-09-11/selfcheck.txt` |
| `bash evaluation/deliver-check.sh` | 各生成报告与提交副本 diff 0 | `evaluation/delivery/2026-09-11/SUMMARY.md` |
| `node evaluation/runner/batch-conditions.mjs --check --conditions=…batch4-conditions.json` | 批次后按设计 FAIL 的项(trace 已烧、足迹、文件已改、身份已切) | `evaluation/delivery/2026-09-11/conditions-check.txt` |
| `bash evaluation/demo.sh --plain` | 6 段无 fixture | `evaluation/delivery/2026-09-11/demo.txt` |

## 这些数字测的是什么,不是什么

- 批次四是 5+5 的小样本、单场景、单主体(同一人操作两个身份)、单模型;PASS 是端点请求成功率不是任务完成率;
  gate-off 四次不可判是 harness 的问题不是资产的,留在分母里。
- 开发闭环无/有笔记各 2 次,只用于演示闭环,不是性能对照;仓库内已有正确实现可参照,笔记的作用是缩短定位
  而非提供唯一答案;笔记正文列出 52/56 而任务文本只描述超时,有笔记组在该例的通过含"笔记披露了验收覆盖范围"
  成分;闸门 admit 基于 2 次 cross_user validated,但两次来自同一消费者用户、同一任务(distinct_consumers=1,distinct_tasks=1):跨人关系成立,独立性不成立。
- 采用证据来自送达事件与写入调用的关联,不依赖模型自述;模型自报的测试结果不采信(7 次判决里 1 次自测全绿
  而验收 FAIL)。

## 剩余缺点

- 跨运行隔离(批次四层面)尚未成立;闭环改为每次运行新建消费者,只对这几次有效。
- 解析修正后的统计未经第二人复核;正式样本分母已修正但需复核。
- 小样本、单场景、单主体、单模型;采纳证据覆盖率 0.95(批次四)。
- 判别值已随记录进入 git(批次四 v4 与闭环笔记 v1),再用须先轮换。
- 提取出的 skill 与 create 的 skill 默认 private;进池脚本已加 team 可见性校验,产品默认未改。
- `bridge-name` 场景仍用旧解析。

## 已决与后续(2026-09-11 晚)

- 闭环笔记保留 approved:闸门按规则 admit,decision 与 status 一致;admit 基于 2 次 cross_user validated,但两次来自
  同一消费者用户、同一任务(distinct_consumers=1,distinct_tasks=1)——跨人关系成立,独立性不成立,单主体条件下的已知限制。
- 留作后续,不做:跨运行记忆隔离方案(局限;要点:每次新 agent + 反证验证 + 查借入的 chat_memory)、并发最后一组维持
  ERROR、bridge-name 不换解析。批次五不跑(4 次不可判源于 gate-off 下两条冲突约定并存,换 trace 会复现)。

## 线上状态(接手先看)

proxy 强制身份已恢复为主线消费者 `agt-5e0y4l8a7a`(记录 `evaluation/tasks/exit-code-fix/proxy-identity-restore.json`);
Core 提取 off(`extraction-switch.jsonl`);闭环笔记 approved;批次四资产 right approved / wrong failed;
10 项由消费者会话提取的候选属 usr-4u07qc2kuj、private。
