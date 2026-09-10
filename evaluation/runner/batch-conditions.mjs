#!/usr/bin/env node
/**
 * 一个批次的实验条件:冻结一次,开跑前核对一次。
 *
 * 为什么要有这个文件(CLAUDE.md §11、§12):描述"现在是什么"的文件——pair.json、
 * gate_baseline.json、tokens.json——不是核对过一次就永远可信;把一个文件提升为
 * 可信来源,和核对它是同一个动作。批次四差点借用 gate_baseline_batch3.json 开跑:
 * 它记的是 v2、9/6 冻结,而资产已经是 v3、消费者换了、token 换了。
 *
 * 两种模式,**读线上状态的代码是同一份**,所以冻结时记下的和核对时读到的不会因为
 * 两处实现不同而漂移:
 *
 *   --freeze   读线上与仓库,写出条件清单和该批次的闸门基线,并把 pair.json 顶层
 *              对齐到线上(版本、消费者、快照时间)
 *   --check    再读一遍线上,逐项与清单比对;全部通过才退出 0
 *
 * 清单里记的每一项,都是实验两臂之间**必须相同**的东西;两臂唯一允许不同的变量
 * 写在 arms.vary 里。
 *
 * 用法:
 *   node evaluation/runner/batch-conditions.mjs --freeze --batch=4 --consumer=<agent_id> [--task=DIR] \
 *        [--out=evaluation/gate/artifacts/batch4-conditions.json]
 *   node evaluation/runner/batch-conditions.mjs --check --conditions=<清单>
 *
 * 退出:0 全部通过 · 1 有未过或未知 · 2 参数错
 */
import { readFileSync, writeFileSync, existsSync, statSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, relative } from "node:path";
import { filesInTar, onlyAgent, baselineFindings } from "./isolation-check.mjs";
import { provenanceOf, isDerivableFromDeployment, readTextFilesUnder, sourcesFromRun, taskFileKind } from "./token-provenance.mjs";
import { verifyCoverage } from "../attribution/delivery-audit.mjs";
import { adoptionFromAcceptance } from "../attribution/adoption.mjs";
import { resolveTokens } from "../attribution/resolve-tokens.mjs";
import { homedir } from "node:os";

// 批次运行记录的根目录(仓库之外)。方案 2 补充二:运行记录不写进仓库,来源扫描
// 要把它也扫进去。默认值与 run-once.sh 的 RUN_RECORDS_ROOT 对齐。
const RUN_RECORDS_ROOT = process.env.RUN_RECORDS_ROOT ?? "/private/tmp/topic4-runs";

const REPO = resolve(new URL("../..", import.meta.url).pathname);
const rel = (p) => relative(REPO, p);
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const md5 = (buf) => createHash("md5").update(buf).digest("hex");
const fileSha = (p) => (existsSync(p) ? sha256(readFileSync(p)) : null);
const readJson = (p, fb = null) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fb);
const readLines = (p) => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

// --- Core -----------------------------------------------------------------

const CORE_URL = process.env.CORE_URL ?? "http://localhost:8420";
const SERVICE_ID = process.env.SERVICE_ID ?? "default";

/** 密钥只在进程内进请求头,不进命令行、不进日志、不进输出。 */
function keyFrom(file) {
  const p = resolve(REPO, file);
  if (!existsSync(p)) throw new Error(`key file missing: ${rel(p)}`);
  return readFileSync(p, "utf8").replace(/\s+/g, "");
}
async function core(path, body, key) {
  const res = await fetch(`${CORE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-tdai-service-id": SERVICE_ID, authorization: `Bearer ${key}`, "x-tdai-user-key": key },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({ code: -1, message: `non-JSON reply (${res.status})` }));
  return j;
}

// --- docker ---------------------------------------------------------------

const CONTAINER = process.env.CORE_CONTAINER ?? "tdai-memory-core";
const MEM_ROOT = process.env.MEM_ROOT ?? "/data/tdai-memory/profiles";
const sh = (args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
function memTreeHash() {
  try { return sh(["exec", CONTAINER, "sh", "-c", `cd '${MEM_ROOT}' && find . -type f | LC_ALL=C sort | xargs -r sha256sum | sha256sum | cut -d' ' -f1`]); } catch { return "absent"; }
}
function memScopedHash(agentId) {
  try { return sh(["exec", CONTAINER, "sh", "-c", `cd '${MEM_ROOT}' && find . -type f -path '*agent%3A${agentId}*' | LC_ALL=C sort | xargs -r sha256sum | sha256sum | cut -d' ' -f1`]); } catch { return "absent"; }
}
function memSnapshotTo(path) {
  const buf = execFileSync("docker", ["exec", CONTAINER, "tar", "czf", "-", "-C", MEM_ROOT, "."], { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024 });
  writeFileSync(path, buf);
  return path;
}
function containerStartedAt(name) {
  try { return sh(["inspect", name, "--format", "{{.State.StartedAt}}"]); } catch { return null; }
}

// --- the live reading ------------------------------------------------------

const TASK_FILES = ["task.md", "verify.mjs", "tokens.json", "confounders.watch", "assets/wrong.md", "assets/right.md"];
const ANALYSIS_FILES = [
  "evaluation/attribution/delivery-audit.mjs", "evaluation/attribution/adoption.mjs", "evaluation/attribution/calibration.mjs",
  "evaluation/attribution/calibrate-runs.mjs", "evaluation/attribution/judge-hard.mjs", "evaluation/attribution/judge-outcome.mjs",
  "evaluation/attribution/extract-tokens.mjs", "evaluation/runner/run-once.sh", "evaluation/runner/isolation-check.mjs",
  "evaluation/runner/token-provenance.mjs", "evaluation/gate/core-gate.sh", "MemoryCore/src/metadata/service/asset-gate.ts",
];

function proxyForcedIdentity(configPath) {
  const text = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const block = /debugForceIdentity:\s*\n((?:[ \t]+\S.*\n?)+)/.exec(text)?.[1] ?? "";
  const pick = (k) => /(?:^|\n)[ \t]*KEY:[ \t]*"?([^"\n]+?)"?[ \t]*(?:\n|$)/.source.replace("KEY", k);
  const get = (k) => new RegExp(pick(k)).exec(block)?.[1] ?? null;
  return { team_id: get("team_id"), agent_id: get("agent_id"), task_id: get("task_id") };
}

/**
 * 读线上与仓库。`spec` 说要读什么(任务目录、资产 id、消费者、作者、密钥文件);
 * 冻结时从参数与 pair.json 来,核对时从清单来——读法相同。
 */
async function readLive(spec) {
  const taskDir = resolve(REPO, spec.task_dir);
  const tokens = readJson(join(taskDir, "tokens.json"), {});
  const assetIds = Object.keys(tokens).filter((k) => !k.startsWith("_"));
  const key = keyFrom(spec.reader_key_file);
  // 判别值明文只在 Core(方案 2)。先取回,基线扫描和来源扫描都要用它——哈希扫不了。
  const resolved = await resolveTokens(taskDir, { keyFile: spec.reader_key_file, team_id: spec.team_id, author_agent_id: spec.author_agent_id });
  const resolvedPlain = assetIds.flatMap((id) => resolved[id]?.tokens ?? []);

  const assets = {};
  for (const id of assetIds) {
    const a = await core("/v3/meta/asset/get", { asset_id: id }, key);
    const g = await core("/v3/meta/asset/gate/get", { asset_id: id }, key);
    const d = a?.data ?? {}, gd = g?.data ?? {};
    assets[id] = {
      ok: a?.code === 0, message: a?.code === 0 ? null : (a?.message ?? "unreadable"),
      name: d.name ?? null, version: d.version ?? null, content_hash: d.content_hash ?? null,
      status: d.status ?? null, visibility: d.visibility ?? null, owner_user_id: d.owner_user_id ?? null,
      gate_decision: gd.gate?.decision ?? null, gate_rules_version: gd.gate?.rules_version ?? null,
      confidence: gd.confidence ?? null, revision: gd.revision ?? null,
    };
  }

  const agentOf = async (id) => {
    if (!id) return { ok: false, owner_user_id: null, name: null };
    const r = await core("/v3/meta/agent/get", { agent_id: id }, key);
    return { ok: r?.code === 0, owner_user_id: r?.data?.owner_user_id ?? null, name: r?.data?.name ?? null, message: r?.code === 0 ? null : r?.message };
  };
  const consumer = await agentOf(spec.consumer_agent_id);
  const author = await agentOf(spec.author_agent_id);

  const proxyConfig = resolve(REPO, spec.proxy_config);
  const proxy = {
    config_path: rel(proxyConfig),
    config_sha256: fileSha(proxyConfig),
    config_mtime: existsSync(proxyConfig) ? statSync(proxyConfig).mtime.toISOString() : null,
    forced_identity: proxyForcedIdentity(proxyConfig),
    container_started_at: containerStartedAt("tdai-proxy"),
  };

  // 记忆:整树哈希、消费者范围哈希、一份临时快照(给干净检查与来源扫描用)
  const tmp = mkdtempSync(join(tmpdir(), "batchcond-"));
  const tar = memSnapshotTo(join(tmp, "memory.tar.gz"));
  const memFiles = filesInTar(tar);
  const scoped = onlyAgent(memFiles, spec.consumer_agent_id);
  const memory = {
    root: MEM_ROOT,
    tree_sha256: memTreeHash(),
    consumer_scope: { agent_id: spec.consumer_agent_id, sha256: memScopedHash(spec.consumer_agent_id), files: scoped.length },
    snapshot_files: memFiles.length,
  };
  const watch = existsSync(join(taskDir, "confounders.watch"))
    ? readFileSync(join(taskDir, "confounders.watch"), "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
    : [];
  // 用从 Core 取回的明文扫基线;哈希模式下仓库里没有明文可扫。取不到时(资产被闸门
  // 挡着)tokenList 为空,基线只按观察行扫,报告会提示明文未取回。
  const clean = baselineFindings(scoped, resolvedPlain, watch);
  memory.token_plaintext_resolved = resolvedPlain.length;
  memory.consumer_baseline_clean = clean.clean;
  memory.consumer_baseline_hits = clean.hits.length;
  memory.consumer_baseline_unscanned = clean.unscanned.length;
  memory.watch_patterns = watch.length;
  memory.invalid_watch_patterns = clean.invalid_patterns.length;

  // token 来源唯一性:任务目录(按 self / record / task 分类)+ 记忆快照(全树)
  // + CodeBuddy 的项目缓存(历次会话的工具结果,2026-09-10 核实为跨运行通道)
  // + 全部历史运行的捕获与服务侧记录
  const sources = [];
  const td = readTextFilesUnder(taskDir, "task");
  for (const f of td.files) sources.push({ ...f, name: `task:${f.name}`, kind: taskFileKind(f.name) });
  for (const f of memFiles) if (f.text != null) sources.push({ name: `memory:${f.path}`, kind: "memory", text: f.text });
  const cbProjects = join(homedir(), ".codebuddy", "projects");
  // 工具结果文件可以很大(实测一份 >2MB)。跳过它就是 D4 那类"太大所以没查";
  // 一次扫描多读几十 MB 无妨,缺口不行。
  const cb = existsSync(cbProjects) ? readTextFilesUnder(cbProjects, "cache", 64 * 1024 * 1024) : { files: [], skipped: [] };
  for (const f of cb.files) sources.push({ ...f, name: `codebuddy:${f.name}`, kind: "cache" });
  const repoSlug = REPO.replace(/^\//, "").replace(/\//g, "-");
  const codebuddyCache = {
    projects_dir: cbProjects,
    repository_slug: repoSlug,
    sessions_under_repository_slug: existsSync(join(cbProjects, repoSlug)) ? readdirSync(join(cbProjects, repoSlug)).filter((d) => { try { return statSync(join(cbProjects, repoSlug, d)).isDirectory(); } catch { return false; } }).length : 0,
    files_scanned: cb.files.length, files_skipped: cb.skipped.length,
  };
  // 运行记录:仓库内的旧 runs/,加上仓库外的批次运行记录根(补充二)。两处都扫。
  const runProblems = [];
  for (const runsDir of [resolve(REPO, "evaluation/runner/runs"), RUN_RECORDS_ROOT]) {
    if (!existsSync(runsDir)) continue;
    for (const d of readdirSync(runsDir)) {
      const p = join(runsDir, d);
      try { if (!statSync(p).isDirectory()) continue; } catch { continue; }
      const r = sourcesFromRun(p);
      sources.push(...r.sources);
      runProblems.push(...r.problems);
    }
  }

  // 来源唯一性按**资产 id** 汇总,绝不用明文当键——这份结果会写进仓库里的条件清单。
  // found_in 只带文件名/类型/次数,不带明文。取不到明文时该资产的来源唯一性是未知。
  const provenance = {};
  for (const id of assetIds) {
    const r = resolved[id] ?? {};
    const plain = r.tokens ?? [];
    if (!plain.length) {
      provenance[id] = { clean: null, derivable_from_deployment: null, found_in: [], why: r.why ?? "明文未能从 Core 取回" };
      continue;
    }
    const found = [], derivs = [];
    let clean = true;
    for (const t of plain) {
      const v = provenanceOf(t, sources);
      if (!v.clean) clean = false;
      found.push(...v.found_in.map((f) => ({ name: f.name, kind: f.kind, count: f.count })));
      derivs.push(isDerivableFromDeployment(t));
    }
    provenance[id] = { clean, derivable_from_deployment: derivs.some(Boolean), found_in: found };
  }
  const provenanceGapList = [
    ...td.skipped.map((x) => `task:${x.name}: ${x.why}`),
    ...memFiles.filter((f) => f.text == null).map((f) => `memory:${f.path}: ${f.why ?? "未读取"}`),
    ...runProblems.map((x) => `${x.where}: ${x.why}`),
    ...cb.skipped.map((x) => `codebuddy:${x.name}: ${x.why}`),
    ...Object.entries(resolved).filter(([, r]) => !(r.tokens ?? []).length).map(([id, r]) => `resolve:${id}: ${r.why ?? "明文未取回"}`),
  ];
  const provenanceGaps = provenanceGapList.length;
  rmSync(tmp, { recursive: true, force: true });

  const files = {};
  for (const f of TASK_FILES) files[`${rel(taskDir)}/${f}`] = fileSha(join(taskDir, f));
  for (const f of ANALYSIS_FILES) files[f] = fileSha(resolve(REPO, f));

  // 资产源文件是占位符(方案 2):明文不在其中。所以不再比"本地 md5 == Core
  // content_hash"。改为:本地必须是占位符(不含任何 bt- 明文),且 Core 正文里的
  // 判别值哈希与 tokens.json 的 token_sha256 一致(由 resolved.verified 给出)。
  const PLACEHOLDER = /x-team-trace:\s*<[^>\n]*>/;
  const bodies = {};
  for (const [id, spec_] of Object.entries(tokens)) {
    if (id.startsWith("_")) continue;
    const role = spec_.role;
    const p = join(taskDir, "assets", `${role}.md`);
    const text = existsSync(p) ? readFileSync(p, "utf8") : null;
    const hashMode = Array.isArray(spec_.token_sha256) && spec_.token_sha256.length > 0;
    bodies[id] = {
      role, file: text == null ? null : rel(p), hash_mode: hashMode,
      is_placeholder: text == null ? null : (hashMode ? PLACEHOLDER.test(text) : true),
      // 占位符里不能有任何 bt- 明文;万一残留就抓出来。
      leaks_plaintext: text == null ? null : /bt-[a-z0-9]{6,}/.test(text.replace(PLACEHOLDER, "")),
      core_trace_verified: resolved[id]?.verified ?? null,
      core_trace_why: resolved[id]?.why ?? null,
      adoption_fields: spec_.adoption_fields ?? null,
      // 老批次(明文模式)保留原来的检查语义。
      carries_own_tokens: !hashMode && text != null ? (spec_.tokens ?? []).every((t) => text.includes(t)) : null,
    };
  }

  return { assets, consumer, author, proxy, memory, resolved, provenance, provenance_sources: sources.length, provenance_gaps: provenanceGaps, provenance_gap_list: provenanceGapList, codebuddy_cache: codebuddyCache, files, bodies, tokens };
}

// --- freeze ----------------------------------------------------------------

async function freeze(args) {
  const batch = Number(args.batch);
  if (!batch) throw new Error("--batch=<n> is required");
  const taskDir = args.task ?? "evaluation/tasks/bridge-addr";
  const pair = readJson(resolve(REPO, taskDir, "pair.json"), {});
  // 消费者必须显式给出。第一次冻结从 pair.json 取,而 pair.json 还写着旧消费者,
  // 于是清单记了旧消费者、pair.json 又被"对齐"到旧消费者、干净检查扫了旧消费者的
  // 那份记忆(8 处命中)——正是 CLAUDE.md §11 的事故。描述"现在是什么"的文件不能
  // 当作"应该是什么"的来源;应该是什么,由发起这次冻结的人说。
  if (!args.consumer) throw new Error("--consumer=<agent_id> is required: the consumer is the intended condition, not something to read off pair.json");
  const spec = {
    task_dir: taskDir,
    reader_key_file: args["reader-key"] ?? "deploy/global-images/.topic4-user-key",
    consumer_agent_id: String(args.consumer),
    author_agent_id: args.author ?? pair.author_agent_id,
    proxy_config: args["proxy-config"] ?? "deploy/global-images/.proxy-config/config.yaml",
  };
  const live = await readLive(spec);
  const now = new Date().toISOString();
  const rules = [...new Set(Object.values(live.assets).map((a) => a.gate_rules_version).filter(Boolean))];
  const head = (() => { try { return execFileSync("git", ["-C", REPO, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(); } catch { return null; } })();

  const conditions = {
    schema: "batch-conditions-v1",
    batch,
    frozen_at: now,
    frozen_on_top_of: head,
    what_this_is: "两臂之间必须相同的一切。arms.vary 之外的任何差异都使对照失效。核对命令:node evaluation/runner/batch-conditions.mjs --check --conditions=<本文件>",
    spec,
    rules_version: rules.length === 1 ? rules[0] : null,
    rules_note: "只有判据变化才更新 rules_version(CLAUDE.md §12)。换 token、换消费者、升资产版本都不是判据变化,所以沿用。",
    team_id: pair.team_id ?? null,
    task_id: pair.task_id ?? null,
    assets: Object.fromEntries(Object.entries(live.assets).map(([id, a]) => [id, {
      role: live.bodies[id]?.role ?? null, name: a.name, version: a.version, content_hash: a.content_hash,
      owner_user_id: a.owner_user_id, visibility: a.visibility,
      status_at_freeze: a.status, gate_decision_at_freeze: a.gate_decision, confidence_at_freeze: a.confidence,
      required_status_before_run: "approved",
      required_status_why: "场景前提是闸门表态前的池:两臂都从两条资产可读出发,gate-on 臂再由 Core 按冻结证据判定。",
      tokens: live.tokens[id]?.tokens ?? [], adoption_fields: live.tokens[id]?.adoption_fields ?? null,
      body_file: live.bodies[id]?.file ?? null, body_md5: live.bodies[id]?.md5 ?? null,
    }])),
    consumer: { agent_id: spec.consumer_agent_id, user_id: live.consumer.owner_user_id, agent_name: live.consumer.name },
    author: { agent_id: spec.author_agent_id, user_id: live.author.owner_user_id },
    cross_user: live.consumer.owner_user_id && live.author.owner_user_id ? live.consumer.owner_user_id !== live.author.owner_user_id : null,
    model: { id: args.model ?? "deepseek-v4-flash", source: "batch-3 captures; the trial run's capture must show the same id", invocation: "run-once.sh --auto — a fresh CodeBuddy process per run" },
    proxy: live.proxy,
    isolation: {
      require_empty_consumer: true,
      method: "run-once.sh snapshots profiles/ before each session and restores it after; hashes recorded in run.json.agent_memory (whole tree) and .consumer_scope (the consumer's share)",
      session_cwd_policy: "run-once.sh --auto runs each session in a fresh empty directory (mktemp under /private/tmp/topic4-sessions), never in the repository; run.json.session records cwd, CodeBuddy project dir, and cached files before the run",
      session_cwd_why: "every earlier session's system prompt read 'Working directory: <the repository>' — the model could read tokens.json, pair.json and the run records; and CodeBuddy keeps each session's tool results under ~/.codebuddy/projects/<slug of cwd>/, so one slug for all runs let any run read any earlier run's tool output (51 sessions under the repository slug at freeze). Measured 2026-09-10; in 20260908T075637Z the file read was the run's own, so no cross-run read is on record — the channel existed, unused.",
      codebuddy_cache: live.codebuddy_cache,
      unit_for_same_start: "consumer_scope — the whole-tree hash drifts when the pipeline writes to another agent (measured 2026-09-08T23:20Z, 73 min after the isolated batch)",
      late_write_risk: "the memory pipeline can write to a profile long after its session; a write landing between two runs shows up as same_baseline=false in isolation-check, which is the guard",
      memory: live.memory,
    },
    token_provenance: { sources_scanned: live.provenance_sources, gaps: live.provenance_gaps, gap_list: live.provenance_gap_list, by_asset: live.provenance },
    files: live.files,
    arms: {
      vary: ["gate"], values: ["off", "on"], order: "interleaved: off, on, off, on, …",
      held_constant: "everything else in this file — task, verifier, tokens, asset versions, consumer, model, proxy config, memory baseline, rules",
      gate_baseline: `evaluation/gate/artifacts/gate_baseline_batch${batch}.json`,
    },
    trial_checkpoints: [
      "run.json.session.cwd is not the repository and run.json.session.project_cache_files_before == 0; the capture's first system message says 'Working directory: <that cwd>'",
      "run.json.agent_memory.consumer_scope.agent_id == consumer.agent_id;first trial: files_before == memory.consumer_scope.files and hash_before == memory.consumer_scope.sha256",
      "resolved-identity.txt names agent=consumer.agent_id and user=consumer.user_id",
      "capture complete: calibrate-runs per-run table shows capture=complete (verifyCoverage)",
      "verdict.json attempts[].value carries a trace value on every attempt at the target (adoption field present)",
      "calibrate-runs per-run: adopted is true or false for both assets — not unknown — in a run that reached the target",
      "isolation-check over the trial pair: baseline_clean 通过, same_baseline 通过 (按消费者范围), rolled_back 通过",
      "run dir tokens.json equals the task's tokens.json (sha256)",
      "gate-apply.json status_at_start matches the arm: off = both approved; on = per gate_baseline decisions",
      "the model id in the trial capture equals model.id",
      "PASS/FAIL is not a checkpoint: it is the task outcome, not the thing under test",
    ],
    rollback: {
      proxy_config: {
        changed: "sessionInit.debugForceIdentity.agent_id: agt-5e0y4l8a7a → " + (live.proxy.forced_identity.agent_id ?? "?"),
        backup: "deploy/global-images/.proxy-config/config.yaml.orig-20260909-before-consumer-switch",
        backup_sha256: fileSha(resolve(REPO, "deploy/global-images/.proxy-config/config.yaml.orig-20260909-before-consumer-switch")),
        current_sha256: live.proxy.config_sha256,
        restore: "cp deploy/global-images/.proxy-config/config.yaml.orig-20260909-before-consumer-switch deploy/global-images/.proxy-config/config.yaml && docker restart tdai-proxy",
        verify: "docker logs tdai-proxy 2>&1 | grep -F '→ initialized' | tail -1   # 下一次会话应显示 agent=agt-5e0y4l8a7a",
        note: "备份在受 .gitignore 保护的持久目录里,含密钥,不进 Git(CLAUDE.md §10)",
      },
    },
  };

  const out = resolve(REPO, args.out ?? `evaluation/gate/artifacts/batch${batch}-conditions.json`);
  writeFileSync(out, JSON.stringify(conditions, null, 2) + "\n");

  // 该批次的闸门基线:core-gate.sh 读 frozen_at / assets{} / decisions[];此时没有 v3 的证据。
  const gb = {
    schema_version: "gate-baseline-v1",
    batch,
    frozen_at: now,
    pool_snapshot_at: readJson(resolve(REPO, "evaluation/provenance/artifacts/asset-pool-snapshot.json"), {})?.pool_snapshot_at ?? null,
    team_id: pair.team_id ?? null,
    rules_version: conditions.rules_version,
    code_commit: head,
    source_runs: [], event_count: 0, by_state: {}, events: [], decisions: [],
    assets: Object.fromEntries(Object.entries(live.assets).map(([id, a]) => [id, {
      name: a.name, version: a.version, content_hash: a.content_hash,
      producer_user_id: a.owner_user_id, producer_agent_id: spec.author_agent_id,
      baseline_visibility: a.visibility ?? "team", visibility_source: "read from /v3/meta/asset/get at freeze time",
    }])),
    decisions_at_freeze: Object.fromEntries(Object.entries(live.assets).map(([id, a]) => [id, {
      status: a.status, decision: a.gate_decision, confidence: a.confidence, rules_version: a.gate_rules_version, evidence: [],
    }])),
    evidence_base: "none — the assets are at a new version and no outcome is bound to it yet. Preparation runs must record v3 outcomes before the gate-on arm can decide anything but pending.",
    note: `Batch ${batch} baseline. Same rules as batch 3 (${conditions.rules_version}); new tokens (trace header), new consumer, assets at v${Object.values(live.assets)[0]?.version}. Frozen by batch-conditions.mjs --freeze; conditions in ${rel(out)}.`,
  };
  const gbOut = resolve(REPO, conditions.arms.gate_baseline);
  writeFileSync(gbOut, JSON.stringify(gb, null, 2) + "\n");

  // pair.json 顶层对齐到线上:版本、哈希、消费者、快照时间。旧的 _batch4_pending 并入 batchN。
  const p = resolve(REPO, taskDir, "pair.json");
  const pj = readJson(p, {});
  pj.consumer_agent_id = spec.consumer_agent_id;
  pj.pool_snapshot_at = gb.pool_snapshot_at;
  pj.pool_asset_count = Object.keys(live.assets).length;
  pj.assets = (pj.assets ?? []).map((x) => live.assets[x.asset_id] ? { ...x, version: live.assets[x.asset_id].version, content_hash: live.assets[x.asset_id].content_hash, name: live.assets[x.asset_id].name } : x);
  const pending = pj._batch4_pending; delete pj._batch4_pending;
  pj[`batch${batch}`] = { conditions: rel(out), gate_baseline: rel(gbOut), frozen_at: now, consumer_agent_id: spec.consumer_agent_id, tokens: Object.fromEntries(Object.entries(live.tokens).filter(([k]) => !k.startsWith("_")).map(([k, v]) => [k, v.tokens])), ...(pending ? { history: pending } : {}) };
  writeFileSync(p, JSON.stringify(pj, null, 2) + "\n");

  console.log(`frozen → ${rel(out)}`);
  console.log(`gate baseline → ${rel(gbOut)}`);
  console.log(`pair.json aligned → ${rel(p)}`);
  return conditions;
}

// --- check -------------------------------------------------------------------

async function check(args) {
  const cpath = resolve(REPO, args.conditions ?? "");
  const c = readJson(cpath, null);
  if (!c) throw new Error(`--conditions=<file> missing or unreadable: ${args.conditions}`);
  const live = await readLive(c.spec);
  const rows = [];
  const row = (name, ok, expected, actual, fix) => rows.push({ name, ok, expected, actual, fix });
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  for (const [id, a] of Object.entries(c.assets)) {
    const l = live.assets[id] ?? {};
    row(`asset ${a.role} ${id} 可读`, l.ok === true, "code 0", l.ok ? "code 0" : (l.message ?? "unreadable"));
    row(`asset ${a.role} 版本`, l.version === a.version, a.version, l.version);
    row(`asset ${a.role} 正文哈希(Core)`, l.content_hash === a.content_hash, a.content_hash, l.content_hash);
    // 方案 2:资产源文件是占位符,明文只在 Core。所以查"本地是占位符、无明文残留",
    // 并查 Core 正文里的判别值哈希与 tokens.json 一致(resolved.verified)。
    row(`asset ${a.role} 本地是占位符、无 bt- 明文残留`, live.bodies[id]?.is_placeholder === true && live.bodies[id]?.leaks_plaintext === false, "placeholder, no plaintext", `placeholder=${live.bodies[id]?.is_placeholder} leaks=${live.bodies[id]?.leaks_plaintext}`);
    row(`asset ${a.role} Core 正文判别值哈希 == tokens.json`, live.bodies[id]?.core_trace_verified, "verified from Core", live.bodies[id]?.core_trace_why ?? "unverified",
      `资产须 approved 才能读回正文;先 core-gate.sh --reset --baseline ${c.arms.gate_baseline}`);
    row(`asset ${a.role} visibility`, l.visibility === a.visibility, a.visibility, l.visibility);
    row(`asset ${a.role} owner`, l.owner_user_id === a.owner_user_id, a.owner_user_id, l.owner_user_id);
    row(`asset ${a.role} 开跑前状态`, l.status === a.required_status_before_run, a.required_status_before_run, l.status,
      `bash evaluation/gate/core-gate.sh --reset --baseline ${c.arms.gate_baseline}   # 需要团队管理员密钥`);
    row(`asset ${a.role} 规则版本`, l.gate_rules_version === c.rules_version, c.rules_version, l.gate_rules_version);
    row(`asset ${a.role} adoption_fields 已声明`, Array.isArray(live.tokens[id]?.adoption_fields) && live.tokens[id].adoption_fields.length > 0, a.adoption_fields, live.tokens[id]?.adoption_fields ?? null);
  }

  row("消费者 agent 可读", live.consumer.ok === true, "code 0", live.consumer.ok ? "code 0" : live.consumer.message);
  row("消费者 user", live.consumer.owner_user_id === c.consumer.user_id, c.consumer.user_id, live.consumer.owner_user_id);
  row("作者 user", live.author.owner_user_id === c.author.user_id, c.author.user_id, live.author.owner_user_id);
  row("跨人:消费者 user ≠ 作者 user", live.consumer.owner_user_id && live.author.owner_user_id ? live.consumer.owner_user_id !== live.author.owner_user_id : null, "different", `${live.consumer.owner_user_id} vs ${live.author.owner_user_id}`);

  const fi = live.proxy.forced_identity;
  row("proxy 强制身份 agent == 消费者", fi.agent_id === c.consumer.agent_id, c.consumer.agent_id, fi.agent_id);
  row("proxy 强制身份 team", fi.team_id === c.team_id, c.team_id, fi.team_id);
  row("proxy 强制身份 task", fi.task_id === c.task_id, c.task_id, fi.task_id);
  row("proxy 配置未被改动", live.proxy.config_sha256 === c.proxy.config_sha256, c.proxy.config_sha256?.slice(0, 12), live.proxy.config_sha256?.slice(0, 12));
  const inEffect = live.proxy.container_started_at && live.proxy.config_mtime ? new Date(live.proxy.container_started_at) >= new Date(live.proxy.config_mtime) : null;
  row("proxy 已在配置修改后重启(配置生效)", inEffect, "started_at >= config mtime", `${live.proxy.container_started_at} vs ${live.proxy.config_mtime}`, "docker restart tdai-proxy");
  row("proxy 配置备份在受保护位置且哈希一致", fileSha(resolve(REPO, c.rollback.proxy_config.backup)) === c.rollback.proxy_config.backup_sha256, c.rollback.proxy_config.backup_sha256?.slice(0, 12), fileSha(resolve(REPO, c.rollback.proxy_config.backup))?.slice(0, 12));

  const m = live.memory, cm = c.isolation.memory;
  row("消费者记忆范围哈希 == 冻结值", m.consumer_scope.sha256 === cm.consumer_scope.sha256, cm.consumer_scope.sha256?.slice(0, 12), m.consumer_scope.sha256?.slice(0, 12), "重新冻结:node evaluation/runner/batch-conditions.mjs --freeze …");
  row("消费者记忆文件数 == 冻结值", m.consumer_scope.files === cm.consumer_scope.files, cm.consumer_scope.files, m.consumer_scope.files);
  row("消费者基线干净(token + 观察行)", m.consumer_baseline_clean === true, "clean", m.consumer_baseline_clean === null ? `unknown (明文取回 ${m.token_plaintext_resolved ?? 0};unscanned ${m.consumer_baseline_unscanned}, invalid patterns ${m.invalid_watch_patterns})` : m.consumer_baseline_clean ? "clean" : `${m.consumer_baseline_hits} hit(s)`);
  if (c.isolation?.require_empty_consumer) {
    // 批次四是"空基线"设计:消费者从零起步。冒烟运行的记忆流水线迟到写入把它污染成
    // 4 个文件(含"endpoint-b 可达"的结论),必须在开跑前清成 0,否则一次 run 就带着答案。
    row("消费者基线为空(files==0,空基线批次的硬要求)", m.consumer_scope.files === 0, 0, m.consumer_scope.files,
      "该消费者已被冒烟运行污染;新建一个空消费者或清空其 profile,再重新冻结");
  }
  rows.push({ name: "整树记忆哈希 == 冻结值(仅提示:整树会被别的 agent 的迟到写入带漂)", ok: m.tree_sha256 === cm.tree_sha256 ? true : "note", expected: cm.tree_sha256?.slice(0, 12), actual: m.tree_sha256?.slice(0, 12) });

  for (const [id, a] of Object.entries(c.assets)) {
    const lp = live.provenance[id] ?? {};
    row(`asset ${a.role} 判别值来源唯一且不可从部署推导`, lp.clean === true && lp.derivable_from_deployment === false, "clean, not derivable",
      lp.clean === null ? `unknown(${lp.why ?? "明文未取回"})` : `clean=${lp.clean} derivable=${lp.derivable_from_deployment}${(lp.found_in ?? []).length ? ` found_in=${lp.found_in.map((f) => f.name).slice(0, 3).join(",")}` : ""}`,
      lp.clean === null ? `资产须 approved 才能取回明文扫描;先 core-gate.sh --reset --baseline ${c.arms.gate_baseline}` : "");
  }
  row("来源扫描无缺口", live.provenance_gaps === 0, 0, live.provenance_gaps === 0 ? 0 : `${live.provenance_gaps}: ${live.provenance_gap_list.slice(0, 4).join(" | ")}`);
  row("CodeBuddy 项目缓存已纳入扫描", live.codebuddy_cache.files_scanned > 0 || live.codebuddy_cache.sessions_under_repository_slug === 0, ">0 files scanned", `${live.codebuddy_cache.files_scanned} files, ${live.codebuddy_cache.sessions_under_repository_slug} sessions under the repository slug`);
  row("run-once.sh 会话目录策略已记录", typeof c.isolation.session_cwd_policy === "string" && /fresh empty directory/.test(c.isolation.session_cwd_policy), "recorded", c.isolation.session_cwd_policy ? "recorded" : "missing");

  for (const [f, h] of Object.entries(c.files)) row(`文件未变 ${f}`, live.files[f] === h, h?.slice(0, 12), live.files[f]?.slice(0, 12), "代码变了:要么重新冻结,要么在报告里说明差异");

  row("闸门基线文件存在且 rules/版本一致", (() => { const gb = readJson(resolve(REPO, c.arms.gate_baseline), null); return !!gb && gb.rules_version === c.rules_version && Object.entries(c.assets).every(([id, a]) => gb.assets?.[id]?.version === a.version); })(), "exists, same rules, same versions", existsSync(resolve(REPO, c.arms.gate_baseline)) ? "exists" : "missing");
  const pair = readJson(resolve(REPO, c.spec.task_dir, "pair.json"), {});
  row("pair.json 顶层消费者 == 冻结消费者", pair.consumer_agent_id === c.consumer.agent_id, c.consumer.agent_id, pair.consumer_agent_id);
  row("pair.json 资产版本 == 线上版本", (pair.assets ?? []).every((x) => live.assets[x.asset_id]?.version === x.version), "all equal", (pair.assets ?? []).map((x) => `${x.role}=v${x.version}`).join(" "));

  // render
  const mark = (ok) => (ok === true ? "PASS" : ok === "note" ? "NOTE" : ok === null ? "UNKN" : "FAIL");
  console.log(`批次 ${c.batch} 条件核对 — 清单 ${rel(cpath)},冻结于 ${c.frozen_at}\n`);
  for (const r of rows) {
    console.log(`${mark(r.ok)}  ${r.name}`);
    if (r.ok !== true) {
      console.log(`      期望 ${JSON.stringify(r.expected)}  实际 ${JSON.stringify(r.actual)}`);
      if (r.fix && r.ok !== "note") console.log(`      修法 ${r.fix}`);
    }
  }
  const fails = rows.filter((r) => r.ok === false).length, unknown = rows.filter((r) => r.ok === null).length, notes = rows.filter((r) => r.ok === "note").length;
  const pass = rows.length - fails - unknown - notes;
  console.log(`\n通过 ${pass}  未过 ${fails}  未知 ${unknown}  提示 ${notes}  / 共 ${rows.length}`);
  console.log(fails === 0 && unknown === 0 ? "结论:条件一致,可以开试跑" : "结论:条件不一致,不开试跑");
  return fails === 0 && unknown === 0 ? 0 : 1;
}

// --- CLI ---------------------------------------------------------------------

// --- trial checkpoints (§13) ------------------------------------------------

/**
 * 试跑检查点:一对试跑(off 一次、on 一次)在正式批次前必须过的关。**不能只看 PASS**
 * ——PASS/FAIL 是任务结果,不是被测的东西。每一条都从运行留下的产物核对,给出通过、
 * 未过或未知,不设默认兜底。检查点提前写在条件清单的 `trial_checkpoints` 里(供人读),
 * 这里是可执行的版本(供机器判)。至少覆盖:条件一致性、隔离、采集完整性、
 * 实际采用字段(verdict.json 的 attempts[].value 是否带回 trace 值)。
 *
 * 用法:node evaluation/runner/batch-conditions.mjs --trial <run 目录> --conditions=<清单>
 * 退出:0 全过且无未知 · 1 有未过或未知 · 2 参数错
 */
function trialCheckpoints(runDir, c) {
  const dir = resolve(REPO, runDir);
  const run = readJson(join(dir, "run.json"), {}) ?? {};
  const verdict = readJson(join(dir, "verdict.json"), {}) ?? {};
  const rows = [];
  const add = (area, name, ok, detail) => rows.push({ area, name, ok, detail });

  // —— 条件一致性 ——
  const runTokens = readJson(join(dir, "tokens.json"), null);
  const taskTokens = readJson(resolve(REPO, c.spec.task_dir, "tokens.json"), null);
  add("条件一致性", "run 目录 tokens.json 与任务目录一致",
    runTokens && taskTokens ? sha256(Buffer.from(JSON.stringify(runTokens))) === sha256(Buffer.from(JSON.stringify(taskTokens))) : null,
    "两份 tokens.json 的内容哈希");
  const runRules = run.gate?.rules_version ?? readJson(join(dir, "gate_baseline.json"), {})?.rules_version ?? null;
  add("条件一致性", "规则版本与清单一致", runRules ? runRules === c.rules_version : null, `${runRules} vs ${c.rules_version}`);
  const arm = run.gate?.mode ?? null;
  add("条件一致性", "闸门臂已记录(off/on)", arm === "off" || arm === "on", `gate.mode=${arm}`);
  if (arm) {
    const st = run.gate?.status_at_start ?? {};
    const ids = Object.keys(c.assets);
    const asExpected = arm === "off"
      ? ids.every((id) => st[id] === "approved")
      : ids.every((id) => st[id] === (c.assets[id].gate_decision_at_freeze === "reject" ? "failed" : "approved"));
    add("条件一致性", `开跑状态符合 ${arm} 臂`, Object.keys(st).length ? asExpected : null, JSON.stringify(st));
  }

  // —— 隔离 ——
  const am = run.agent_memory ?? {};
  const cs = am.consumer_scope ?? {};
  add("隔离", "消费者身份 == 清单消费者", cs.agent_id ? cs.agent_id === c.consumer.agent_id : null, `${cs.agent_id} vs ${c.consumer.agent_id}`);
  const frozenScope = c.isolation?.memory?.consumer_scope?.sha256 ?? null;
  add("隔离", "起点 == 冻结的消费者基线", cs.hash_before && frozenScope ? cs.hash_before === frozenScope : null, `${String(cs.hash_before).slice(0, 12)} vs ${String(frozenScope).slice(0, 12)}`);
  const restored = cs.hash_restored ?? am.hash_restored ?? null;
  const base = cs.hash_before ?? am.hash_before ?? null;
  add("隔离", "运行后已回滚(还原后哈希==起点)", restored && base ? restored === base : null, `restored ${String(restored).slice(0, 12)} vs before ${String(base).slice(0, 12)}`);
  add("隔离", "会话工作目录不是仓库、缓存为空", run.session ? run.session.cwd_is_repository === false && (run.session.project_cache_files_before ?? 0) === 0 : null, JSON.stringify(run.session ?? null));

  // —— 采集完整性 ——
  let coverage = null, capReason = "";
  try {
    // verifyCoverage 自己筛 http.request 并按 tool_call_id 配对响应,所以要喂全部行,
    // 不能只喂 request(只喂 request 会让它以为每一轮都缺响应)。
    const cov = verifyCoverage(readLines(join(dir, "capture.jsonl")));
    coverage = cov.complete; capReason = (cov.reasons ?? []).slice(0, 3).join("; ");
  } catch (e) { capReason = e.message; }
  add("采集完整性", "捕获覆盖整段会话(verifyCoverage)", coverage, capReason || "complete");

  // —— 实际采用字段 ——
  const attempts = Array.isArray(verdict.attempts) ? verdict.attempts : [];
  add("实际采用", "验收记录有目标尝试", attempts.length > 0, `${attempts.length} 次尝试`);
  const withVal = attempts.filter((a) => String(a?.value ?? "").trim() !== "");
  add("实际采用", "每次尝试都带回 trace 值(attempts[].value)", attempts.length ? withVal.length === attempts.length : null, `${withVal.length}/${attempts.length} 带 value`);
  // 采纳判定能对每条资产得出 true/false(不是 unknown),证明匹配面被覆盖
  const adoption = adoptionFromAcceptance(verdict, taskTokens ?? {});
  const decided = Object.values(adoption).filter((x) => x.adopted === true || x.adopted === false).length;
  const nAssets = Object.keys(taskTokens ?? {}).length;
  add("实际采用", "采纳判定对每条资产可判(非 unknown)", nAssets ? decided === nAssets : null, `${decided}/${nAssets} 可判`);

  return rows;
}

async function trial(args) {
  const c = readJson(resolve(REPO, args.conditions ?? ""), null);
  if (!c) throw new Error(`--conditions=<file> missing: ${args.conditions}`);
  const runDir = args.trial === true ? null : args.trial;
  if (!runDir) throw new Error("usage: --trial <run dir> --conditions=<file>");
  const rows = trialCheckpoints(runDir, c);
  const mark = (ok) => (ok === true ? "PASS" : ok === null ? "UNKN" : "FAIL");
  console.log(`试跑检查点 — ${runDir}\n(PASS/FAIL 不是检查点;这些是开正式批次前必须过的关)\n`);
  let area = "";
  for (const r of rows) {
    if (r.area !== area) { area = r.area; console.log(`【${area}】`); }
    console.log(`  ${mark(r.ok)}  ${r.name}`);
    if (r.ok !== true) console.log(`        ${r.detail}`);
  }
  const fails = rows.filter((r) => r.ok === false).length, unknown = rows.filter((r) => r.ok === null).length;
  console.log(`\n通过 ${rows.length - fails - unknown}  未过 ${fails}  未知 ${unknown}  / 共 ${rows.length}`);
  console.log(fails === 0 && unknown === 0 ? "结论:检查点全过,这一对可作为批次的凭据" : "结论:检查点未全过,不开正式批次");
  return fails === 0 && unknown === 0 ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = {};
  for (const a of process.argv.slice(2)) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (m) args[m[1]] = m[2] ?? true;
    else if (!a.startsWith("--") && args.trial === true) args.trial = a;
  }
  try {
    if (args.freeze) { await freeze(args); process.exit(0); }
    if (args.check) { process.exit(await check(args)); }
    if (args.trial) { process.exit(await trial(args)); }
    console.error("usage: batch-conditions.mjs --freeze --batch=N --consumer=AGENT [--task=DIR] [--out=F] | --check --conditions=F | --trial <run dir> --conditions=F");
    process.exit(2);
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(2);
  }
}
