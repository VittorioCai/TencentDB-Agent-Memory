/**
 * 运行环境污染检查。
 *
 * 起因(2026-09-13):resource-download 的无笔记组第一批 16 次全部作废。
 * 实施者在 `/private/tmp/scen-check/` 留下了验证用的「看了笔记的写法」参考实现,
 * 消费者有 shell,`cat` 就读到了;下一次运行又 `grep -rln` 到上一次留下的工作副本。
 * 闸门没有漏放(memory-channel reads = 0)—— 答案是从磁盘上捡的。
 *
 * 9/8 已经修过一次同类问题(每次运行一个独立父目录,`ls ..` 看不到兄弟),
 * 但 `ls ../..` 仍然列得出来,而且工作副本跑完不删。所以这里不再只堵路径:
 * **按内容找答案**——参考测试的用例标题和笔记的判别值,两者都从不交给模型。
 *
 * 三条规则,任一命中即污染:
 *   1. foreign_run        —— 上下文里出现了别的运行 id(模型编不出来)
 *   2. reference_leak     —— 参考测试的用例标题出现在上下文里(它只在验收时写入)
 *   3. token_outside_note —— 无笔记组的上下文里出现了判别值
 *
 * 纯函数在上,CLI 在下:node contamination.mjs --run=<run dir> --task=<task dir> --arm=no-note
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// a: 首版(按文本找别的运行 id)。b: 改为按**访问**判 —— 只看 tool_calls 的参数,
// 工具回显的内容不算(仓库自己的交付报告里引用着历次运行的命令行,首版因此误报 4 次)。
// c: 自查补三处 —— 不带尾斜杠地点到共享根目录也算枚举;/tmp 与 /private/tmp 同一处;
// 命令从每条请求里取并按 id 去重,不只看最长的一份对话。
export const RULES_VERSION = "contamination-2026-09-13c";
export const SHARED_ROOTS = ["/private/tmp/topic4-sessions", "/private/tmp/topic4-runs"];
// 共享根目录下被**命令**点到的路径。判访问,不判文本:仓库自己的交付文档里就写着历次运行的
// 路径(evaluation/delivery/… 引用过 20260911T185119Z),消费者在自己的副本里读到它们不是污染
// —— 2026-09-13 有笔记组两次就是这样被误报的。真正的污染是它**去访问**了别人的目录,
// 而那必须在命令里写出路径,或者把共享根目录整个列一遍。
const SHARED_PATH = /(?:\/private)?\/tmp\/topic4-(?:sessions|runs)(?:\/[^\s"'`,)\]]*)?/g;
// macOS 上 /tmp 是 /private/tmp 的符号链接,两种写法指同一处;比较前统一,并去掉尾部斜杠
const canon = (p) => p.replace(/^\/tmp\//, "/private/tmp/").replace(/\/+$/, "");

/** 参考测试的用例标题 —— 模型从没见过它们,出现即泄漏。 */
export function referenceFingerprints(source) {
  return [...source.matchAll(/\btest\(\s*"([^"]{8,})"/g)].map((m) => m[1]);
}

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/** 上下文里所有匹配 pattern 且哈希在册的判别值。 */
export function tokensIn(text, { tokenPattern, tokenSha256 = [] }) {
  if (!tokenPattern) return [];
  const re = new RegExp(tokenPattern, "g");
  const want = new Set(tokenSha256);
  return [...new Set([...text.matchAll(re)].map((m) => m[1] ?? m[0]))].filter((v) => want.has(sha256(v)));
}

/**
 * @param {object} o
 * @param {string} o.text          capture.jsonl 的全文
 * @param {string} o.runId         本次运行自己的 id
 * @param {string[]} o.fingerprints 参考测试用例标题
 * @param {boolean} o.noteExpected 本组是否本来就该看到笔记
 */
/**
 * 模型**执行过**的命令与工具参数 —— 按结构取,不在整段文本上找。
 * 工具回显的内容一概不算:仓库自己的交付报告里就引用着历次运行的命令行
 * (`evaluation/delivery/…` 里有 `cd /private/tmp/topic4-sessions/20260911T185119Z…`),
 * 消费者读到那段文字不等于它执行过 —— 2026-09-13 第一版规则正是这样误报了三次。
 */
export function commandsFromCapture(rows) {
  // 每条请求都带完整历史,所以同一次调用会出现很多遍 —— 按调用 id 去重;
  // 但不能只看最长的那份对话:子代理的对话更短,里面的命令一样是执行过的。
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const msgs = row?.body?.json?.messages;
    if (!Array.isArray(msgs)) continue;
    for (const m of msgs) {
      for (const tc of Array.isArray(m?.tool_calls) ? m.tool_calls : []) {
        const key = tc?.id ?? JSON.stringify(tc?.function ?? tc);
        if (seen.has(key)) continue;
        seen.add(key);
        let a = tc?.function?.arguments;
        if (typeof a === "string") { try { a = JSON.parse(a); } catch { out.push(a); continue; } }
        if (a && typeof a === "object") for (const k of ["command", "path", "file_path", "pattern"]) if (typeof a[k] === "string") out.push(a[k]);
      }
    }
  }
  return out;
}

/**
 * @param {string[]} o.ownPaths 本次运行自己的目录(session cwd、run dir)—— 指向它们的命令不算
 * @param {string[]} o.commands  模型执行过的命令(commandsFromCapture),不是回显的文本
 */
export function scanCapture({ text, runId, fingerprints = [], tokenPattern = null, tokenSha256 = [], noteExpected = false, ownPaths = [], commands = [] }) {
  const findings = [];
  // 自己的目录:session cwd、它的父目录、run dir 及其父目录(run.json 里都记着)。
  // 只认「命令路径落在自己目录之内」;反过来「自己目录落在命令路径之内」不算 ——
  // 那正是共享根目录,点到它就是在枚举别人的运行(首版这么写过,不带尾斜杠就漏)。
  const mine = ownPaths.filter(Boolean).map(canon);
  const foreign = new Set();
  for (const cmd of commands) {
    for (const raw of cmd.match(SHARED_PATH) ?? []) {
      if (raw.includes("...") || raw.includes("…")) continue;   // 省略写法(文档里的 `…/session`),不是真路径
      const p = canon(raw);
      if (mine.some((own) => p === own || p.startsWith(own + "/"))) continue;
      // 根目录本身被点到就是在枚举别人的运行(2026-09-13 那次 `grep -rln … /private/tmp/topic4-sessions/`)
      foreign.add(p);
    }
  }
  if (foreign.size) {
    findings.push({ rule: "foreign_run_access", detail: `命令里点到了 ${foreign.size} 个不属于本次运行的共享路径`, sample: [...foreign].slice(0, 5) });
  }
  const leaked = fingerprints.filter((f) => text.includes(f));
  if (leaked.length) {
    findings.push({ rule: "reference_leak", detail: `参考测试的 ${leaked.length} 条用例标题出现在上下文里`, sample: leaked.slice(0, 3) });
  }
  const tokens = tokensIn(text, { tokenPattern, tokenSha256 });
  if (tokens.length && !noteExpected) {
    findings.push({ rule: "token_outside_note", detail: "无笔记组的上下文里出现了判别值", sample: tokens });
  }
  return { run_id: runId, rules_version: RULES_VERSION, contaminated: findings.length > 0, findings };
}

/**
 * 开跑前扫磁盘:共享根目录下(以及调用方另外指定的目录)有没有本任务的答案。
 * 只按内容找,不按路径找 —— 污染源可以在任何地方,上一次就在 /private/tmp/scen-check。
 */
export function scanDisk({ roots = SHARED_ROOTS, extraRoots = [], needles, maxBytes = 2_000_000 }) {
  const hits = [];
  const walk = (dir, depth = 0) => {
    if (depth > 8) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { if (e.name !== ".git" && e.name !== "node_modules") walk(p, depth + 1); continue; }
      if (!e.isFile()) continue;
      let st; try { st = statSync(p); } catch { continue; }
      if (st.size > maxBytes) continue;
      let body; try { body = readFileSync(p, "utf8"); } catch { continue; }
      const found = needles.filter((n) => body.includes(n));
      if (found.length) hits.push({ path: p, matched: found.length, sample: found[0].slice(0, 60) });
    }
  };
  for (const r of [...roots, ...extraRoots]) if (existsSync(r)) walk(r);
  return { clean: hits.length === 0, hits };
}

/** 从任务目录读出扫描需要的针:参考测试标题 + 判别值(明文只在 Core,这里只能给模式与哈希)。 */
export function taskNeedles(taskDir) {
  const refDir = join(taskDir, "reference");
  let fingerprints = [];
  if (existsSync(refDir)) {
    for (const f of readdirSync(refDir)) {
      if (f.endsWith(".mjs")) fingerprints = fingerprints.concat(referenceFingerprints(readFileSync(join(refDir, f), "utf8")));
    }
  }
  let tokenPattern = null, tokenSha256 = [];
  const tokensPath = join(taskDir, "tokens.json");
  if (existsSync(tokensPath)) {
    const doc = JSON.parse(readFileSync(tokensPath, "utf8"));
    for (const [k, v] of Object.entries(doc)) {
      if (k.startsWith("_") || !v || typeof v !== "object") continue;
      tokenPattern = v.token_pattern ?? tokenPattern;
      tokenSha256 = tokenSha256.concat(v.token_sha256 ?? []);
    }
    // 退休掉的旧值同样泄露答案:一份留在磁盘上的旧笔记照样是答案(fill-note 换值时写进 _history)
    for (const h of doc._history ?? []) tokenSha256 = tokenSha256.concat(h.token_sha256 ?? []);
  }
  return { fingerprints, tokenPattern, tokenSha256 };
}

/** 清单里算样本的运行:没作废、没标成非样本。作废批次不在此列 —— 它们的判定另有记录。 */
export function sampleRunsOf(manifest) {
  return (manifest.runs ?? []).filter((r) => !r.voided && r.sample !== false);
}

/** 一批样本的总判:任何一次不是明确的「干净」(false)就不过 —— 未知与污染同样阻断。 */
export function batchVerdict(results) {
  const bad = results.filter((r) => r.contaminated !== false);
  return { ok: bad.length === 0, total: results.length, contaminated: results.filter((r) => r.contaminated === true).length,
    unknown: results.filter((r) => r.contaminated !== true && r.contaminated !== false).length, bad: bad.map((r) => r.run_id) };
}

function scanRunDir(runDir, taskDir, arm) {
  const cap = join(runDir, "capture.jsonl");
  if (!existsSync(cap) || !existsSync(join(runDir, "run.json"))) return { run_id: null, contaminated: null, findings: [], why: `没有 capture.jsonl 或 run.json:${runDir}` };
  const { fingerprints, tokenPattern, tokenSha256 } = taskNeedles(taskDir);
  const runJson = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8"));
  const ownPaths = [runJson.session?.cwd, runJson.session?.cwd ? dirname(runJson.session.cwd) : null, runDir, dirname(runDir)].filter(Boolean);
  const text = readFileSync(cap, "utf8");
  const rows = text.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return scanCapture({ text, runId: runJson.run_id, fingerprints, tokenPattern, tokenSha256, noteExpected: arm !== "no-note", ownPaths, commands: commandsFromCapture(rows) });
}

export async function main(argv) {
  const arg = (n, d = null) => (argv.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
  // 判别值那条规则只对明确的无笔记组开火:有笔记组见到判别值是正常的,
  // 组别不明(闸门实验等)时也不该按污染报——宁可漏报,不可冤枉。
  const runDir = arg("run"), taskDir = arg("task"), arm = arg("arm", "unknown");
  const { fingerprints, tokenPattern, tokenSha256 } = taskNeedles(taskDir);
  if (argv.includes("--preflight")) {
    const extra = (arg("extra-roots", "") || "").split(",").filter(Boolean);
    const needles = fingerprints;
    // 只查散落的答案,不查两个记录根目录 —— 它们本来就装着历次运行的产物,清不掉也挡不住:
    // 同一用户的 shell 面前磁盘上没有真正读不到的位置。那一半由跑完的逐次检测兜底并作废,
    // 再加上工作副本跑完即删(run-once.sh 收尾),能少留的都少留。
    const r = scanDisk({ roots: [], extraRoots: extra, needles });
    const prior = SHARED_ROOTS.map((d) => `${d}: ${existsSync(d) ? readdirSync(d).length : 0} 份`).join(",");
    if (!r.clean) {
      console.error("开跑前检查:磁盘上有本任务的答案,运行会被污染。先清掉再跑:");
      for (const h of r.hits) console.error(`  ${h.path}  (匹配 ${h.matched} 条,例:${h.sample}…)`);
      return 2;
    }
    console.log(`开跑前检查:没有散落的答案(按 ${needles.length} 条参考测试标题扫过另给的 ${extra.length} 个位置)`);
    console.log(`   历次运行记录仍在原处(${prior}),它们必然含答案,清不掉;这部分由每次跑完的污染检查负责发现并作废。`);
    return 0;
  }
  // --batch=<manifest>:对清单里所有样本重扫(记录在暂存区或已归档到 runner/runs 都行),任一不干净即失败
  const batch = arg("batch");
  if (batch) {
    const manifest = JSON.parse(readFileSync(batch, "utf8"));
    const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
    const results = sampleRunsOf(manifest).map((r) => {
      const d = r.dir && existsSync(r.dir) ? r.dir : join(repo, "evaluation/runner/runs", r.run_id);
      const res = scanRunDir(d, taskDir, r.arm);
      return { ...res, run_id: r.run_id, arm: r.arm, verdict: r.verdict };
    });
    const v = batchVerdict(results);
    for (const r of results) console.log(`${r.contaminated === false ? "干净" : r.contaminated === true ? "污染" : "未知"}  ${r.run_id}  ${r.arm}  ${r.verdict ?? "-"}${r.findings?.length ? "  " + r.findings.map((f) => f.rule).join(",") : ""}${r.why ? "  " + r.why : ""}`);
    console.log(`样本 ${v.total} 次:污染 ${v.contaminated},未知 ${v.unknown},规则 ${RULES_VERSION}${v.ok ? ";全部干净" : ";不通过:" + v.bad.join(", ")}`);
    return v.ok ? 0 : 1;
  }
  if (!existsSync(join(runDir, "capture.jsonl"))) { console.error(`没有 capture.jsonl:${join(runDir, "capture.jsonl")}`); return 2; }
  const res = scanRunDir(runDir, taskDir, arm);
  console.log(JSON.stringify(res, null, 2));
  return res.contaminated ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(await main(process.argv.slice(2)));
