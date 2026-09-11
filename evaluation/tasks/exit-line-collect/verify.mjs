/**
 * The exit-line-collect task's acceptance is the exit-code-fix verifier,
 * unchanged, pointed at this directory: task.json (start commit, scope,
 * where the reference test goes) and reference/ are read from here, the
 * judging code from ../exit-code-fix/verify.mjs. Same CLI, same exit codes.
 *
 *   node verify.mjs --freeze --repo=<working copy> --out=<start.json>
 *   node verify.mjs --repo=<working copy> --start=<start.json> [--json] [--capture=F] [--diff-out=F]
 */
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
process.env.DEVLOOP_TASK_DIR = dirname(fileURLToPath(import.meta.url));
const V = await import("../exit-code-fix/verify.mjs");
if (import.meta.url === `file://${process.argv[1]}`) await V.main(process.argv.slice(2));
