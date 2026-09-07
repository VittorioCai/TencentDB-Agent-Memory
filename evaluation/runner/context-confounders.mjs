/**
 * Context confounders — what else was in the model's context besides the
 * evaluation pool, recorded per run.
 *
 * Found in the 2026-09-06 review: every comparison run of that day carried a
 * `<tdai_profile_memory>` block — the consumer agent's own L3 memory, learned
 * from its evidence-base runs the night before — whose SOP said "probe every
 * documented candidate under a bounded timeout". The off arm's second dial is
 * therefore prescribed behaviour, not the model recovering on its own. The
 * same runs also had a consumer-owned auto-extracted skill in
 * `<available_skills>` that was outside the frozen pool.
 *
 * Neither is a defect of the product; both are the product working. But a
 * comparison that does not record them cannot say what its numbers rest on.
 * This script reads the run's own artifacts — the captured system prompt,
 * the service's tool-call rows, the frozen pool snapshot — and writes down:
 *
 *   - whether the profile-memory block was present, for which agent, the L3
 *     text's hash and "last update", and which of its lines match the task's
 *     watch patterns (the phrases a reviewer would want to know were there);
 *   - the names in `<available_skills>` and which of them are not in the pool;
 *   - every bridge read (get / get-by-name) of a skill outside the pool.
 *
 * It never judges. A run with a confounder is still a run; the report says
 * so beside the number. Absent inputs produce nulls, not zeros.
 *
 * Usage:
 *   node context-confounders.mjs --run=<dir> [--watch=<file with one regex per line>] [--out=F]
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const sha1 = (s) => createHash("sha1").update(s).digest("hex");

function between(text, open, close) {
  const i = text.indexOf(open);
  if (i < 0) return null;
  const j = text.indexOf(close, i + open.length);
  return j < 0 ? text.slice(i + open.length) : text.slice(i + open.length, j);
}

/** The first system message of the first captured request, or null. */
export function systemPromptOf(captureLines) {
  for (const line of captureLines) {
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (rec.event !== "http.request") continue;
    const msgs = rec.body?.json?.messages ?? [];
    for (const m of msgs) {
      if (m.role !== "system") continue;
      return typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    }
  }
  return null;
}

/** Profile-memory facts from a system prompt. `present:false` when the block is absent. */
export function profileMemoryOf(systemPrompt, watch = []) {
  if (systemPrompt == null) return { present: null, reason: "no system prompt captured" };
  const block = between(systemPrompt, "<tdai_profile_memory>", "</tdai_profile_memory>");
  if (block == null) return { present: false };
  const agents = [...block.matchAll(/<agent name="([^"]*)" role="([^"]*)" agent_id="([^"]*)">/g)]
    .map((m) => ({ name: m[1], role: m[2], agent_id: m[3] }));
  const l3 = between(block, "<l3_core_memory>", "</l3_core_memory>");
  const l2 = between(block, "<l2_scene_index>", "</l2_scene_index>");
  const l3Text = l3 == null ? null : l3.trim();
  const lastUpdate = l3Text ? (l3Text.match(/\*\*Last update\*\*:\s*(\S+)/)?.[1] ?? null) : null;
  const hits = [];
  if (l3Text) {
    const lines = l3Text.split("\n");
    lines.forEach((text, idx) => {
      for (const w of watch) {
        if (w.test(text)) { hits.push({ line: idx + 1, pattern: w.source, text: text.trim().slice(0, 300) }); break; }
      }
    });
  }
  return {
    present: true,
    agents,
    l3: l3Text == null ? { present: false } : { present: true, sha1: sha1(l3Text), chars: l3Text.length, last_update: lastUpdate, watch_hits: hits },
    l2_index_entries: l2 == null ? null : l2.split("\n").filter((l) => l.trim().startsWith("- ")).length,
  };
}

/** Names listed in `<available_skills>`; empty array when the block is absent. */
export function availableSkillsOf(systemPrompt) {
  if (systemPrompt == null) return null;
  const block = between(systemPrompt, "<available_skills>", "</available_skills>");
  if (block == null) return [];
  return block.split("\n").map((l) => l.match(/^\s*-\s*([^:\s]+)\s*:/)?.[1]).filter(Boolean);
}

/**
 * Bridge reads (get / get-by-name) of skills outside the pool, from the
 * service's own rows. A read names the skill by id or by name; both are
 * checked against the snapshot.
 */
export function nonPoolReadsOf(toolCallRows, pool) {
  const ids = new Set(pool.map((a) => a.asset_id));
  const names = new Set(pool.map((a) => a.name));
  const out = [];
  for (const r of toolCallRows) {
    if (r.kind !== "bridge_call") continue;
    const ep = r.executed_endpoint ?? "";
    if (!/^(?:skill:)?(get|get-by-name)$/.test(ep)) continue;
    let body = {};
    try { body = typeof r.request_body === "string" ? JSON.parse(r.request_body) : (r.request_body ?? {}); } catch { body = {}; }
    const id = body.skill_id ?? null;
    const name = body.skill_name ?? null;
    const inPool = (id && ids.has(id)) || (name && names.has(name));
    if (inPool) continue;
    if (!id && !name) continue;
    out.push({ timestamp: r.timestamp ?? null, endpoint: ep, skill_id: id, skill_name: name, upstream_status: r.upstream_status ?? null });
  }
  return out;
}

export function contextConfounders({ captureLines, toolCallRows, pool, watch = [], now = new Date() }) {
  const sys = systemPromptOf(captureLines ?? []);
  const available = availableSkillsOf(sys);
  const poolNames = new Set(pool.map((a) => a.name));
  return {
    schema: "context-confounders-v1",
    checked_at: now.toISOString(),
    system_prompt: sys == null ? null : { chars: sys.length, sha1: sha1(sys) },
    profile_memory: profileMemoryOf(sys, watch),
    available_skills: available == null ? null : { names: available, not_in_pool: available.filter((n) => !poolNames.has(n)) },
    non_pool_skill_reads: toolCallRows == null ? null : nonPoolReadsOf(toolCallRows, pool),
    pool: { asset_ids: pool.map((a) => a.asset_id), names: [...poolNames] },
    watch: watch.map((w) => w.source),
  };
}

/** The few numbers a manifest or a summary table needs. */
export function summaryOf(c) {
  return {
    profile_memory_present: c.profile_memory?.present ?? null,
    l3_watch_hits: c.profile_memory?.l3?.watch_hits?.length ?? null,
    l3_sha1: c.profile_memory?.l3?.sha1 ?? null,
    non_pool_skills_in_listing: c.available_skills?.not_in_pool?.length ?? null,
    non_pool_skill_reads: c.non_pool_skill_reads?.length ?? null,
  };
}

function readLines(p) {
  return existsSync(p) ? readFileSync(p, "utf8").split("\n").filter((l) => l.trim()) : null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true]; }));
  if (!args.run) { console.error("usage: node context-confounders.mjs --run=<dir> [--watch=F] [--out=F]"); process.exit(2); }
  const capture = readLines(join(args.run, "capture.jsonl"));
  const rowsRaw = readLines(join(args.run, "tool-call-logs.jsonl"));
  const rows = rowsRaw ? rowsRaw.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : null;
  const snapP = join(args.run, "asset-pool-snapshot.json");
  const pool = existsSync(snapP) ? (JSON.parse(readFileSync(snapP, "utf8")).assets ?? []) : [];
  const watch = args.watch && existsSync(args.watch)
    ? readFileSync(args.watch, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => new RegExp(l, "i"))
    : [];
  const out = contextConfounders({ captureLines: capture, toolCallRows: rows, pool, watch });
  const outP = args.out || join(args.run, "context-confounders.json");
  writeFileSync(outP, JSON.stringify(out, null, 2) + "\n");
  const s = summaryOf(out);
  console.log(`context-confounders: profile_memory=${s.profile_memory_present} l3_watch_hits=${s.l3_watch_hits} non_pool_listing=${s.non_pool_skills_in_listing} non_pool_reads=${s.non_pool_skill_reads} → ${outP}`);
}
