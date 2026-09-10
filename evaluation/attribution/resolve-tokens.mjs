/**
 * 把判别值的明文从 **Core 的资产正文**里取出来 —— 仓库里只有它的 sha256。
 *
 * 方案 2(2026-09-10):判别值(x-team-trace 的值)明文只存在于 Core 的资产正文里。
 * 仓库中的 tokens.json 只放 `token_sha256`,资产源文件是占位符。这样有 shell 的模型
 * 顺着进程表找到仓库,也读不到判别值——它不在磁盘的仓库树里。
 *
 * 但两件分析仍然需要明文:
 *   送达审计  要在捕获里找判别值有没有到达模型
 *   来源唯一  要证明判别值没有出现在任何模型可读的地方(反过来用明文去扫)
 *
 * 这两件在**分析时**发生,用作者密钥从 Core 取明文,验证它哈希后等于 tokens.json 里
 * 存的 sha256,然后只在内存里用,绝不写回仓库。
 *
 * 前提:资产此刻可读(approved)。若被闸门挡着(candidate/failed),读不到明文,
 * 本模块**报错而不是静默返回空**——读不到和"没有"是两回事。
 */
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

export const sha256Hex = (s) => createHash("sha256").update(String(s)).digest("hex");

const CORE_URL = process.env.CORE_URL ?? "http://localhost:8420";
const SERVICE_ID = process.env.SERVICE_ID ?? "default";

function keyFrom(file) {
  if (!existsSync(file)) throw new Error(`key file missing: ${file}`);
  const k = readFileSync(file, "utf8").replace(/\s+/g, "");
  if (!k) throw new Error(`key file empty: ${file}`);
  return k;
}

async function skillGet({ team_id, user_id, agent_id, skill_id, key }) {
  const res = await fetch(`${CORE_URL}/v3/skill/get`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-tdai-service-id": SERVICE_ID, authorization: `Bearer ${key}`, "x-tdai-user-key": key },
    body: JSON.stringify({ team_id, user_id, agent_id, skill_id, include_content: true }),
  });
  return res.json().catch(() => ({ code: -1, message: `non-JSON (${res.status})` }));
}

/**
 * 读 tokens.json(哈希形态),从 Core 取明文,按 token_pattern 抽出判别值,
 * 校验 sha256 与清单一致。
 *
 * @returns { [asset_id]: { tokens: [明文...], token_sha256: [...], verified: bool,
 *                          adoption_fields, why } }
 * 明文形态的 tokens.json(老批次)原样返回,不联网。
 */
export async function resolveTokens(taskDir, opts = {}) {
  const tokensPath = join(taskDir, "tokens.json");
  const tokens = existsSync(tokensPath) ? JSON.parse(readFileSync(tokensPath, "utf8")) : {};
  const ids = Object.keys(tokens).filter((k) => !k.startsWith("_"));
  const pair = existsSync(join(taskDir, "pair.json")) ? JSON.parse(readFileSync(join(taskDir, "pair.json"), "utf8")) : {};
  const team_id = opts.team_id ?? pair.team_id;
  const author_agent_id = opts.author_agent_id ?? pair.author_agent_id;
  const keyFile = opts.keyFile ?? "deploy/global-images/.topic4-user-key";

  const out = {};
  let key = null, author_user_id = opts.author_user_id ?? null;

  for (const id of ids) {
    const spec = tokens[id] ?? {};
    // 明文形态:老批次,直接用,不联网。
    if (Array.isArray(spec.tokens) && spec.tokens.length) {
      out[id] = { tokens: spec.tokens, token_sha256: (spec.tokens).map(sha256Hex), verified: true, adoption_fields: spec.adoption_fields ?? null, mode: "plain" };
      continue;
    }
    // 哈希形态:从 Core 取明文。
    if (!Array.isArray(spec.token_sha256) || !spec.token_sha256.length) {
      out[id] = { tokens: [], token_sha256: [], verified: false, adoption_fields: spec.adoption_fields ?? null, mode: "none", why: "既无明文也无 sha256" };
      continue;
    }
    if (!key) key = keyFrom(keyFile);
    if (!author_user_id && author_agent_id) {
      const ag = await (await fetch(`${CORE_URL}/v3/meta/agent/get`, {
        method: "POST", headers: { "content-type": "application/json", "x-tdai-service-id": SERVICE_ID, authorization: `Bearer ${key}`, "x-tdai-user-key": key },
        body: JSON.stringify({ agent_id: author_agent_id }),
      })).json().catch(() => ({}));
      author_user_id = ag?.data?.owner_user_id ?? null;
    }
    const r = await skillGet({ team_id, user_id: author_user_id, agent_id: author_agent_id, skill_id: id, key });
    if (r?.code !== 0) {
      out[id] = { tokens: [], token_sha256: spec.token_sha256, verified: false, adoption_fields: spec.adoption_fields ?? null, mode: "hash",
        why: `Core 读不到资产正文(${r?.message ?? r?.code})——可能被闸门挡着;读不到 ≠ 没有` };
      continue;
    }
    const content = r.data?.content ?? "";
    const pat = spec.token_pattern ? new RegExp(spec.token_pattern, "g") : null;
    const found = [];
    if (pat) { let m; while ((m = pat.exec(content))) found.push(m[1] ?? m[0]); }
    const plaintext = [...new Set(found)];
    const wantHashes = spec.token_sha256.map((h) => String(h).toLowerCase());
    const gotHashes = plaintext.map(sha256Hex);
    const verified = plaintext.length > 0 && wantHashes.every((h) => gotHashes.includes(h)) && gotHashes.every((h) => wantHashes.includes(h));
    out[id] = {
      tokens: plaintext, token_sha256: spec.token_sha256, verified,
      adoption_fields: spec.adoption_fields ?? null, mode: "hash",
      why: verified ? "Core 正文抽出的判别值哈希与清单一致" : `Core 正文抽出 ${plaintext.length} 个值,哈希与清单不一致`,
    };
  }
  return out;
}

/** 把解析结果整理成"明文 tokens.json"的形状,喂给 adoption / delivery-audit / provenance。 */
export function asPlainTokens(resolved) {
  const out = {};
  for (const [id, r] of Object.entries(resolved ?? {})) {
    out[id] = { tokens: r.tokens ?? [], version: undefined, adoption_fields: r.adoption_fields ?? undefined };
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const taskDir = args.find((a) => !a.startsWith("--")) ?? "evaluation/tasks/bridge-addr";
  const keyFile = (args.find((a) => a.startsWith("--key=")) ?? "").slice(6) || undefined;
  const resolved = await resolveTokens(taskDir, { keyFile });
  let bad = 0;
  for (const [id, r] of Object.entries(resolved)) {
    const ok = r.mode === "plain" ? true : r.verified;
    if (!ok) bad += 1;
    console.log(`${ok ? "OK  " : "BAD "} ${id}  mode=${r.mode}  plaintext=${r.tokens.length}  ${r.verified ? "verified" : (r.why ?? "")}`);
  }
  console.log(bad ? `\n${bad} 个资产的明文无法从 Core 验证` : "\n全部可从 Core 解析并校验");
  process.exit(bad ? 1 : 0);
}
