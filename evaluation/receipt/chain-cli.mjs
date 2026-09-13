/**
 * 闭环展示的终端入口。默认走主链条,`--case=` 切到两个反例。
 *
 *   node evaluation/receipt/chain-cli.mjs [--run=<id>] [--expand]
 *   node evaluation/receipt/chain-cli.mjs --case=delivered_not_adopted [--expand]
 *   node evaluation/receipt/chain-cli.mjs --case=adopted_but_flagged   [--expand]
 *
 * 只读已提交的运行记录;拿不到的环节显示为「未证明」,不猜。
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildChain, renderChain } from "./chain.mjs";

const args = process.argv.slice(2);
const opt = (n, d = null) => (args.find((a) => a.startsWith(`--${n}=`)) ?? "").slice(n.length + 3) || d;
const expand = args.includes("--expand");
const kind = opt("case", "main");

/** 三条链各自的运行与说明,写死在这里是有意的:它们是被逐条核过的样本,不是随便挑的。 */
const CASES = {
  main: { run: "20260911T155035Z-devloop-note",
    origin: "笔记由批次四的运行记录与代码整理而来,不是凭空写的。",
    intro: "主链条:第一个开发任务里,笔记被采用、代码通过独立验收、结果回写产品并被闸门判定的那一次。",
    note: { path: "evaluation/tasks/exit-code-fix/assets/note.md", applies_when: "工具结果只给退出码、看不到失败详情时" } },
  delivered_not_adopted: { run: "20260910T232835Z-gate-off",
    intro: "反例一:批次四的一次 gate-off 运行,多次送达、只有一次采用 —— 用来证明系统不把送达当使用。",
    origin: "这一对资产是该场景自带的(两份只差 bridge 地址),不是从别处整理来的。",
    // 批次四用的是 bridge-addr 的一对资产,不是退出码笔记。链条里第 1、2 环必须跟着案例走,
    // 否则会替这次运行编一个它没有的来源 —— 那正是这套东西要防的错误。
    note: { path: "evaluation/tasks/bridge-addr/assets/right.md", applies_when: "需要经 skill-bridge 访问团队资产时(该场景的一对资产只差 bridge 地址)" } },
  adopted_but_flagged: { run: "20260911T185119Z-devloop-note",
    intro: "反例二:第二个任务里参考采纳成立、判定器却没产出 used 的那一次 —— 用来证明系统如实展示自己的边界。",
    origin: "与主链条同一份笔记资产的 v2。",
    // 第二任务用的是同一份笔记资产 skl-pXLc38dex6Zt 的 v2,文件仍是 exit-code-fix 下那份。
    note: { path: "evaluation/tasks/exit-code-fix/assets/note.md", applies_when: "需要从工具结果里收集退出状态行时(该资产的 v2)" } },
};

const c = CASES[kind];
if (!c) { console.error(`unknown --case=${kind};可选:${Object.keys(CASES).join(" / ")}`); process.exit(2); }

const dir = `evaluation/runner/runs/${c.run}`;
const readJson = (f) => (existsSync(join(dir, f)) ? JSON.parse(readFileSync(join(dir, f), "utf8")) : null);
const readJsonl = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);

const src = {
  events: readJsonl("events.jsonl"),
  candidateLog: readJsonl("candidate-log.jsonl"),
  verdict: readJson("verdict.json"),
  outcomes: readJson("core-outcomes.json"),
  note: c.note && existsSync(c.note.path) ? { ...c.note, origin: c.origin } : null,
  gate: null, candidates: null,
  // 第 4 环要说清改了什么:从这次运行的 final.diff 里读文件名与增删行数,不手写。
  change: (() => {
    const f = join(dir, "final.diff");
    if (!existsSync(f)) return null;
    const t = readFileSync(f, "utf8");
    const files = [...t.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1]);
    const added = t.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
    const removed = t.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
    return files.length ? { files, added, removed } : null;
  })(),
};
// 反例二的两个事实取自第二任务的报告口径(参考采纳成立 / 判定器未产出 used)
if (kind === "adopted_but_flagged") { src.reference_adopted = true; src.judged_used = false; }

console.log(c.intro);
console.log("");
console.log(renderChain(buildChain(c.run, src, { case: kind === "main" ? undefined : kind }), { expand }));
if (!expand) console.log("\n(加 --expand 展开每一环的证据文件与字段)");
