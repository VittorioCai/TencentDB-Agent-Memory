/**
 * 把本任务的经验笔记放进池子,并生成一个新的判别值 —— 复用第一个任务的实现,
 * 只是把任务目录指到这里(与 verify.mjs 同一种委托)。
 *
 *   node evaluation/tasks/resource-download/fill-note.mjs            # 建/更新 Core 里的笔记,填 tokens.json,查来源
 *   node evaluation/tasks/resource-download/fill-note.mjs --check    # 只读:从 Core 取回当前值并查来源
 *   node evaluation/tasks/resource-download/fill-note.mjs --dry-run  # 只读:生成一个新值,只做来源扫描
 *
 * 判别值明文只存在于 Core 里这份笔记的副本中;仓库只留 sha256(CLAUDE.md §16)。
 * 本任务的**采用判定不依赖这个值** —— 参考测试判的是行为。
 */
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
process.env.DEVLOOP_TASK_DIR = dirname(fileURLToPath(import.meta.url));
await import("../exit-code-fix/fill-note.mjs");
