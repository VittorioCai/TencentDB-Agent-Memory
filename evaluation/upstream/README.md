# 上游贡献(与题目四交付分支相互独立)

做题目四时实测撞到的产品缺陷,按独立分支提给上游。**两条都不在 `topic4-attribution-gate` 里**,
各自从上游默认分支 `feat/server_team` 的 `0468a2a` 切出,`evaluation/` 零文件混入。

| PR | 内容 | 规模 | 状态 |
|---|---|---|---|
| [#1358](https://github.com/TencentCloud/TencentDB-Agent-Memory/pull/1358) | 三个归档入口的成功响应回报 `extraction_enabled`,让调用方分得清"已受理、正在抽取"和"已受理、当前配置下抽不了" | +212/−5,5 文件 | **已提交上游,待审核** |
| [#1359](https://github.com/TencentCloud/TencentDB-Agent-Memory/pull/1359) | 只读模式(产品默认)下不再指示模型去修改 Skill | +146/−8,3 文件 | **已提交上游,待审核** |

**两条都没有任何自动检查结果**:上游 `pr-ci.yml` 的触发条件是 `pull_request: branches: [main]`,
而两条 PR 的 base 都是 `feat/server_team`,四个 job 一个都不会跑。各自 README 里写的"通过"
一律只指本地验证(单元测试、`tsc` 前后错误数对比、按真实 base 跑的 skill 队列隔离守卫),
**不能读成 CI 绿,更不能读成已合并**。

两条讲的是同一件事的两面:**产品对自己的模型说了做不到的话**。
#1358 是"承诺了会抽取,实际不会,而且不说";#1359 是"指示去改,实际不给工具,调用回 403"。

各自的问题定义、复现证据、查重结论与剩余缺点见子目录:
- [`skill-extraction-flag/`](skill-extraction-flag/) —— 含线上实跑的三段工件与复现脚本
- [`readonly-skill-listing/`](readonly-skill-listing/)

## 发现了但**没有**提交的

- **一条已复现的产品缺陷按对方 CONTRIBUTING 的安全条款不走公开渠道**,用户决定不走私下邮件,
  故止步于记录;**细节不入库**(交付分支是公开仓库,写进文档等于换个渠道公开披露)。见 `LESSONS.md`。
- **另三条已复现的 proxy 缺陷**(下载配方指向 JSON 接口、合法空文件被当异常、成功下载缺埋点):
  质量够但上游 PR 队列饱和(946 个 PR、534 个开着、合并率 8.1%),排在交付验收之后,暂未动手。
