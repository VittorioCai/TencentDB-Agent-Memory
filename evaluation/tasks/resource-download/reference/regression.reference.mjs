/**
 * Reference acceptance — owned by the verifier, written into the working copy at
 * acceptance time. Identical for the with-note and no-note arms. It says nothing
 * about how the tool is written or what the model's own test is called.
 *
 * 这一份与前两个任务的参考测试有一点不同,是这次特意要的:**它判的是行为,不是标记。**
 * 前两个任务靠笔记里的判别值出现在新增测试里来证明采用;这次不靠那个 —— 下面四条全是
 * 功能断言,尤其第 4 条断言的是"请求打到了哪个子路径",那是一个设计决定,不是一个字符串。
 * 采用与否因此由**做出的选择**证明,而不是由抄没抄一个标记证明。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchResource } from "./fetch-resource.mjs";

const envelope = (data, code = 0, message = "ok") =>
  new Response(JSON.stringify({ code, message, data }), { status: 200, headers: { "content-type": "application/json" } });

/** 记录请求打到哪个子路径,并按需给出回复。 */
function stub(reply) {
  const seen = [];
  const f = async (url, init) => { seen.push(String(url)); return reply(String(url), init); };
  f.seen = seen;
  return f;
}

test("1. 非空资源:拿到的是原始字节,不是信封", async () => {
  const body = "#!/bin/sh\necho hi\n";
  const f = stub(() => envelope({ content: body, encoding: "utf-8", mime_type: "text/x-sh" }));
  const out = await fetchResource({ skillId: "skl-a", path: "scripts/run.sh", bridgeBase: "http://p/skill-bridge/v3/skill", fetcher: f });
  assert.ok(Buffer.isBuffer(out), "应当返回 Buffer");
  assert.equal(out.toString("utf-8"), body);
});

test("2. 空资源:零字节,而不是一个装着 JSON 的文件", async () => {
  const f = stub(() => envelope({ content: "", encoding: "utf-8" }));
  const out = await fetchResource({ skillId: "skl-a", path: "scripts/empty.sh", bridgeBase: "http://p/skill-bridge/v3/skill", fetcher: f });
  assert.equal(out.length, 0, `空文件应当是 0 字节,实际 ${out.length}`);
});

test("3. base64 的空资源同样是零字节", async () => {
  const f = stub(() => envelope({ content: "", encoding: "base64" }));
  const out = await fetchResource({ skillId: "skl-a", path: "bin/x", bridgeBase: "http://p/skill-bridge/v3/skill", fetcher: f });
  assert.equal(out.length, 0);
});

test("4. 请求打到 files/download —— files/read 无论加不加 -o 都只回 JSON 信封", async () => {
  const f = stub(() => envelope({ content: "x", encoding: "utf-8" }));
  await fetchResource({ skillId: "skl-a", path: "scripts/run.sh", bridgeBase: "http://p/skill-bridge/v3/skill", fetcher: f });
  assert.ok(f.seen.some((u) => /files\/download/.test(u)), `没有打到 files/download,实际请求:${f.seen.join(", ")}`);
  assert.ok(!f.seen.some((u) => /files\/read/.test(u)), `不应当走 files/read,实际请求:${f.seen.join(", ")}`);
});

test("5. 错误信封:抛错并带上 message,不吞掉", async () => {
  const f = stub(() => envelope(null, 40401, "skill not found"));
  await assert.rejects(
    () => fetchResource({ skillId: "skl-x", path: "p", bridgeBase: "http://p/skill-bridge/v3/skill", fetcher: f }),
    (e) => /skill not found/.test(String(e?.message)),
  );
});
