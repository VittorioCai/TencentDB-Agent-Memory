/**
 * 开跑前核对这一批的冻结条件还成立(CLAUDE.md §12:新实验条件先冻结清单与基线,再跑第一次)。
 *
 *   node evaluation/tasks/resource-download/check-frozen-conditions.mjs --batch=3 [--dir=<任务目录>]
 *
 * 原来这套核对**只在第二批触发**(run-arm.sh 里写死 `if BATCH == 2`),第三批会安静跳过 ——
 * 那等于第三批没有冻结闸门。改成按批取 `batch<N>-conditions.json`:**取不到就不许跑**。
 *
 * 另加一条:冻结文件必须**已经进了 HEAD 且工作树与 HEAD 一致**。「先冻结再跑」光靠文件里
 * 自己写的 frozen_at 是证不出来的 —— 看到结果之后回头改一行,时间戳照样好看。入库才拦得住。
 * 冒烟不进样本,不走这道闸门。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

/** 这一批要求工作副本排掉的东西。第二批写在 `changed_from_batch_1.archive_excludes_added`(已冻结,不改它)。 */
export function requiredExcludes(cond) {
  return cond?.frozen?.archive_excludes_required ?? cond?.changed_from_batch_1?.archive_excludes_added ?? [];
}

/** @returns {{ok: boolean, problems: string[]}} */
export function checkConditions(cond, { task, tokens }) {
  const problems = [];
  for (const x of requiredExcludes(cond)) {
    if (!(task?.archive_excludes ?? []).includes(x)) problems.push(`archive_excludes 少了 ${x}`);
  }
  const want = cond?.frozen?.start_commit;
  if (want && task?.start_commit !== want) problems.push(`start_commit 与冻结值不符:${task?.start_commit} != ${want}`);
  const asset = cond?.frozen?.note_asset;
  if (asset?.asset_id) {
    const got = tokens?.[asset.asset_id];
    if (!got) problems.push(`tokens.json 里没有 ${asset.asset_id}`);
    else if (asset.version !== undefined && got.version !== asset.version) {
      problems.push(`笔记版本 ${got.version} != 冻结的 ${asset.version}`);
    }
  }
  return { ok: problems.length === 0, problems };
}

/** @param gitState {{tracked: boolean, dirty: boolean}} */
export function checkCommitted({ tracked, dirty }) {
  const problems = [];
  if (!tracked) problems.push("冻结文件还没提交进 HEAD —— 没入库就没法证明它是开跑前写的");
  else if (dirty) problems.push("冻结文件的工作树内容与 HEAD 不一致 —— 开跑前改过就不叫冻结了");
  return { ok: problems.length === 0, problems };
}

function gitState(path) {
  const run = (args) => { try { execFileSync("git", args, { stdio: ["ignore", "pipe", "ignore"] }); return true; } catch { return false; } };
  const tracked = run(["cat-file", "-e", `HEAD:${path}`]);
  return { tracked, dirty: tracked && !run(["diff", "--quiet", "HEAD", "--", path]) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d = null) => {
    const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
    return hit === undefined ? d : hit.slice(n.length + 3);
  };
  const dir = arg("dir", "evaluation/tasks/resource-download");
  const batch = arg("batch", "");
  const rel = `${dir}/batch${batch}-conditions.json`;
  if (!batch) { console.error("要 --batch=<批号>"); process.exit(2); }
  if (!existsSync(rel)) {
    console.error(`第 ${batch} 批还没有冻结条件文件 ${rel} —— 条件先冻结再跑第一次(CLAUDE.md §12)。一次也没跑。`);
    process.exit(2);
  }
  const read = (p) => JSON.parse(readFileSync(p, "utf8"));
  const all = [checkCommitted(gitState(rel)), checkConditions(read(rel), { task: read(`${dir}/task.json`), tokens: read(`${dir}/tokens.json`) })];
  const problems = all.flatMap((r) => r.problems);
  for (const p of problems) console.error("  冻结条件不符:", p);
  if (problems.length) process.exit(1);
  console.log(`冻结条件核对:通过(${rel} 已入库且未改动;排除清单、start_commit、笔记版本一致)`);
}
