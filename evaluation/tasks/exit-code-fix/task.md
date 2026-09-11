# 任务

评测验收器 `evaluation/tasks/bridge-addr/verify.mjs` 在读取 CodeBuddy 工具结果时,部分超时的调用
没有被正确识别为失败,而是被记成"不可读"。定位原因并修复。

## 要求

- 修复后现有测试全部通过(`node --test` 跑 `evaluation` 下的 `*.test.mjs`),已有行为不变。
- 为这次修复补一条回归测试。
- 只改必要的文件;改完运行相关测试确认通过,并在最后说明改了什么、为什么。
