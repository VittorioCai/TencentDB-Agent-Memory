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

export function readTextFilesUnder(root, kind, limitBytes = 2_000_000) {
  const files = [], skipped = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = readdirSync(dir); } catch (err) { skipped.push({ name: relative(root, dir), why: `目录读不到:${err.code ?? err.message}`, bytes: null }); return; }
    for (const e of entries) {
      const p = join(dir, e);
      let st; try { st = statSync(p); } catch (err) { skipped.push({ name: relative(root, p), why: `stat 失败:${err.code ?? err.message}`, bytes: null }); continue; }
      if (st.isDirectory()) { walk(p); continue; }
      // 跳过要记下来。"太大所以没查"和"查了没有"必须是两个结果,否则
      // 一个 2MB 的记忆文件里写着答案,报告照样会说全部干净。
      if (st.size > limitBytes) { skipped.push({ name: relative(root, p), why: `超过扫描上限 ${limitBytes} 字节`, bytes: st.size }); continue; }
      let text; try { text = readFileSync(p, "utf8"); } catch (err) { skipped.push({ name: relative(root, p), why: `读取失败:${err.code ?? err.message}`, bytes: st.size }); continue; }
      files.push({ name: relative(root, p), kind, text });
    }
  };
  walk(root);
  return { files, skipped };
}

/**
 * 把一次运行里能承载 token 的东西都算作来源:注入的系统提示与记忆块在捕获的
 * 首个请求里,服务侧记录在 tool-call-logs,缓存在工具结果里。
 */
export function sourcesFromRun(dir) {
  const sources = [], problems = [];
  const cap = join(dir, "capture.jsonl");
  if (existsSync(cap)) {
    // 坏行不阻断后面的:逐条试,第一条能解析的请求才算数。原来只试第一条,
    // 解析失败就 `catch {}` 吞掉,于是"读不出来"和"里面没有"都是 0 处来源。
    const candidates = readFileSync(cap, "utf8").split("\n").filter((l) => l.includes('"http.request"'));
    let parsed = null, lastErr = null;
    for (const line of candidates) {
      try { parsed = JSON.parse(line); break; } catch (err) { lastErr = err; }
    }
    if (parsed) {
      const msgs = (parsed.body?.json ?? parsed.body)?.messages ?? [];
      for (const [i, m] of msgs.entries()) {
        if (!["system", "user"].includes(m?.role)) continue;
        const t = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
        sources.push({ name: `${dir}#msg[${i}](${m.role})`, kind: i === 0 ? "system" : "memory", text: t });
      }
    } else {
      problems.push({
        where: cap,
        why: candidates.length
          ? `${candidates.length} 条 http.request 行都解析不出来(${lastErr?.message ?? "未知"})——注入的系统提示与记忆块没有被扫过`
          : "捕获里没有任何 http.request 行——注入的系统提示与记忆块没有被扫过",
      });
    }
  }
  for (const f of ["tool-call-logs.jsonl", "candidate-log.jsonl"]) {
    const p = join(dir, f);
    if (!existsSync(p)) continue;
    try { sources.push({ name: `${dir}/${f}`, kind: "cache", text: readFileSync(p, "utf8") }); }
    catch (err) { problems.push({ where: p, why: `读取失败:${err.code ?? err.message}` }); }
  }
  return { sources, problems };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (k) => (args.find((a) => a.startsWith(`--${k}=`)) ?? "").slice(k.length + 3);
  const tokensPath = opt("tokens"), taskDir = opt("task"), memDir = opt("memory");
  const runDirs = args.filter((a) => !a.startsWith("--"));
  if (!tokensPath) { console.error("usage: token-provenance.mjs --tokens=<tokens.json> [--task=<dir>] [--memory=<dir>] [run dirs…]"); process.exit(2); }

  const tokens = JSON.parse(readFileSync(tokensPath, "utf8"));
  const sources = [], gaps = [];
  if (taskDir) {
    // 场景目录里,资产正文是 token 自己的家;其余(任务说明等)都是污染源。
    const r = readTextFilesUnder(taskDir, "task");
    for (const f of r.files) sources.push({ ...f, name: `task:${f.name}`, kind: f.name.startsWith("assets/") ? "self" : "task" });
    gaps.push(...r.skipped.map((x) => ({ where: `task:${x.name}`, why: x.why })));
  }
  if (memDir) {
    const r = readTextFilesUnder(memDir, "memory");
    sources.push(...r.files.map((f) => ({ ...f, name: `memory:${f.name}` })));
    gaps.push(...r.skipped.map((x) => ({ where: `memory:${x.name}`, why: x.why })));
  }
  for (const d of runDirs) {
    const r = sourcesFromRun(d);
    sources.push(...r.sources);
    gaps.push(...r.problems);
  }

  let bad = 0;
  console.log(`扫描来源 ${sources.length} 处(任务说明 / 其他资产 / 系统提示 / 历史记忆 / 缓存)\n`);
  for (const [assetId, spec] of Object.entries(tokens)) {
    for (const t of spec?.tokens ?? []) {
      const derivable = isDerivableFromDeployment(t);
      const v = provenanceOf(t, sources);
      const ok = v.clean && !derivable;
      if (!ok) bad += 1;
      // 有没扫到的地方时,"没命中"只是"在查过的地方没命中"。标 OK 会把未知读成通过。
      const mark = !ok ? "BAD " : gaps.length ? "未知" : "OK  ";
      console.log(`${mark} ${assetId}  token=${JSON.stringify(t)}`);
      if (ok && gaps.length) console.log(`       已查的来源里没有出现;但有 ${gaps.length} 处没查到,不能判定为干净`);
      if (derivable) console.log(`       可从部署环境推导(地址 / 端口 / 过短),高熵也不能补救`);
      for (const f of v.found_in) console.log(`       已出现于 [${f.kind}] ${f.name} ×${f.count}`);
    }
  }
  if (gaps.length) {
    console.log(`\n没扫到的地方 ${gaps.length} 处 —— 这些位置**没有被查过**,不能读作没有命中:`);
    for (const g of gaps.slice(0, 12)) console.log(`     ${g.where}:${g.why}`);
    if (gaps.length > 12) console.log(`     …另有 ${gaps.length - 12} 处`);
  }
  // 有没扫到的地方就不能说"全部干净"——那正是本项目反复出错的那一步。
  const clean = bad === 0 && gaps.length === 0;
  console.log(`\n${bad ? `${bad} 个 token 不可用` : gaps.length ? `已查的来源里没有命中,但有 ${gaps.length} 处没查到,结论是未知` : "全部干净"}`);
  process.exit(clean ? 0 : 1);
}
