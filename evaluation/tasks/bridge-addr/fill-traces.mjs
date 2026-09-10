/**
 * 把判别值填进 Core,仓库只留 sha256 —— 方案 2 的入池步骤(2026-09-10)。
 *
 * 资产源文件 assets/*.md 是占位符(`x-team-trace: <TRACE …>`)。这一步:
 *   1. 为每条资产生成一个全新的高熵 trace 值(只在内存里);
 *   2. 把占位符换成真值,连同其余正文一起更新到 Core(新版本);
 *   3. 把真值的 sha256 写进 tokens.json;
 *   4. 绝不把真值写进任何仓库文件,也绝不打印它。
 *
 * 每次跑生成新值。旧值一旦进过 git 历史就算烧掉了(模型能从历史读到),换新值是让
 * "来源唯一"重新成立的唯一办法。真值此后只在 Core 的资产正文里;分析用
 * resolve-tokens.mjs 以作者密钥取回。
 *
 * 用法:node evaluation/tasks/bridge-addr/fill-traces.mjs [--key=<作者密钥文件>]
 *       node evaluation/tasks/bridge-addr/fill-traces.mjs --sync   # 不生成新值,只把当前 head 的
 *                                                                  # version/content_hash 钉进 tokens.json
 * 退出:0 全部更新并校验 · 1 失败
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const CORE_URL = process.env.CORE_URL ?? "http://localhost:8420";
const SERVICE_ID = process.env.SERVICE_ID ?? "default";
const sha256 = (s) => createHash("sha256").update(String(s)).digest("hex");
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // 去掉易混字符
const freshTrace = () => "bt-" + [...randomBytes(11)].map((b) => ALPHABET[b % ALPHABET.length]).join("");
const PLACEHOLDER = /x-team-trace:.*$/m;

function key(file) {
  const p = file ?? join(DIR, "../../../deploy/global-images/.topic4-user-key");
  return readFileSync(p, "utf8").replace(/\s+/g, "");
}
async function core(path, body, k) {
  const res = await fetch(`${CORE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-tdai-service-id": SERVICE_ID, authorization: `Bearer ${k}`, "x-tdai-user-key": k },
    body: JSON.stringify(body),
  });
  return res.json().catch(() => ({ code: -1, message: "non-JSON" }));
}

const keyFile = (process.argv.find((a) => a.startsWith("--key=")) ?? "").slice(6) || undefined;
const SYNC = process.argv.includes("--sync");
const k = key(keyFile);
const manageGet = (body) => fetch(`${CORE_URL}/v3/skill/get`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-tdai-service-id": SERVICE_ID, authorization: `Bearer ${k}`, "x-tdai-user-key": k, "x-tdai-read-purpose": "manage" },
  body: JSON.stringify(body),
}).then((r) => r.json()).catch(() => ({ code: -1, message: "non-JSON" }));
const pair = JSON.parse(readFileSync(join(DIR, "pair.json"), "utf8"));
const tokensPath = join(DIR, "tokens.json");
const tokens = JSON.parse(readFileSync(tokensPath, "utf8"));
const team_id = pair.team_id;
const authorAgent = pair.author_agent_id;
const authorUser = (await core("/v3/meta/agent/get", { agent_id: authorAgent }, k))?.data?.owner_user_id;
if (!authorUser) { console.error("cannot resolve author user"); process.exit(1); }

let bad = 0;
for (const id of Object.keys(tokens).filter((x) => !x.startsWith("_"))) {
  const spec = tokens[id];
  const role = spec.role;

  if (SYNC) {
    // --sync:不生成新值。用管理读取取当前 head,校验其判别值哈希等于 tokens.json,
    // 然后把 version 与 content_hash(md5,与 Core 同算法)钉进 tokens.json。
    // 解析契约要求四元组齐全;fill 之后忘了钉版本就会让分析端读 head 而非冻结版。
    const head = await core("/v3/meta/asset/get", { asset_id: id }, k);
    const version = head?.data?.version;
    if (!version) { console.error(`${role}: cannot read head (${head?.message})`); bad++; continue; }
    const back = await manageGet({ team_id, user_id: authorUser, agent_id: authorAgent, skill_id: id, version, include_content: true });
    if (back?.code !== 0) { console.error(`${role}: manage read failed (${back?.message})`); bad++; continue; }
    const content = String(back.data?.content ?? "");
    const got = (content.match(new RegExp(spec.token_pattern ?? "x-team-trace:\\s*(bt-[a-z0-9]+)")) ?? [])[1];
    const want = (spec.token_sha256 ?? [])[0];
    if (!got || sha256(got) !== want) { console.error(`${role}: Core v${version} 的判别值哈希与 tokens.json 不一致`); bad++; continue; }
    spec.version = version;
    spec.content_hash = createHash("md5").update(content, "utf-8").digest("hex");
    console.log(`OK  ${role} ${id}  pinned v${version}  content_hash ${spec.content_hash.slice(0, 12)}…  token hash verified from Core (manage read)`);
    continue;
  }
  const file = join(DIR, "assets", `${role}.md`);
  if (!existsSync(file)) { console.error(`missing ${file}`); bad++; continue; }
  const placeholder = readFileSync(file, "utf8");
  if (!PLACEHOLDER.test(placeholder)) { console.error(`${role}: no x-team-trace line to fill`); bad++; continue; }

  const trace = freshTrace();
  const content = placeholder.replace(PLACEHOLDER, `x-team-trace: ${trace}`);

  const cur = await core("/v3/meta/asset/get", { asset_id: id }, k);
  const version = cur?.data?.version;
  if (!version) { console.error(`${role}: cannot read current version (${cur?.message})`); bad++; continue; }

  const upd = await core("/v3/skill/update", { team_id, user_id: authorUser, agent_id: authorAgent, skill_id: id, expected_version: version, content }, k);
  if (upd?.code !== 0) { console.error(`${role}: update failed (${upd?.message})`); bad++; continue; }

  spec.token_sha256 = [sha256(trace)];
  spec.token_pattern = spec.token_pattern ?? "x-team-trace:\\s*(bt-[a-z0-9]+)";
  spec.version = upd.data?.version ?? null;
  spec.content_hash = createHash("md5").update(content, "utf-8").digest("hex");
  delete spec.tokens;
  // 读回校验走**管理路径**(x-tdai-read-purpose: manage),钉住刚写入的版本:版本一升
  // 闸门就回到 candidate,模型路径读不到,但作者的管理读取不受闸门影响——所以这里能
  // 立即校验,不必等准入(2026-09-11)。
  const back = await manageGet({ team_id, user_id: authorUser, agent_id: authorAgent, skill_id: id, version: spec.version, include_content: true });
  if (back?.code === 0) {
    const got = (String(back?.data?.content ?? "").match(/x-team-trace:\s*(bt-[a-z0-9]+)/) ?? [])[1];
    const verified = got && sha256(got) === spec.token_sha256[0];
    console.log(`${verified ? "OK  " : "BAD "} ${role} ${id} → v${upd.data?.version ?? "?"}  sha256 ${spec.token_sha256[0].slice(0, 12)}…  ${verified ? "verified from Core" : "MISMATCH"}`);
    if (!verified) bad++;
  } else {
    console.error(`BAD ${role} ${id} → v${upd.data?.version ?? "?"}  写入成功但管理读取校验失败(${back?.message ?? back?.code})`); bad++;
  }
}
writeFileSync(tokensPath, JSON.stringify(tokens, null, 2) + "\n");
console.log(bad ? `\n${bad} 个资产未成功` : "\n全部填入 Core 并校验;仓库只写了 sha256");
process.exit(bad ? 1 : 0);
