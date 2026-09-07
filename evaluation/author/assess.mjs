/**
 * Context-based author assessment.
 *
 * Reads an evidence pack (build-evidence-pack.mjs), asks a model to assess
 * the author for one domain and one asset claim, and keeps only what the
 * citation check (check-citations.mjs) can verify against the pack. The
 * output is what the gate reads: competence for the domain, and whether the
 * author's own records support, contradict, or say nothing about what the
 * asset asserts — each with the record ids and the quote that carry it.
 *
 * The model is a reader, not a witness. It may write any claim; a claim is
 * kept only if every record it cites exists and its quote is found in one
 * of them. Competence is read off the surviving claims: none survive, and
 * it is `unknown` whatever the model said. The raw model output is kept in
 * the artifact beside the verified result, so the difference is inspectable.
 *
 * The model endpoint is the same upstream the proxy uses (PROXY_UPSTREAM_URL
 * / PROXY_UPSTREAM_MODEL from deploy/global-images/.env); the key is read
 * from the proxy's config file at call time and never written anywhere.
 *
 * Usage:
 *   node evaluation/author/assess.mjs --pack=F --domain="…" --asset-claim="…" [--asset=ID]
 *        [--budget-chars=60000] [--model=…] [--out=F] [--dry-run]
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { checkAssessment } from "./check-citations.mjs";
import { parseArgs } from "./build-evidence-pack.mjs";

const REPO = resolve(dirname(new URL(import.meta.url).pathname), "../..");

function envValue(name) {
  const env = readFileSync(resolve(REPO, "deploy/global-images/.env"), "utf8");
  const m = env.match(new RegExp(`^${name}=(.*)$`, "m"));
  return m ? m[1].trim() : null;
}
/** The proxy's upstream key, read from its config file at call time. Never logged. */
function upstreamKey() {
  const cfg = readFileSync(resolve(REPO, "deploy/global-images/.proxy-config/config.yaml"), "utf8");
  const block = cfg.split(/^upstream:\s*$/m)[1] ?? "";
  const m = block.match(/^\s+apiKey:\s*"?([^"\n]+)"?\s*$/m);
  if (!m) throw new Error("upstream.apiKey not found in the proxy config");
  return m[1].trim();
}

/**
 * Select records for the prompt within a character budget: every persona,
 * skill and outcome record; L1 and L0 records ranked by keyword hits, then
 * recency. What was left out is listed, so a reader knows the model did not
 * see it.
 */
export function selectRecords(pack, { domain, keywords = [], budgetChars = 60000 }) {
  const terms = [...new Set([...keywords, ...domain.split(/\W+/)].map((t) => t.toLowerCase()).filter((t) => t.length >= 4))];
  const score = (r) => terms.reduce((n, t) => n + (r.text.toLowerCase().includes(t) ? 1 : 0), 0);
  const always = pack.records.filter((r) => ["persona", "skill", "outcome"].includes(r.kind));
  const ranked = pack.records.filter((r) => !["persona", "skill", "outcome"].includes(r.kind))
    .map((r) => ({ r, s: score(r) }))
    .sort((a, b) => b.s - a.s || String(b.r.at ?? "").localeCompare(String(a.r.at ?? "")))
    .map((x) => x.r);
  const chosen = [];
  let used = 0;
  for (const r of [...always, ...ranked]) {
    const len = r.text.length + r.record_id.length + 24;
    if (used + len > budgetChars && chosen.length > 0 && !["persona", "skill", "outcome"].includes(r.kind)) continue;
    chosen.push(r); used += len;
  }
  const chosenIds = new Set(chosen.map((r) => r.record_id));
  return { chosen: chosen.sort((a, b) => String(a.at ?? "").localeCompare(String(b.at ?? ""))), left_out: pack.records.filter((r) => !chosenIds.has(r.record_id)).map((r) => r.record_id), chars: used, terms };
}

export function buildPrompt({ pack, chosen, domain, assetClaim, assetId }) {
  const system = [
    "You assess a software team member's competence for ONE domain, using ONLY the records supplied.",
    "The records are the person's own history as the team's memory system holds it: persona lines, extracted memories (L1), raw conversation messages (L0), skills they wrote, and recorded outcomes of their assets.",
    "Rules:",
    "1. Every statement you make MUST cite record ids from the supplied records and include a `quote`: an exact, contiguous substring (at least 8 characters) copied verbatim from one of the cited records. Statements without a verifiable quote will be discarded by a program.",
    "2. Do not infer from absence. If the records say nothing about a point, say so in `summary` and do not claim it.",
    "3. `competence` for the domain: high = the records show the person doing this correctly and repeatedly; medium = some direct evidence; low = the records show mistakes or confusion in this domain; unknown = no usable evidence. Choose from the surviving evidence only.",
    "4. `asset_claim_check`: does the person's own record support, contradict, or say nothing (silent) about the asset claim below? Cite the record and quote it.",
    "5. Output JSON only, with exactly these keys and nothing else:",
    '   {"competence": "high" | "medium" | "low" | "unknown",',
    '    "domain": "<the domain as given>",',
    '    "claims": [{"statement": "...", "record_ids": ["<id>", ...], "quote": "<verbatim substring of a cited record>"}],',
    '    "counter_evidence": [{"statement": "...", "record_ids": ["<id>"], "quote": "..."}],',
    '    "asset_claim_check": {"verdict": "supports" | "contradicts" | "silent", "record_ids": ["<id>"], "quote": "<verbatim substring that shows it>"},',
    '    "summary": "<2-4 sentences>"}',
    "   `competence` is mandatory and must be one of the four words exactly. `asset_claim_check.verdict` must be one of the three words exactly.",
  ].join("\n");
  const records = chosen.map((r) => `### ${r.record_id}  [${r.kind}${r.meta?.type ? ` ${r.meta.type}` : ""}${r.meta?.role ? ` ${r.meta.role}` : ""}${r.at ? ` ${r.at}` : ""}]\n${r.text}`).join("\n\n");
  const user = [
    `Author: ${pack.author.user_id} (agent ${pack.author.agent_id}), team ${pack.author.team_id}.`,
    `Domain to assess: ${domain}`,
    `Asset claim to check${assetId ? ` (asset ${assetId})` : ""}: ${assetClaim}`,
    "",
    `Records (${chosen.length} of ${pack.record_count} in the pack; ids are the citation keys):`,
    "",
    records,
  ].join("\n");
  return { system, user };
}

export async function callModel({ url, model, key, system, user }) {
  const res = await fetch(`${url.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, temperature: 0, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`model ${res.status}: ${text.slice(0, 300)}`);
  const j = JSON.parse(text);
  const content = j.choices?.[0]?.message?.content ?? "";
  let parsed = null;
  try { parsed = JSON.parse(content); } catch { const m = content.match(/\{[\s\S]*\}/); if (m) { try { parsed = JSON.parse(m[0]); } catch { parsed = null; } } }
  return { content, parsed, usage: j.usage ?? null, model: j.model ?? model };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = parseArgs(process.argv.slice(2));
  if (!a.pack || !a.domain || !a["asset-claim"]) { console.error("usage: node assess.mjs --pack=F --domain=… --asset-claim=… [--asset=ID] [--budget-chars=N] [--model=M] [--out=F] [--dry-run]"); process.exit(2); }
  const pack = JSON.parse(readFileSync(a.pack, "utf8"));
  const budget = a["budget-chars"] ? Number(a["budget-chars"]) : 60000;
  const sel = selectRecords(pack, { domain: a.domain, keywords: pack.keywords ?? [], budgetChars: budget });
  const prompt = buildPrompt({ pack, chosen: sel.chosen, domain: a.domain, assetClaim: a["asset-claim"], assetId: a.asset ?? pack.asset_id ?? null });
  const url = envValue("PROXY_UPSTREAM_URL"); const model = a.model || envValue("PROXY_UPSTREAM_MODEL");
  const out = a.out || resolve(REPO, `evaluation/author/artifacts/assessment-${pack.author.letter}${a.asset ? `-${a.asset}` : ""}.json`);
  mkdirSync(dirname(out), { recursive: true });
  if (a["dry-run"]) {
    writeFileSync(out.replace(/\.json$/, ".prompt.txt"), `${prompt.system}\n\n---\n\n${prompt.user}\n`);
    console.log(`dry run: ${sel.chosen.length} record(s), ${sel.chars} chars, ${sel.left_out.length} left out → ${out.replace(/\.json$/, ".prompt.txt")}`);
    process.exit(0);
  }
  const res = await callModel({ url, model, key: upstreamKey(), system: prompt.system, user: prompt.user });
  const packMap = new Map(pack.records.map((r) => [r.record_id, r.text]));
  const verified = checkAssessment(res.parsed ?? {}, packMap);
  const assessedAt = new Date().toISOString();
  const doc = {
    schema: "author-assessment-v1",
    assessed_at: assessedAt,
    author: pack.author,
    asset_id: a.asset ?? pack.asset_id ?? null,
    domain: a.domain,
    asset_claim: a["asset-claim"],
    pack: { file: a.pack, sha256: pack.sha256, record_count: pack.record_count, shown: sel.chosen.length, left_out: sel.left_out, chars: sel.chars, terms: sel.terms },
    model: { url, model: res.model, usage: res.usage, temperature: 0 },
    raw_model_output: res.content,
    verified,
    // What the gate reads (metadata_json.gate.author_assessment).
    summary_for_gate: {
      competence: verified.competence,
      domain: a.domain,
      assessed_at: assessedAt,
      citations: verified.counts.citations,
      asset_claim_check: { verdict: verified.asset_claim_check.verdict, record_ids: verified.asset_claim_check.record_ids },
      pack_sha256: pack.sha256,
      assessment_file: out,
    },
  };
  writeFileSync(out, JSON.stringify(doc, null, 2) + "\n");
  const md = [
    `# Author assessment — ${pack.author.user_id} — ${a.domain}`, "",
    `assessed ${assessedAt} · model ${res.model} · pack ${pack.sha256.slice(0, 12)} (${sel.chosen.length}/${pack.record_count} records shown)`, "",
    `**Competence: ${verified.competence}**${verified.competence_downgraded ? ` (model said ${verified.competence_as_said}; downgraded — no surviving claim)` : ""}`,
    `**Asset claim check: ${verified.asset_claim_check.verdict}**${verified.asset_claim_check.record_ids.length ? ` — ${verified.asset_claim_check.record_ids.join(", ")}` : ""}${verified.asset_claim_check.quote ? ` — "${verified.asset_claim_check.quote}"` : ""}`, "",
    `Summary (model): ${verified.summary}`, "",
    `## Surviving claims (${verified.claims_kept.length})`,
    ...verified.claims_kept.map((c) => `- [${c.group}] ${c.statement}\n  - ${c.record_ids.join(", ")} — "${c.quote}"`),
    "", `## Dropped by the citation check (${verified.claims_dropped.length})`,
    ...verified.claims_dropped.map((c) => `- [${c.group}] ${c.statement} — ${c.reason}${c.record_ids.length ? ` (${c.record_ids.join(", ")})` : ""}`),
    "",
  ].join("\n");
  writeFileSync(out.replace(/\.json$/, ".md"), md);
  console.log(`competence=${verified.competence}${verified.competence_downgraded ? ` (said ${verified.competence_as_said})` : ""} asset_claim=${verified.asset_claim_check.verdict} kept=${verified.counts.kept} dropped=${verified.counts.dropped} → ${out}`);
}
