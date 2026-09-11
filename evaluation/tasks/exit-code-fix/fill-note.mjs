/**
 * Put the experience note into the pool with a fresh discriminative value;
 * the repository keeps only its sha256 (方案 2, as bridge-addr/fill-traces.mjs).
 *
 *   node evaluation/tasks/exit-code-fix/fill-note.mjs            # create or update the note in Core, fill tokens.json, check provenance
 *   node evaluation/tasks/exit-code-fix/fill-note.mjs --check    # no write: resolve the current value from Core and check provenance
 *   node evaluation/tasks/exit-code-fix/fill-note.mjs --dry-run  # no write: a fresh value, provenance scan only (proves the scan, not the pool)
 *
 * The value is a test-file / test-title marker (`bt-…`) the note tells the
 * model to use. It is an attribution clue only: the functional acceptance
 * never looks at it (see verify.mjs). The value exists nowhere but in Core's
 * copy of the note; `assets/note.md` here is a placeholder.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, existsSync, statSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(DIR, "../../..");
const CORE_URL = process.env.CORE_URL ?? "http://localhost:8420";
const SERVICE_ID = process.env.SERVICE_ID ?? "default";
const sha256 = (s) => createHash("sha256").update(String(s)).digest("hex");
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const fresh = () => "bt-" + [...randomBytes(11)].map((b) => ALPHABET[b % ALPHABET.length]).join("");
const args = process.argv.slice(2);
const MODE = args.includes("--check") ? "check" : args.includes("--dry-run") ? "dry-run" : args.includes("--fix-visibility") ? "fix-visibility" : "fill";
const keyFile = (args.find((a) => a.startsWith("--key=")) ?? "").slice(6) || join(REPO, "deploy/global-images/.topic4-user-key");
const k = readFileSync(keyFile, "utf8").replace(/\s+/g, "");

const core = (path, body, extra = {}) => fetch(`${CORE_URL}${path}`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-tdai-service-id": SERVICE_ID, authorization: `Bearer ${k}`, "x-tdai-user-key": k, ...extra },
  body: JSON.stringify(body),
}).then((r) => r.json()).catch(() => ({ code: -1, message: "non-JSON" }));
const manageGet = (body) => core("/v3/skill/get", body, { "x-tdai-read-purpose": "manage" });
const assetGet = (id) => core("/v3/meta/asset/get", { asset_id: id });
/**
 * Team visibility, set by the owner (the author key). `/v3/skill/create` leaves a
 * new skill `private`, and the bridge's search excludes other people's private
 * skills — measured 2026-09-11: two note-arm runs with the note approved but
 * private, relevant queries returned the four team assets and never the note.
 * Returns {before, after, ok}; writes nothing when already team.
 */
async function ensureTeamVisibility(id) {
  const before = (await assetGet(id))?.data?.visibility ?? null;
  if (before === "team") return { before, after: before, ok: true, changed: false };
  const upd = await core("/v3/meta/asset/update", { asset_id: id, visibility: "team" });
  const after = (await assetGet(id))?.data?.visibility ?? null;
  return { before, after, ok: upd?.code === 0 && after === "team", changed: true, message: upd?.message ?? null };
}

const pair = JSON.parse(readFileSync(join(DIR, "pair.json"), "utf8"));
const tokensPath = join(DIR, "tokens.json");
const tokens = JSON.parse(readFileSync(tokensPath, "utf8"));
const placeholder = readFileSync(join(DIR, "assets/note.md"), "utf8");
const NAME = /^name:\s*(.+)$/m.exec(placeholder)[1].trim();
if (!placeholder.includes("{{TRACE}}")) { console.error("assets/note.md has no {{TRACE}} placeholder"); process.exit(1); }

/** Provenance of one plaintext value across the sources the model could have reached; the value is written only to a temp file that is deleted. */
function provenance(assetId, value) {
  const tmp = mkdtempSync(join(tmpdir(), "note-prov-"));
  try {
    writeFileSync(join(tmp, "plain.json"), JSON.stringify({ [assetId]: { tokens: [value] } }));
    // run directories only: the driver logs beside them (batch2-off-1.log …) are files, not runs
    const runsRoot = join(REPO, "evaluation/runner/runs");
    const runs = existsSync(runsRoot) ? readdirSync(runsRoot).map((d) => join(runsRoot, d)).filter((d) => statSync(d).isDirectory()) : [];
    const r = spawnSync("node", [join(REPO, "evaluation/runner/token-provenance.mjs"), `--tokens=${join(tmp, "plain.json")}`, `--task=${DIR}`, ...runs], { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    let exit = r.status, out = (r.stdout ?? "") + (r.stderr ?? "");
    // another task directory that hands the same note to a session (exit-line-collect) is scanned the same way
    for (const extra of (process.env.NOTE_EXTRA_TASK_DIRS ?? "").split(":").filter(Boolean)) {
      const e = spawnSync("node", [join(REPO, "evaluation/runner/token-provenance.mjs"), `--tokens=${join(tmp, "plain.json")}`, `--task=${resolve(extra)}`], { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      out += `\n[extra task dir ${extra}]\n` + (e.stdout ?? "") + (e.stderr ?? "");
      exit = Math.max(exit ?? 1, e.status ?? 1);
    }
    return { exit, out };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

const team_id = pair.team_id;
const authorAgent = pair.author_agent_id;
const authorUser = (await core("/v3/meta/agent/get", { agent_id: authorAgent }))?.data?.owner_user_id;
if (!authorUser) { console.error("cannot resolve the author's user id from Core"); process.exit(1); }

if (MODE === "dry-run") {
  const v = fresh();
  const p = provenance("(dry-run)", v);
  console.log(p.out.replace(v, "bt-<dry-run value>"));
  process.exit(p.exit ?? 1);
}

let id = Object.keys(tokens).find((x) => !x.startsWith("_")) ?? null;
if (MODE === "fix-visibility") {
  if (!id) { console.error("tokens.json is empty: no note to fix"); process.exit(1); }
  const beforeRec = (await assetGet(id))?.data ?? {};
  const r = await ensureTeamVisibility(id);
  const afterRec = (await assetGet(id))?.data ?? {};
  const rec = { asset_id: id, at: new Date().toISOString().replace(/\.\d+Z$/, "Z"), by: { agent_id: authorAgent, user_id: authorUser, role: "owner (author key)" },
    before: { visibility: beforeRec.visibility, status: beforeRec.status, version: beforeRec.version, content_hash: beforeRec.content_hash, updated_at: beforeRec.updated_at },
    after: { visibility: afterRec.visibility, status: afterRec.status, version: afterRec.version, content_hash: afterRec.content_hash, updated_at: afterRec.updated_at },
    changed: r.changed, ok: r.ok, message: r.message ?? null,
    command: "node evaluation/tasks/exit-code-fix/fill-note.mjs --fix-visibility",
    restore: `POST /v3/meta/asset/update {"asset_id":"${id}","visibility":"${beforeRec.visibility}"} with the owner key`,
    why: "the bridge's search excludes other people's private skills; the note must be team-visible to be deliverable at all" };
  writeFileSync(join(DIR, "visibility-fix.json"), JSON.stringify(rec, null, 2) + "\n");
  console.log(`${r.ok ? "OK  " : "BAD "} ${id} visibility ${rec.before.visibility} → ${rec.after.visibility} (status ${rec.after.status}, v${rec.after.version}, content hash ${String(rec.after.content_hash).slice(0, 12)} unchanged=${rec.before.content_hash === rec.after.content_hash}); record → visibility-fix.json`);
  process.exit(r.ok ? 0 : 1);
}
if (MODE === "check") {
  if (!id) { console.error("tokens.json is empty: nothing to check (run without --check first)"); process.exit(1); }
  const spec = tokens[id];
  const back = await manageGet({ team_id, user_id: authorUser, agent_id: authorAgent, skill_id: id, version: spec.version, include_content: true });
  if (back?.code !== 0) { console.error(`cannot read the note back from Core (${back?.message})`); process.exit(1); }
  const content = String(back.data?.content ?? "");
  const got = [...content.matchAll(/bt-[a-z0-9]+/g)].map((m) => m[0]);
  const uniq = [...new Set(got)];
  const verified = uniq.length === 1 && sha256(uniq[0]) === spec.token_sha256[0] && createHash("md5").update(content, "utf-8").digest("hex") === spec.content_hash;
  console.log(`${verified ? "OK  " : "BAD "} ${NAME} ${id} v${spec.version}  sha256 ${spec.token_sha256[0].slice(0, 12)}…  ${verified ? "value, version and content hash verified from Core (manage read)" : "MISMATCH"}`);
  if (!verified) process.exit(1);
  const asset = (await assetGet(id))?.data ?? {};
  console.log(`${asset.visibility === "team" ? "OK  " : "BAD "} ${id} visibility=${asset.visibility ?? "?"} status=${asset.status ?? "?"}  ${asset.visibility === "team" ? "team-visible: the bridge's search can return it to a consumer" : "NOT team-visible: the bridge's search excludes it for other users (run --fix-visibility)"}`);
  if (asset.visibility !== "team") process.exit(1);
  const p = provenance(id, uniq[0]);
  console.log(p.out.split("\n").map((l) => l.replace(uniq[0], "bt-<value>")).join("\n"));
  process.exit(p.exit ?? 1);
}

// fill: create the note if the pool does not have it, else update it with a fresh value
const value = fresh();
const content = placeholder.split("{{TRACE}}").join(value);
let version = null;
if (!id) {
  const created = await core("/v3/skill/create", { team_id, user_id: authorUser, agent_id: authorAgent, task_id: pair.task_id, name: NAME, content });
  if (created?.code !== 0) { console.error(`create failed: ${created?.message}`); process.exit(1); }
  id = created.data?.skill_id; version = created.data?.version ?? 1;
  console.log(`created ${NAME} → ${id} v${version} (status candidate: admission is the admin's step)`);
} else {
  const cur = await core("/v3/meta/asset/get", { asset_id: id });
  const expected = cur?.data?.version;
  if (!expected) { console.error(`cannot read current version of ${id} (${cur?.message})`); process.exit(1); }
  const upd = await core("/v3/skill/update", { team_id, user_id: authorUser, agent_id: authorAgent, skill_id: id, expected_version: expected, content });
  if (upd?.code !== 0) { console.error(`update failed: ${upd?.message}`); process.exit(1); }
  version = upd.data?.version;
  console.log(`updated ${NAME} ${id} → v${version} (a new version does not inherit admission)`);
}
const vis = await ensureTeamVisibility(id);
console.log(`${vis.ok ? "OK  " : "BAD "} ${id} visibility ${vis.before ?? "?"} → ${vis.after ?? "?"}${vis.changed ? " (set team by the owner)" : ""}`);
if (!vis.ok) process.exit(1);
tokens[id] = { role: "note", version, token_sha256: [sha256(value)], token_pattern: "(bt-[a-z0-9]+)", adoption_fields: ["value"], content_hash: createHash("md5").update(content, "utf-8").digest("hex"), name: NAME };
writeFileSync(tokensPath, JSON.stringify(tokens, null, 2) + "\n");
const back = await manageGet({ team_id, user_id: authorUser, agent_id: authorAgent, skill_id: id, version, include_content: true });
const gotBack = [...String(back?.data?.content ?? "").matchAll(/bt-[a-z0-9]+/g)].map((m) => m[0]);
const verified = back?.code === 0 && new Set(gotBack).size === 1 && sha256(gotBack[0]) === sha256(value);
console.log(`${verified ? "OK  " : "BAD "} ${id} v${version}  sha256 ${sha256(value).slice(0, 12)}…  ${verified ? "verified from Core (manage read); the repository holds only the hash" : `read-back mismatch (${back?.message ?? "?"})`}`);
if (!verified) process.exit(1);
const p = provenance(id, value);
console.log(p.out.split("\n").map((l) => l.replace(value, "bt-<value>")).join("\n"));
process.exit(p.exit ?? 1);
