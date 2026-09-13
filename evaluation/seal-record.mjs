/**
 * 封版核对页 `evaluation/SEAL-CHECK.md`,由封版那次验收的 `rows.jsonl` 生成,不手写(CLAUDE.md §1、§6)。
 *
 *   node evaluation/seal-record.mjs [--rows=evaluation/delivery/SEAL-<短号>/rows.jsonl] [--out=evaluation/SEAL-CHECK.md] [--md]
 *
 * 那次验收是**从远端重新克隆封版提交**跑的(无密钥、无 Core、无 docker,重判目录全新),
 * 过程记在同目录的 `HOW.md`。这里只把它的逐步记录渲染成给评委看的一页:
 * 哪些离线就能复算、哪些必须线上、还剩什么缺点。**结论句由数据决定**,没有样本就说未知,不写死。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";

/** 需要线上栈、干净克隆上按设计不通过的步骤。 */
export const LIVE_ONLY = {
  "conditions-check": "需要 Core + 作者密钥 + docker:Core 读取、容器镜像摘要、消费者记忆各行标 unreadable",
  "selfcheck": "第【4】段核笔记正文需要 Core;判别值已烧毁,按设计失败,形态由判决器核对",
  "selfcheck-exit-line-collect": "同上:笔记 v2 的值已烧毁",
};

export function parseRows(text) {
  return String(text ?? "").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

/** @returns 统计:总步数、带 diff 的份数与其中非 0 的、离线步骤是否全过 */
export function summarise(rows) {
  const diffed = rows.filter((r) => r.diff_lines !== null && r.diff_lines !== undefined);
  const nonZero = diffed.filter((r) => r.diff_lines !== 0);
  const offline = rows.filter((r) => !(r.step in LIVE_ONLY));
  const offlineBad = offline.filter((r) => r.exit !== 0 || (r.diff_lines ?? 0) !== 0);
  return { steps: rows.length, diffed: diffed.length, diff_non_zero: nonZero.map((r) => r.step),
    offline_ok: offlineBad.length === 0, offline_bad: offlineBad.map((r) => r.step) };
}

export function render(rows, { commit, url, archive }) {
  const s = summarise(rows);
  const by = Object.fromEntries(rows.map((r) => [r.step, r]));
  const L = [];
  L.push("# 封版核对 —— 题目四交付", "");
  L.push(`本页由 \`evaluation/seal-record.mjs\` 从**一次从远端重新克隆的验收**跑出的 \`rows.jsonl\` 生成,数字不手抄;`);
  L.push(`那次验收的逐步记录与做法在 \`${archive}\`(同目录 \`HOW.md\` 写明克隆命令与环境)。`, "");
  L.push("## 交付提交", "", "| | |", "|---|---|");
  L.push(`| 提交号 | \`${commit}\` |`);
  L.push("| 分支 | `topic4-attribution-gate` |");
  L.push(`| 浏览入口 | <${url}/tree/topic4-attribution-gate> |`);
  L.push(`| 辅助材料(闸门抽取) | 分支 \`gate-core-minimal\` \`c372d80\`,固定比较区间 <${url}/compare/0468a2a...c372d80> |`, "");
  L.push("## 复算入口(评委拿到后怎么自己跑)", "", "```bash");
  L.push(`git clone --branch topic4-attribution-gate --single-branch ${url}.git`);
  L.push("cd TencentDB-Agent-Memory");
  L.push("node --test $(find evaluation -name '*.test.mjs' -not -path '*/node_modules/*' | sort)   # 纯离线");
  L.push("bash evaluation/deliver-check.sh                                                        # 全部验收,存档到 evaluation/delivery/<时间>/");
  L.push("```", "");
  L.push("导读从 `evaluation/REVIEW-GUIDE.md` 开头读起;交付说明是 `evaluation/PR-DESCRIPTION.md`;线上状态与逐轮处置在 `evaluation/STATE.md`。", "");
  L.push("## 封版那次跑出了什么", "");
  L.push(`共 ${s.steps} 步。**离线复算${s.offline_ok ? "全部通过" : "未通过:" + s.offline_bad.join("、")}**;`
    + `带 diff 的 ${s.diffed} 份${s.diff_non_zero.length ? `,其中 ${s.diff_non_zero.join("、")} 有差异` : ",**全部 0 行**"}。`, "");
  L.push("| 步骤 | 退出码 | diff | 说明 |", "|---|---:|---:|---|");
  for (const r of rows) {
    const d = r.diff_lines === null || r.diff_lines === undefined ? "—" : String(r.diff_lines);
    L.push(`| \`${r.step}\` | ${r.exit} | ${d} | ${String(r.note ?? "").replace(/\|/g, "/").slice(0, 58)} |`);
  }
  L.push("", "## 干净克隆上必然不通过的部分(线上依赖)", "");
  L.push("这些步骤按设计需要线上栈,干净克隆上**不通过是正确的**,不是缺陷:", "", "| 步骤 | 为什么 | 本次 |", "|---|---|---|");
  for (const [step, why] of Object.entries(LIVE_ONLY)) {
    L.push(`| \`${step}\` | ${why} | ${String(by[step]?.note ?? "(本次没有这一步)").replace(/\|/g, "/").slice(0, 46)}… |`);
  }
  L.push("", `\`demo\` 也会降级:无 Core 时第 1 段用夹具、第 5 段不跑(本次 ${String(by.demo?.note ?? "?")})。`);
  L.push("离线能跑到什么程度、各需要什么,逐行在 `evaluation/REVIEW-GUIDE.md` 的「干净克隆上什么能复算」一节。", "");
  L.push("## 还要人工确认的两件(实施者做不到)", "");
  L.push("- [ ] 评委能打开上面两个链接(fork 可见性)");
  L.push("- [ ] 提交渠道已收到材料", "");
  L.push("## 剩余缺点(交付时如实列出)", "");
  L.push("- **小样本、单模型**:批次四 5+5,前两个闭环任务各 2+2,第三个跑了三批,**条件不同,不合并**;");
  L.push("  逐批样本量与通过率见 `evaluation/tasks/resource-download/REPORT.md`(每次验收重算,这里不抄数)。");
  L.push("  这个量级只说方向,不说幅度,不做显著性检验。");
  L.push("- **第三任务的采用归因未闭合,原因已查清且在我们这边**:三批的有笔记运行里");
  L.push("  **一次 `used` 都没有**,判定停在 `needs_review`(前两批个别运行连事件都没有)。**卡在取回通道**:harness 自己的 system prompt 写明 skill 工具「不是本地工具,需要用 Bash 调用 curl」,");
  L.push("  消费者因此只能 curl 取回笔记,正文作为 Bash 回显进入上下文;判决器的「最早送达」规则看到判别值在被记账的那次 fetch");
  L.push("  之前已到模型手里,于是拒绝归因 —— 这条规则本身是对的,它防的正是「先拿到再假装是检索来的」。");
  L.push("  对照第一任务:那里的笔记是被**注入**上下文的(injected / recalled),判决器认这条通道,所以 3/3 判 `used`。");
  L.push("  **所以这是评测设计的缺口,不是产品缺陷** —— 要闭合得给消费者一条被记账的取回通道,那是改评测,不在本轮范围。");
  L.push("- **早先把它归给环境与替代信息源,都不是根因**:第一批曾归因于工作副本里的上游 PR 归档(第二批排掉后差异仍在);");
  L.push("  第二批之后归因于归因落点 ClickHouse 不可达(第三批恢复后每次运行都有自己的受信行,4 次还建立了内容取回)。");
  L.push("  两次都改对了真问题,但都不是拦住 `used` 的那一个。这段更正过程如实留在 `evaluation/STATE.md`。");
  L.push("- **「最小上下文」一项的证据弱于归因与闸门**:只展示了准入与任务相关性两层分开计数,没有做优化效果的对照。");
  L.push("- **跨人 = 两个用户 id,不是两个人**:全部身份由同一人操作,独立性未建立,报告里没有一处声称建立了。");
  L.push("- **一份生成报告不能在验收里重算**(`REPARSE-DIFF-2026-09-11-exitline.md`),代价与原因登记在 `evaluation/generated-reports.json`。");
  return L.join("\n") + "\n";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
  const rowsPath = arg("rows", "evaluation/delivery/SEAL-f8c1a7f/rows.jsonl");
  const rows = parseRows(readFileSync(rowsPath, "utf8"));
  const md = render(rows, {
    commit: arg("commit", "f8c1a7f99ae8e8ca9b62d90f8ca5a5e9707b44f6"),
    url: arg("url", "https://github.com/VittorioCai/TencentDB-Agent-Memory"),
    archive: dirname(rowsPath) + "/" + basename(rowsPath),
  });
  if (process.argv.includes("--md")) process.stdout.write(md);
  else { const out = arg("out", "evaluation/SEAL-CHECK.md"); writeFileSync(out, md); console.log(`${out} ← ${rows.length} 步`); }
}
