---
name: eval-skill-resource-download
description: 从 skill-bridge 把资源文件取到本地时,选哪个子路径、空文件怎么处理
---

# 取回 skill 资源文件:两个会咬人的地方

**适用条件**:需要把团队 skill 里的资源文件(脚本、模板等)**按原始字节**保存到本地时。
只想把内容读进上下文的,不适用 —— 那种情况用 `files/read` 就对了。

## 一、`files/read` 永远返回 JSON 信封,加不加 `curl -o` 都一样

注入给模型的工具说明写着:对 `files/read` 的 curl 末尾加 `-o <本地路径>`,proxy 就会返回原始字节。
**这句话不成立。** `-o` 是 curl 的客户端参数,服务端看不见它;bridge 是按**子路径**分流的。

真正返回原始字节的是另一个子路径 **`files/download`**,而工具说明里从没提过它。
照说明做,存到磁盘的是一个装着 JSON 的文件 —— 当脚本执行会直接失败。

实测(同一个 18 字节的脚本):`files/read` 回 110 字节 JSON 信封,`files/download` 回那 18 字节。

## 二、合法的空文件会被当成错误

download 分支用 `!parsed.data?.content` 判失败,而空字符串是 falsy。
于是一个**真实存在、内容为空**的资源,返回的不是 0 字节文件,而是整个信封(实测 90 字节)。
Core 侧两种编码都接受零字节资源(`skillResourcePayloadSchema` 的 `content: z.string()`,没有 `.min(1)`),
所以这是正常形态,不是构造出来的边角。

**写取回工具时**:空内容要当成合法内容走解码,只有「字段缺失 / 类型不对」才算异常;
异常时把信封原样交出去,不要吞掉它的 message。

## 判别值

<!-- 占位:真实判别值只存在于 Core 里这份笔记的副本中,由 fill-note.mjs 写入;
     仓库只保留它的 sha256(tokens.json)。CLAUDE.md §16。 -->
`{{TRACE}}`(本条经验的追踪值;引用本笔记的实现或测试里带上它,便于归因)

## 出处

2026-09-13 实测 MemoryProxy 的 skill-bridge,并已按这两条向上游提了修复
(TencentCloud/TencentDB-Agent-Memory#1361,**当时尚未合并**)。
这里写的是**当前产品的真实行为**,不是"产品的正确用法"。
