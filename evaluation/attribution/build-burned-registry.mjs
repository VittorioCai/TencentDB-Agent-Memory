/**
 * Build the burned-value registry for the offline route of resolve-tokens.mjs.
 *
 *   node evaluation/attribution/build-burned-registry.mjs --task=<dir> [--task=<dir>…] \
 *     [--key=<author key>] [--out=<file>] [--archive=<file outside the repo>]
 *
 * A discriminative value is BURNED once its plaintext is in git history (CLAUDE.md §16: such a value must be
 * rotated before any further run). The registry lets a clean clone — no author key, no Core — recompute every
 * report from the committed records. For each asset version in a task's tokens.json (the current spec and its
 * `_history`) the value is read from Core through the resolution contract (version, content hash and sha256
 * pinned), then proved burned with `git grep` over the committed tree (files counted, never named). A value that
 * is NOT in the committed tree is refused. Plaintext is never printed.
 *
 * What the registry ADDS, stated plainly (2026-09-12 review): not new plaintext — every value in it is already in
 * the committed tree — but the **value → asset version** mapping. tokens.json carries only sha256, so a reader
 * who greps the records gets a pile of strings without knowing which asset version each belongs to; that mapping
 * exists nowhere else. It is opened only for burned values, which are retired by rule and never reused.
 *
 * Retention (CLAUDE.md §16): the registry holds the DELIVERED batch's entries only. Entries no longer referenced
 * by the tasks passed in are stale; the builder refuses to write while stale entries are present unless
 * --archive=<file> is given, which moves them to that file (keep it outside the repository) instead of letting
 * the registry accumulate into a catalogue of every historical value.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { resolveTokens, BURNED_REGISTRY, sha256Hex } from "./resolve-tokens.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** A registry entry is located by asset and version — that pair is what the registry adds. */
export const keyOf = (assetId, version) => `${assetId}@${version}`;

/**
 * Split a registry into what this delivery still references and what is stale.
 * `_meta` is not an entry: it stays on the kept side and never reaches the archive.
 * @param registry  the registry as read from disk
 * @param keep      Set of keyOf(asset, version) the current build referenced
 * @param intoArchive  an existing archive to merge the stale entries into
 * @returns { kept, stale, staleCount }
 */
export function splitStale(registry, keep, intoArchive = {}) {
  const kept = {}, stale = JSON.parse(JSON.stringify(intoArchive ?? {}));
  let staleCount = 0;
  for (const [id, entry] of Object.entries(registry ?? {})) {
    if (id === "_meta") { kept._meta = entry; continue; }
    for (const [version, rec] of Object.entries(entry?.burned ?? {})) {
      if (keep.has(keyOf(id, version))) {
        kept[id] = kept[id] ?? { burned: {} };
        kept[id].burned[version] = rec;
      } else {
        stale[id] = stale[id] ?? { burned: {} };
        stale[id].burned[version] = rec;
        staleCount += 1;
      }
    }
  }
  return { kept, stale, staleCount };
}

/** Files in the committed tree that contain the value (count only). */
function inGitFiles(value) {
  const r = spawnSync("git", ["-C", REPO, "grep", "-l", "-F", "-e", value, "HEAD", "--", "evaluation"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout.split("\n").filter(Boolean).length : 0;
}

const readJson = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback);

async function main(args) {
  const opts = (k) => args.filter((a) => a.startsWith(`--${k}=`)).map((a) => a.slice(k.length + 3));
  const taskDirs = opts("task"); const keyFile = opts("key")[0];
  const out = opts("out")[0] ?? BURNED_REGISTRY; const archive = opts("archive")[0] ?? null;
  if (!taskDirs.length) { console.error("usage: build-burned-registry.mjs --task=<dir> [--task=<dir>…] [--key=<file>] [--out=<file>] [--archive=<file>]"); return 2; }

  const outPath = resolve(REPO, out);
  const registry = readJson(outPath, {});
  const built_at = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  registry._meta = {
    what: "burned discriminative values (plaintext already in git history), for resolve-tokens.mjs' offline route",
    adds: "not new plaintext — the value → asset version mapping. tokens.json holds only sha256, so the records alone do not say which asset version a value belongs to; that mapping exists nowhere else and is opened only for burned values.",
    rule: "only a value found in the committed tree is registered; a registered value is burned and never reused (rotate before any run)",
    retention: "the delivered batch's entries only; before a new batch the stale ones are archived out with --archive=<file outside the repo>, never accumulated here (CLAUDE.md §16)",
    verify: "for each entry: sha256 of every token equals token_sha256 (frozen in the task's tokens.json); in_git_files > 0 at build time",
    built_at, built_from: taskDirs.map((d) => relative(REPO, resolve(REPO, d))), builder: "evaluation/attribution/build-burned-registry.mjs",
  };

  const keep = new Set();
  let registered = 0, refused = 0, failed = 0;
  for (const td of taskDirs) {
    const taskDir = resolve(REPO, td);
    const tokens = JSON.parse(readFileSync(join(taskDir, "tokens.json"), "utf8"));
    const pair = readJson(join(taskDir, "pair.json"), {});
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
      registry[s.id].burned[String(s.version)] = { tokens: r.tokens, token_sha256: r.tokens.map(sha256Hex), content_hash: s.content_hash ?? null, in_git_files: Math.min(...counts), retired_at: s.retired ?? null, registered_at: built_at, source_task: relative(REPO, taskDir) };
      keep.add(keyOf(s.id, s.version));
      registered += 1; console.log(`OK   ${tag}: ${r.tokens.length} value(s), each in ≥ ${Math.min(...counts)} committed file(s) → registered`);
    }
  }

  // Retention: what this delivery no longer references does not stay here.
  const archivePath = archive ? resolve(REPO, archive) : null;
  const { kept, stale, staleCount } = splitStale(registry, keep, archivePath ? readJson(archivePath, {}) : {});
  if (staleCount > 0 && !archivePath) {
    console.error(`\n${staleCount} entr(ies) are not referenced by the tasks given and would accumulate:`);
    for (const [id, e] of Object.entries(stale)) for (const v of Object.keys(e.burned)) console.error(`  ${keyOf(id, v)}`);
    console.error(`Refusing to write (CLAUDE.md §16: the registry keeps the delivered batch only).`);
    console.error(`Re-run with --archive=<file outside the repository> to move them out.`);
    return 1;
  }
  if (archivePath && staleCount > 0) {
    writeFileSync(archivePath, JSON.stringify(stale, null, 2) + "\n");
    console.log(`\n${staleCount} stale entr(ies) → ${archivePath} (archived out of the registry)`);
  }
  writeFileSync(outPath, JSON.stringify(kept, null, 2) + "\n");
  console.log(`\nregistry → ${out}: ${registered} registered, ${refused} refused (not burned), ${failed} unresolved, ${staleCount} archived`);
  return failed ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(await main(process.argv.slice(2)));
