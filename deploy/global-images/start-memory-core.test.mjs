import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("admin key path log is safe under macOS Bash 3.2 with nounset", async () => {
  const script = await readFile(new URL("./start-memory-core.sh", import.meta.url), "utf8");
  const logLine = script
    .split("\n")
    .find((line) => line.includes("初始化 admin user"));

  assert.ok(logLine, "admin initialization log line must exist");

  const result = spawnSync(
    "/bin/bash",
    [
      "-c",
      [
        "set -u",
        "info() { :; }",
        "MEMORY_CORE_ADMIN_USERNAME=admin",
        "ADMIN_KEY_FILE=/tmp/.admin-key",
        logLine,
      ].join("\n"),
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
});

test("deployment scripts brace variables adjacent to non-ASCII punctuation", async () => {
  const directory = new URL("./", import.meta.url);
  const names = (await readdir(directory)).filter((name) => name.endsWith(".sh"));
  const violations = [];

  for (const name of names) {
    const source = await readFile(new URL(name, directory), "utf8");
    source.split("\n").forEach((line, index) => {
      if (/\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7F]/.test(line)) {
        violations.push(`${name}:${index + 1}: ${line.trim()}`);
      }
    });
  }

  assert.deepEqual(violations, []);
});
