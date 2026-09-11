/**
 * Build the burned-value registry for the offline route of resolve-tokens.mjs.
 *
 *   node evaluation/attribution/build-burned-registry.mjs --task=<dir> [--task=<dir>…] [--key=<author key>] [--out=<file>]
 *
 * A discriminative value is BURNED once its plaintext is in git history (CLAUDE.md rule: such a value is
 * rotated before any further run). The registry lists only burned values, so it exposes nothing new; it lets a
 * clean clone — no author key, no Core — recompute every report from the committed records. For each asset
 * version in a task's tokens.json (the current spec and its `_history`) the value is read from Core through the
 * resolution contract (version, content hash and sha256 pinned), then proved burned with `git grep` over the
 * committed tree (files listed by count, never by content). A value that is NOT in the committed tree is refused
 * and reported. Plaintext is never printed. Default output: evaluation/attribution/burned-tokens.json.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { resolveTokens, BURNED_REGISTRY, sha256Hex } from "./resolve-tokens.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const opts = (k) => args.filter((a) => a.startsWith(`--${k}=`)).map((a) => a.slice(k.length + 3));
const taskDirs = opts("task"); const keyFile = opts("key")[0]; const out = opts("out")[0] ?? BURNED_REGISTRY;
if (!taskDirs.length) { console.error("usage: build-burned-registry.mjs --task=<dir> [--task=<dir>…] [--key=<file>] [--out=<file>]"); process.exit(2); }

/** Files in the committed tree that contain the value (count only). */
function inGitFiles(value) {
  const r = spawnSync("git", ["-C", REPO, "grep", "-l", "-F", "-e", value, "HEAD", "--", "evaluation"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout.split("\n").filter(Boolean).length : 0;
}

const registry = existsSync(resolve(REPO, out)) ? JSON.parse(readFileSync(resolve(REPO, out), "utf8")) : {};
registry._meta = {
  what: "burned discriminative values (plaintext already in git history), for resolve-tokens.mjs' offline route",
  rule: "only a value found in the committed tree is registered; a registered value is burned and never reused (rotate before any run)",
  verify: "for each entry: sha256 of every token equals token_sha256 (frozen in the task's tokens.json); in_git_files > 0 at build time",
  built_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"), built_from: taskDirs.map((d) => relative(REPO, resolve(REPO, d))), builder: "evaluation/attribution/build-burned-registry.mjs",
};
let registered = 0, refused = 0, failed = 0;
for (const td of taskDirs) {
  const taskDir = resolve(REPO, td);
  const tokens = JSON.parse(readFileSync(join(taskDir, "tokens.json"), "utf8"));
  const pair = existsSync(join(taskDir, "pair.json")) ? JSON.parse(readFileSync(join(taskDir, "pair.json"), "utf8")) : {};
  const specs = [];
  for (const [id, spec] of Object.entries(tokens)) {
    if (id.startsWith("_") || !spec || typeof spec !== "object") continue;
    specs.push({ id, version: spec.version, content_hash: spec.content_hash, token_sha256: spec.token_sha256, token_pattern: spec.token_pattern, adoption_fields: spec.adoption_fields ?? null });
  }
  for (const h of tokens._history ?? []) {
    const cur = tokens[h.asset_id] ?? {};
    specs.push({ id: h.asset_id, version: h.version, content_hash: h.content_hash, token_sha256: h.token_sha256, token_pattern: h.token_pattern ?? cur.token_pattern, adoption_fields: cur.adoption_fields ?? null, retired: h.retired_at ?? null });
  }
  for (const s of specs) {
    const r = (await resolveTokens({ tokens: { [s.id]: s }, pair }, { keyFile }))[s.id];
    const tag = `${relative(REPO, taskDir)} ${s.id} v${s.version}`;
    if (!r?.verified) { failed += 1; console.log(`FAIL ${tag}: ${r?.why ?? "unresolved"}`); continue; }
    const counts = r.tokens.map(inGitFiles);
    if (counts.some((c) => c === 0)) { refused += 1; console.log(`SKIP ${tag}: ${counts.filter((c) => c === 0).length} of ${r.tokens.length} value(s) not in the committed tree — NOT burned, not registered`); continue; }
    registry[s.id] = registry[s.id] ?? { burned: {} };
    registry[s.id].burned[String(s.version)] = { tokens: r.tokens, token_sha256: r.tokens.map(sha256Hex), content_hash: s.content_hash ?? null, in_git_files: Math.min(...counts), retired_at: s.retired ?? null, registered_at: registry._meta.built_at, source_task: relative(REPO, taskDir) };
    registered += 1; console.log(`OK   ${tag}: ${r.tokens.length} value(s), each in ≥ ${Math.min(...counts)} committed file(s) → registered`);
  }
}
writeFileSync(resolve(REPO, out), JSON.stringify(registry, null, 2) + "\n");
console.log(`\nregistry → ${out}: ${registered} registered, ${refused} refused (not burned), ${failed} unresolved`);
process.exit(failed ? 1 : 0);
