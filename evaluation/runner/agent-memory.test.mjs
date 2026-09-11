/**
 * The memory guard / snapshot / rollback that run-once.sh sources.
 *
 * Runs the real shell functions against a temporary directory: `docker exec
 * <container> …` is replaced on PATH by a shim that runs the same command
 * locally, so what is exercised is the production code path, not a copy.
 *
 * Found in batch 4 (2026-09-10): the whole-tree snapshot was taken BEFORE the
 * MEM_EXPECT_EMPTY guard cleared the previous session's late pipeline write, so
 * the rollback put that residue back and `hash_restored` never equalled
 * `hash_before` in any formal run (all ten started empty — the guard worked —
 * but the "rolled back to the start point" checkpoint failed ten out of ten).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const LIB = fileURLToPath(new URL("./lib/agent-memory.sh", import.meta.url));
const EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"; // sha256 of nothing
const CONSUMER = "agt-consumer";
const CONSUMER_DIR = `team%3Ateam-x%7Cagent%3A${CONSUMER}`;
const OTHER_DIR = "team%3Ateam-x%7Cagent%3Aagt-other";

function sandbox({ residue = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "agent-memory-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  // `docker exec [-i] <container> cmd…` → run cmd here. Anything else is an error.
  writeFileSync(join(bin, "docker"), [
    "#!/bin/sh",
    '[ "$1" = exec ] || { echo "fake docker: unsupported: $*" >&2; exit 1; }',
    'shift; [ "$1" = -i ] && shift; shift',
    'exec "$@"',
    "",
  ].join("\n"));
  chmodSync(join(bin, "docker"), 0o755);
  const mem = join(root, "profiles");
  mkdirSync(join(mem, OTHER_DIR), { recursive: true });
  writeFileSync(join(mem, OTHER_DIR, "persona.md"), "another agent's persona\n");
  for (const rel of residue) {
    mkdirSync(join(mem, CONSUMER_DIR, rel.split("/").slice(0, -1).join("/")), { recursive: true });
    writeFileSync(join(mem, CONSUMER_DIR, rel), `late pipeline write: ${rel}\n`);
  }
  return { root, bin, mem };
}

function run(sb, script, env = {}) {
  const r = spawnSync("bash", ["-c", `source "${LIB}"\n${script}`], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${sb.bin}:${process.env.PATH}`,
      MEM_ROOT: sb.mem, MEM_AGENT: CONSUMER, MEM_EXPECT_EMPTY: "1", ISOLATE_AGENT_MEMORY: "1",
      MEM_SNAP: join(sb.root, "agent-memory-before.tar.gz"), RUN_DIR: sb.root, CORE_CONTAINER: "fake",
      ...env,
    },
  });
  const vars = Object.fromEntries(r.stdout.split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => l.split(/=(.*)/s).slice(0, 2)));
  return { ...r, vars };
}

const REPORT = `
echo MEM_HASH_BEFORE=$MEM_HASH_BEFORE; echo MEM_SCOPE_BEFORE=$MEM_SCOPE_BEFORE; echo MEM_PRE_RUN_CLEARED=$MEM_PRE_RUN_CLEARED
echo MEM_HASH_AFTER=$MEM_HASH_AFTER; echo MEM_SCOPE_AFTER=$MEM_SCOPE_AFTER
echo MEM_HASH_RESTORED=$MEM_HASH_RESTORED; echo MEM_SCOPE_RESTORED=$MEM_SCOPE_RESTORED; echo FILES_NOW=$(mem_files_scoped)`;

const SESSION_WRITE = `mkdir -p "$MEM_ROOT/${CONSUMER_DIR}/scene_blocks" && echo "written by the session" > "$MEM_ROOT/${CONSUMER_DIR}/scene_blocks/session.md"`;

test("a late pipeline write found before the run is cleared and does not come back with the rollback", (t) => {
  const sb = sandbox({ residue: ["persona.md", "scene_blocks/Team-Convention.md", ".metadata/scene_index.json", ".metadata/checkpoint.json"] });
  t.after(() => rmSync(sb.root, { recursive: true, force: true }));
  const r = run(sb, `mem_prepare; ${SESSION_WRITE}; mem_rollback; ${REPORT}`);
  assert.equal(r.status, 0, r.stderr);
  const v = r.vars;
  assert.equal(v.MEM_PRE_RUN_CLEARED, "4", "the four residue files are cleared before the run");
  assert.equal(v.MEM_SCOPE_BEFORE, EMPTY, "the run starts from the frozen empty consumer baseline");
  assert.notEqual(v.MEM_SCOPE_AFTER, EMPTY, "the session's own write is visible in hash_after");
  // The defect: the snapshot tarred the residue, so the rollback restored it.
  assert.equal(v.MEM_SCOPE_RESTORED, v.MEM_SCOPE_BEFORE, `rollback must return to the start point, not to the residue (restored ${v.MEM_SCOPE_RESTORED.slice(0, 12)} vs before ${v.MEM_SCOPE_BEFORE.slice(0, 12)})`);
  assert.equal(v.MEM_HASH_RESTORED, v.MEM_HASH_BEFORE, "whole-tree rollback returns to the start point too");
  assert.equal(v.FILES_NOW, "0", "no consumer file survives the rollback");
});

test("with nothing to clear and nothing written, every hash is the same and nothing is reported cleared", (t) => {
  const sb = sandbox();
  t.after(() => rmSync(sb.root, { recursive: true, force: true }));
  const r = run(sb, `mem_prepare; mem_rollback; ${REPORT}`);
  assert.equal(r.status, 0, r.stderr);
  const v = r.vars;
  assert.equal(v.MEM_PRE_RUN_CLEARED, "0");
  assert.equal(v.MEM_SCOPE_BEFORE, EMPTY);
  assert.equal(v.MEM_HASH_AFTER, v.MEM_HASH_BEFORE);
  assert.equal(v.MEM_HASH_RESTORED, v.MEM_HASH_BEFORE);
  assert.match(r.stdout, /agent memory unchanged by this run/);
});

test("a write during the run is rolled back, kept beside the run, and another agent's files survive", (t) => {
  const sb = sandbox();
  t.after(() => rmSync(sb.root, { recursive: true, force: true }));
  const r = run(sb, `mem_prepare; ${SESSION_WRITE}; mem_rollback; ${REPORT}`);
  assert.equal(r.status, 0, r.stderr);
  const v = r.vars;
  assert.notEqual(v.MEM_HASH_AFTER, v.MEM_HASH_BEFORE, "the write is recorded as written_during_run");
  assert.equal(v.MEM_HASH_RESTORED, v.MEM_HASH_BEFORE);
  assert.equal(v.FILES_NOW, "0");
  assert.match(r.stdout, /written during the run and has been rolled back/);
  assert.ok(existsSync(join(sb.root, "agent-memory-after.tar.gz")), "what the run wrote is kept beside the run");
  assert.equal(readFileSync(join(sb.mem, OTHER_DIR, "persona.md"), "utf8"), "another agent's persona\n");
});

test("without MEM_EXPECT_EMPTY the residue is left alone and recorded in the start hash", (t) => {
  const sb = sandbox({ residue: ["persona.md"] });
  t.after(() => rmSync(sb.root, { recursive: true, force: true }));
  const r = run(sb, `mem_prepare; mem_rollback; ${REPORT}`, { MEM_EXPECT_EMPTY: "0" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.vars.MEM_PRE_RUN_CLEARED, "0");
  assert.notEqual(r.vars.MEM_SCOPE_BEFORE, EMPTY, "a non-empty start is reported, not hidden");
  assert.equal(r.vars.MEM_SCOPE_RESTORED, r.vars.MEM_SCOPE_BEFORE);
});
