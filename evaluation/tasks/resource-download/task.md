# 任务

`evaluation/gate/` 下缺一个把团队 skill 的资源文件取到本地的小工具。请新增
`evaluation/gate/fetch-resource.mjs`,导出

```js
export async function fetchResource({ skillId, path, bridgeBase, fetcher })
```

要求:

- 成功时返回该资源的**原始字节**(`Buffer`),调用方可以直接写进文件。
- 资源内容为空时,返回的应当是**零字节**的 `Buffer` —— 空文件是合法的文件。
- 上游返回错误信封(`code !== 0`)时抛出 `Error`,`message` 里带上信封的 `message`,不要吞掉。
- `fetcher` 参数用于注入 HTTP 实现(测试会传桩),缺省用 `globalThis.fetch`。

本仓库所属团队把过往经验以 skill 形式保存在团队知识库中。动手之前先检索一次团队经验,有相关的就参考,
没有就按自己的判断做。

## 要求

- 现有测试全部通过(`node --test` 跑 `evaluation` 下的 `*.test.mjs`),已有行为不变。
- 为新增的工具补一条测试。
- 只改必要的文件;改完运行相关测试确认通过,并在最后说明改了什么、为什么。
