#!/usr/bin/env node
/**
 * 换 token 之前先问一句:这个值**别处有没有**?
 *
 * 旧口径的 token 是部署地址(`10.244.7.19`、端口 `47318`)。它的问题不是熵不够,
 * 是**来源不唯一**——同一个串写在资产里,也写在记忆基线里、写在模型自己发出的
 * curl 命令行里,还能从部署环境直接读出来。命中一次并不说明读了资产,于是"送达"
 * 这个判断本身就没有落脚点。
 *
 * 高熵不保证来源唯一。所以候选值要逐个来源扫过去:任务说明、池内其他资产、
 * 系统提示、历史记忆基线、缓存。命中任何一处就不能用。
 *
 * 用法:
 *   node evaluation/runner/token-provenance.mjs --tokens=<tokens.json> \
 *     --task=<场景目录> [--memory=<解开的基线目录>] [--runs=<run 目录…>]
 *
 * 退出:0 全部干净 · 1 有命中或有可从环境推导的值 · 2 参数错
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

/** 资产正文里出现自己的 token 是应该的,所以 kind=self 的来源不算污染。 */
const POLLUTING = (kind) => kind !== "self";

/**
 * 被切开的写法也要算命中:SQLite FTS5 的 snippet 在标点处切分并补空格,
 * 缓存和检索结果里存的往往是切过的形态。所以按"逐字符之间允许空白"匹配。
 */
function splitTolerantRegex(token) {
  const chars = [...String(token)].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(chars.join("\\s*"), "gi");
}

export function scanSources(token, sources) {
  const re = splitTolerantRegex(token);
  const out = [];
  for (const s of sources ?? []) {
    if (!POLLUTING(s?.kind)) continue;
    const m = String(s?.text ?? "").match(re);
    if (m?.length) out.push({ name: s.name, kind: s.kind, count: m.length });
  }
  return out;
}

export function provenanceOf(token, sources) {
  const found = scanSources(token, sources);
  return { token, clean: found.length === 0, found_in: found };
}

/**
 * 能不能从部署环境读出来。这一条挡的是"高熵也救不了"的那一类:
 * 地址、端口、主机名——它们写在配置里、监听在端口上、`hostname -i` 就能拿到。
 * 太短的值同样拒绝:短串会撞上无关数字,区分度无从谈起。
 */
export function isDerivableFromDeployment(value) {
  const v = String(value ?? "").trim();
  if (v.length < 8) return true;
  if (/^\d{1,5}$/.test(v)) return true;                       // 裸端口
  if (/\b\d{1,3}(\.\d{1,3}){3}\b/.test(v)) return true;        // IPv4,含 host:port
  if (/^(localhost|[a-z0-9-]+\.(local|svc|cluster\.local))$/i.test(v)) return true;
  return false;
}

// --- 来源收集 -------------------------------------------------------------

function readTextFilesUnder(root, kind, limitBytes = 2_000_000) {
  const out = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e);
      let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) { walk(p); continue; }
      if (st.size > limitBytes) continue;
      let text = ""; try { text = readFileSync(p, "utf8"); } catch { continue; }
      out.push({ name: relative(root, p), kind, text });
    }
  };
  walk(root);
  return out;
}

/**
 * 把一次运行里能承载 token 的东西都算作来源:注入的系统提示与记忆块在捕获的
 * 首个请求里,服务侧记录在 tool-call-logs,缓存在工具结果里。
 */
export function sourcesFromRun(dir) {
  const out = [];
  const cap = join(dir, "capture.jsonl");
  if (existsSync(cap)) {
    const first = readFileSync(cap, "utf8").split("\n").find((l) => l.includes('"http.request"'));
    if (first) {
      try {
        const o = JSON.parse(first);
        const msgs = (o.body?.json ?? o.body)?.messages ?? [];
        for (const [i, m] of msgs.entries()) {
          if (!["system", "user"].includes(m?.role)) continue;
          const t = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
          out.push({ name: `${dir}#msg[${i}](${m.role})`, kind: i === 0 ? "system" : "memory", text: t });
        }
      } catch { /* 首个请求读不出来就不算来源,不假装扫过 */ }
    }
  }
  for (const f of ["tool-call-logs.jsonl", "candidate-log.jsonl"]) {
    const p = join(dir, f);
    if (existsSync(p)) out.push({ name: `${dir}/${f}`, kind: "cache", text: readFileSync(p, "utf8") });
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (k) => (args.find((a) => a.startsWith(`--${k}=`)) ?? "").slice(k.length + 3);
  const tokensPath = opt("tokens"), taskDir = opt("task"), memDir = opt("memory");
  const runDirs = args.filter((a) => !a.startsWith("--"));
  if (!tokensPath) { console.error("usage: token-provenance.mjs --tokens=<tokens.json> [--task=<dir>] [--memory=<dir>] [run dirs…]"); process.exit(2); }

  const tokens = JSON.parse(readFileSync(tokensPath, "utf8"));
  const sources = [];
  if (taskDir) {
    // 场景目录里,资产正文是 token 自己的家;其余(任务说明等)都是污染源。
    for (const f of readTextFilesUnder(taskDir, "task")) {
      sources.push({ ...f, name: `task:${f.name}`, kind: f.name.startsWith("assets/") ? "self" : "task" });
    }
  }
  if (memDir) sources.push(...readTextFilesUnder(memDir, "memory").map((f) => ({ ...f, name: `memory:${f.name}` })));
  for (const d of runDirs) sources.push(...sourcesFromRun(d));

  let bad = 0;
  console.log(`扫描来源 ${sources.length} 处(任务说明 / 其他资产 / 系统提示 / 历史记忆 / 缓存)\n`);
  for (const [assetId, spec] of Object.entries(tokens)) {
    for (const t of spec?.tokens ?? []) {
      const derivable = isDerivableFromDeployment(t);
      const v = provenanceOf(t, sources);
      const ok = v.clean && !derivable;
      if (!ok) bad += 1;
      console.log(`${ok ? "OK  " : "BAD "} ${assetId}  token=${JSON.stringify(t)}`);
      if (derivable) console.log(`       可从部署环境推导(地址 / 端口 / 过短),高熵也不能补救`);
      for (const f of v.found_in) console.log(`       已出现于 [${f.kind}] ${f.name} ×${f.count}`);
    }
  }
  console.log(`\n${bad === 0 ? "全部干净" : `${bad} 个 token 不可用`}`);
  process.exit(bad === 0 ? 0 : 1);
}
