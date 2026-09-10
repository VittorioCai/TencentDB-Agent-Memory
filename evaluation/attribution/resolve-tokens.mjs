/**
 * 把判别值的明文从 **Core 的资产正文**里取出来 —— 仓库里只有它的 sha256。
 *
 * 方案 2(2026-09-10):判别值(x-team-trace 的值)明文只存在于 Core 的资产正文里。
 * 仓库中的 tokens.json 只放 `token_sha256`,资产源文件是占位符。有 shell 的模型顺着
 * 进程表找到仓库,也读不到判别值——它不在磁盘的仓库树里。
 *
 * 需要明文的地方——运行时的判定(judge-hard / judge-outcome / receipt)、分析时的送达
 * 审计、来源唯一性反扫——**一律经这里**取,并且按冻结的四元组钉死:
 *
 *   资产 id · 版本 · 内容哈希(md5,与 Core 的 content_hash 同算法)· token 哈希(sha256)
 *
 * 任一不符即 verified:false;要明文的调用方必须走 plainTokensOrThrow,失败**明确中止**,
 * 不静默降级(2026-09-11 审阅:读 head 不钉版本、不走管理读取、asPlainTokens 丢版本且不
 * 拒绝 verified:false,gate-on 把错资产置 failed 后分析端读不到,静默变 not_delivered)。
 *
 * 读取走**管理路径**(`x-tdai-read-purpose: manage`,作者密钥与 user_id 匹配),所以资产
 * 被闸门置为 candidate/failed 时同样读得到——闸门管的是模型路径,不是作者的管理读取。
 *
 * 用法:
 *   node evaluation/attribution/resolve-tokens.mjs [--task=DIR] [--key=FILE] [--out=FILE]
 *     --out 写出**明文形态**的 tokens.json(含 version),给运行时判定用;写到仓库外的临时
 *     目录,用完即删。退出 0 = 全部 verified;1 = 有未 verified。
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const sha256Hex = (s) => createHash("sha256").update(String(s)).digest("hex");
export const md5Hex = (s) => createHash("md5").update(String(s), "utf-8").digest("hex");

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CORE_URL = process.env.CORE_URL ?? "http://localhost:8420";
const SERVICE_ID = process.env.SERVICE_ID ?? "default";

function keyFrom(file) {
  const p = resolve(REPO, file);
  if (!existsSync(p)) throw new Error(`key file missing: ${file}`);
  const k = readFileSync(p, "utf8").replace(/\s+/g, "");
  if (!k) throw new Error(`key file empty: ${file}`);
  return k;
}

async function corePost(path, body, key, extraHeaders = {}) {
  const res = await fetch(`${CORE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-tdai-service-id": SERVICE_ID, authorization: `Bearer ${key}`, "x-tdai-user-key": key, ...extraHeaders },
    body: JSON.stringify(body),
  });
  return res.json().catch(() => ({ code: -1, message: `non-JSON (${res.status})` }));
}

/** 默认读取器:管理路径、钉版本。测试可注入替身。 */
export function coreReader(key) {
  return ({ team_id, user_id, agent_id, skill_id, version }) =>
    corePost("/v3/skill/get", { team_id, user_id, agent_id, skill_id, version, include_content: true }, key, { "x-tdai-read-purpose": "manage" });
}

/**
 * @param input  任务目录路径,或 { tokens, pair }
 * @param opts   { read, keyFile, team_id, author_agent_id, author_user_id }
 * @returns { [asset_id]: { mode, version, content_hash, tokens:[明文], token_sha256, adoption_fields,
 *                          verified, read_purpose, why } }
 */
export async function resolveTokens(input, opts = {}) {
  let tokens, pair;
  if (typeof input === "string") {
    const taskDir = resolve(REPO, input);
    tokens = existsSync(join(taskDir, "tokens.json")) ? JSON.parse(readFileSync(join(taskDir, "tokens.json"), "utf8")) : {};
    pair = existsSync(join(taskDir, "pair.json")) ? JSON.parse(readFileSync(join(taskDir, "pair.json"), "utf8")) : {};
  } else {
    tokens = input?.tokens ?? {};
    pair = input?.pair ?? {};
  }
  const ids = Object.keys(tokens).filter((k) => !k.startsWith("_"));
  const team_id = opts.team_id ?? pair.team_id;
  const author_agent_id = opts.author_agent_id ?? pair.author_agent_id;

  let key = null, read = opts.read ?? null, author_user_id = opts.author_user_id ?? null;
  const ensureReader = async () => {
    if (read) return;
    key = keyFrom(opts.keyFile ?? "deploy/global-images/.topic4-user-key");
    read = coreReader(key);
  };
  const ensureAuthorUser = async () => {
    if (author_user_id || !author_agent_id) return;
    if (!key) key = keyFrom(opts.keyFile ?? "deploy/global-images/.topic4-user-key");
    const ag = await corePost("/v3/meta/agent/get", { agent_id: author_agent_id }, key);
    author_user_id = ag?.data?.owner_user_id ?? null;
  };

  const out = {};
  for (const id of ids) {
    const spec = tokens[id] ?? {};
    const base = { adoption_fields: spec.adoption_fields ?? null, read_purpose: "manage" };

    // 明文形态(老批次):原样通过,不联网。
    if (Array.isArray(spec.tokens) && spec.tokens.length) {
      out[id] = { ...base, mode: "plain", version: spec.version ?? null, content_hash: spec.content_hash ?? null,
        tokens: spec.tokens, token_sha256: spec.tokens.map(sha256Hex), verified: true, read_purpose: null };
      continue;
    }
    if (!Array.isArray(spec.token_sha256) || !spec.token_sha256.length) {
      out[id] = { ...base, mode: "none", version: spec.version ?? null, content_hash: null, tokens: [], token_sha256: [], verified: false, why: "既无明文也无 token_sha256" };
      continue;
    }
    // 哈希形态:四元组必须齐,缺一个就不算钉住。
    const pinVersion = spec.version ?? null, pinHash = spec.content_hash ? String(spec.content_hash).toLowerCase() : null;
    if (pinVersion == null || !pinHash) {
      out[id] = { ...base, mode: "hash", version: pinVersion, content_hash: pinHash, tokens: [], token_sha256: spec.token_sha256, verified: false,
        why: "tokens.json 没有钉住 version/content_hash,无法确认 Core 里读到的是冻结的那一版" };
      continue;
    }
    await ensureReader(); await ensureAuthorUser();
    let r;
    try { r = await read({ team_id, user_id: author_user_id, agent_id: author_agent_id, skill_id: id, version: pinVersion }); }
    catch (e) { r = { code: -1, message: e.message }; }
    if (r?.code !== 0) {
      out[id] = { ...base, mode: "hash", version: pinVersion, content_hash: pinHash, tokens: [], token_sha256: spec.token_sha256, verified: false,
        why: `Core 管理读取失败(${r?.message ?? r?.code})——读不到 ≠ 没有` };
      continue;
    }
    const content = r.data?.content ?? "";
    const gotVersion = r.data?.version ?? null;
    if (gotVersion !== pinVersion) {
      out[id] = { ...base, mode: "hash", version: pinVersion, content_hash: pinHash, tokens: [], token_sha256: spec.token_sha256, verified: false,
        why: `Core 返回版本 ${gotVersion},钉住的是版本 ${pinVersion}` };
      continue;
    }
    const gotHash = md5Hex(content);
    if (gotHash !== pinHash) {
      out[id] = { ...base, mode: "hash", version: pinVersion, content_hash: pinHash, tokens: [], token_sha256: spec.token_sha256, verified: false,
        why: `正文 md5 ${gotHash.slice(0, 12)} ≠ 钉住的 content_hash ${pinHash.slice(0, 12)}` };
      continue;
    }
    const pat = spec.token_pattern ? new RegExp(spec.token_pattern, "g") : null;
    const found = [];
    if (pat) { let m; while ((m = pat.exec(content))) found.push(m[1] ?? m[0]); }
    const plaintext = [...new Set(found)];
    const want = spec.token_sha256.map((h) => String(h).toLowerCase());
    const got = plaintext.map(sha256Hex);
    const ok = plaintext.length > 0 && want.every((h) => got.includes(h)) && got.every((h) => want.includes(h));
    out[id] = { ...base, mode: "hash", version: pinVersion, content_hash: pinHash, tokens: ok ? plaintext : [], token_sha256: spec.token_sha256, verified: ok,
      why: ok ? "版本、内容哈希、token 哈希与冻结一致" : `正文抽出 ${plaintext.length} 个值,sha256 与 token_sha256 不一致` };
  }
  return out;
}

/**
 * 明文形态(给 judge-hard / judge-outcome / delivery-audit / adoption 用),**带版本**。
 * 任何一个资产未 verified 就抛:分析不能在读错版本、读错内容、读不到的情况下继续。
 */
export function plainTokensOrThrow(resolved) {
  const bad = Object.entries(resolved ?? {}).filter(([, r]) => r.verified !== true);
  if (bad.length) {
    throw new Error(`判别值未能按冻结四元组解析,分析中止:${bad.map(([id, r]) => `${id}(${r.why ?? "unverified"})`).join("; ")}`);
  }
  const out = {};
  for (const [id, r] of Object.entries(resolved)) {
    out[id] = { version: r.version ?? null, content_hash: r.content_hash ?? null, tokens: r.tokens, ...(r.adoption_fields ? { adoption_fields: r.adoption_fields } : {}) };
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (k) => (args.find((a) => a.startsWith(`--${k}=`)) ?? "").slice(k.length + 3) || undefined;
  const taskDir = opt("task") ?? args.find((a) => !a.startsWith("--")) ?? "evaluation/tasks/bridge-addr";
  const resolved = await resolveTokens(taskDir, { keyFile: opt("key") });
  let bad = 0;
  for (const [id, r] of Object.entries(resolved)) {
    if (!r.verified) bad += 1;
    console.log(`${r.verified ? "OK  " : "BAD "} ${id}  mode=${r.mode}  version=${r.version ?? "?"}  plaintext=${r.tokens.length}  ${r.why ?? ""}`);
  }
  const out = opt("out");
  if (out) {
    if (bad) { console.error(`\n${bad} 个资产未 verified,不写明文文件`); process.exit(1); }
    writeFileSync(out, JSON.stringify(plainTokensOrThrow(resolved), null, 2) + "\n");
    console.log(`\nplaintext form → ${out}(用完即删,不得进仓库)`);
  }
  console.log(bad ? `\n${bad} 个资产未能按冻结四元组解析` : "\n全部按冻结四元组解析并校验");
  process.exit(bad ? 1 : 0);
}
