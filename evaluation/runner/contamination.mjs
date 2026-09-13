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
import { join } from "node:path";

export const SHARED_ROOTS = ["/private/tmp/topic4-sessions", "/private/tmp/topic4-runs"];
const RUN_REF = /topic4-(?:sessions|runs)\/(\d{8}T\d{6}Z-[A-Za-z0-9-]+)/g;

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
export function scanCapture({ text, runId, fingerprints = [], tokenPattern = null, tokenSha256 = [], noteExpected = false }) {
  const findings = [];
  const foreign = [...new Set([...text.matchAll(RUN_REF)].map((m) => m[1]))].filter((id) => id !== runId);
  if (foreign.length) {
    findings.push({ rule: "foreign_run", detail: `上下文里出现了 ${foreign.length} 个别的运行 id`, sample: foreign.slice(0, 5) });
  }
  const leaked = fingerprints.filter((f) => text.includes(f));
  if (leaked.length) {
    findings.push({ rule: "reference_leak", detail: `参考测试的 ${leaked.length} 条用例标题出现在上下文里`, sample: leaked.slice(0, 3) });
  }
  const tokens = tokensIn(text, { tokenPattern, tokenSha256 });
  if (tokens.length && !noteExpected) {
    findings.push({ rule: "token_outside_note", detail: "无笔记组的上下文里出现了判别值", sample: tokens });
  }
  return { run_id: runId, contaminated: findings.length > 0, findings };
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
  const cap = join(runDir, "capture.jsonl");
  if (!existsSync(cap)) { console.error(`没有 capture.jsonl:${cap}`); return 2; }
  const runId = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8")).run_id;
  const res = scanCapture({ text: readFileSync(cap, "utf8"), runId, fingerprints, tokenPattern, tokenSha256, noteExpected: arm !== "no-note" });
  console.log(JSON.stringify(res, null, 2));
  return res.contaminated ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(await main(process.argv.slice(2)));
