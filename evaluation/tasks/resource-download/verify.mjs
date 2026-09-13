/**
 * 第三个任务的验收沿用第一个任务的验收器,指向本目录:task.json(起点、范围、参考测试落点)
 * 与 reference/ 从这里读,判决代码来自 ../exit-code-fix/verify.mjs。同一套 CLI、同一套退出码。
 *
 *   node verify.mjs --freeze --repo=<working copy> --out=<start.json>
 *   node verify.mjs --repo=<working copy> --start=<start.json> [--json] [--capture=F] [--diff-out=F]
 */
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
process.env.DEVLOOP_TASK_DIR = dirname(fileURLToPath(import.meta.url));
const V = await import("../exit-code-fix/verify.mjs");
if (import.meta.url === `file://${process.argv[1]}`) await V.main(process.argv.slice(2));
