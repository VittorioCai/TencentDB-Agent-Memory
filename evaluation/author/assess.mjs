/**
 * Context-based author assessment (v2, 2026-09-08b).
 *
 * Reads an evidence pack (build-evidence-pack.mjs), asks a model to read it
 * and write typed, cited claims, and keeps only what check-citations.mjs
 * can verify — the citation AND the fact. The conclusions the gate reads
 * (competence, the asset-claim verdict) are derived by the checker from the
 * surviving claims; the model's own labels are kept beside them as "as
 * said". The evidence cutoff travels from the pack into the assessment.
 *
 * The model is a reader, not a witness. What it may say about the author
 * having done something successfully must rest on a record that observed
 * it — a proxy-logged call, a harness-verified outcome — never on the
 * author's own narration.
 *
 * The model endpoint is the same upstream the proxy uses (PROXY_UPSTREAM_URL
 * / PROXY_UPSTREAM_MODEL from deploy/global-images/.env); the key is read
 * from the proxy's config file at call time and never written anywhere.
 *
 * Usage:
 *   node evaluation/author/assess.mjs --pack=F --domain="…" --asset-claim="…" [--asset=ID]
 *        [--budget-chars=60000] [--model=…] [--out=F] [--dry-run] [--recheck=F [--allow-pack-change]]
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
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

const ALWAYS = new Set(["persona", "skill", "outcome", "call"]);

/**
 * Select records for the prompt within a character budget: every persona,
 * skill, outcome and call record; L1 and L0 records ranked by keyword hits,
 * then recency. What was left out is listed, so a reader knows the model
 * did not see it.
 */
export function selectRecords(pack, { domain, keywords = [], budgetChars = 60000 }) {
  const terms = [...new Set([...keywords, ...domain.split(/\W+/)].map((t) => t.toLowerCase()).filter((t) => t.length >= 4))];
  const score = (r) => terms.reduce((n, t) => n + (r.text.toLowerCase().includes(t) ? 1 : 0), 0);
  const always = pack.records.filter((r) => ALWAYS.has(r.kind));
  const ranked = pack.records.filter((r) => !ALWAYS.has(r.kind))
    .map((r) => ({ r, s: score(r) }))
    .sort((a, b) => b.s - a.s || String(b.r.at ?? "").localeCompare(String(a.r.at ?? "")))
    .map((x) => x.r);
  const chosen = [];
  let used = 0;
  for (const r of [...always, ...ranked]) {
    const len = r.text.length + r.record_id.length + 40;
    if (used + len > budgetChars && chosen.length > 0 && !ALWAYS.has(r.kind)) continue;
    chosen.push(r); used += len;
  }
  const chosenIds = new Set(chosen.map((r) => r.record_id));
  return { chosen: chosen.sort((a, b) => String(a.at ?? "").localeCompare(String(b.at ?? ""))), left_out: pack.records.filter((r) => !chosenIds.has(r.record_id)).map((r) => r.record_id), chars: used, terms };
}

export function buildPrompt({ pack, chosen, domain, assetClaim, assetId }) {
  const tokens = pack.asset?.tokens?.length ? pack.asset.tokens.join(", ") : "(none known)";
  const system = [
    "You assess a software team member's competence for ONE domain, using ONLY the records supplied. A program will verify every claim you make, and will derive the conclusions itself from the claims that survive; your job is to find and cite the evidence precisely.",
    "Each record has an id and an evidence class in its header:",
    "  proxy_observed      a call the proxy itself logged from the person's session, with the upstream HTTP status — an observed result at the transport level (a 2xx says the endpoint answered; an application-level refusal inside a 200 body is not visible here)",
    "  harness_verified    an outcome the evaluation harness recorded and verified on an asset the person authored — an observed result; a corrected(wrong) outcome on the asset under assessment contradicts it, a validated one supports it",
    "  user_instruction    what the person (or their operator) typed to the assistant",
    "  assistant_report    what the assistant said — a narration, NOT a result; it may describe a command that failed or never ran",
    "  derived_memory      a summary the memory system extracted; provenance says whether a source message is traceable",
    "  team_principles     a persona line: the team's working principles stored per team+agent, not the person's own record",
    "  authored_text       a skill the person's agent owns (the writer of each version is unknown)",
    "Write claims of these types:",
    "  execution_result           the person's operation succeeded or failed — cite ONLY proxy_observed or harness_verified records, and set `outcome` to success or failure exactly as the record shows. Cite the bridge_call row that answered the command (the pack pairs it with the model_intent row: `paired_call`); a call that answered a different command is not this command's result",
    "  (the program counts results per call, not per sentence, and keeps the author's own business results, others' results on the author's assets, and transport-only 2xx apart; it never derives `high` competence)",
    "  observed_operation         the person did or asked for something — cite a message, a call, an outcome, or a derived memory with a traceable source",
    "  environment_applicability  where/when something applies (which network, which environment) — any record",
    "  model_inference            your own reading; cite what you infer from",
    "  coverage_unknown           what the records do not cover; no citation",
    "Rules:",
    "1. Every claim except coverage_unknown MUST cite record ids and include `quote`: an exact, contiguous substring (at least 8 characters) copied verbatim from one of the cited records.",
    `2. If a claim supports or contradicts the asset claim below, set relation_to_asset to supports or contradicts; the quote must then contain one of the asset's own tokens: ${tokens}. Otherwise leave it silent. A harness_verified record whose text names one of those tokens (a corrected(wrong) or validated outcome on an asset carrying that token) is the strongest such evidence: cite it as an execution_result with the outcome it records and the relation it implies — not as a model_inference, which can never support or contradict.`,
    "3. Do not infer from absence. Do not turn a narration into a result: an assistant saying a command failed is a report about that command, not evidence the person cannot do it, and an assistant saying something worked is not evidence it did.",
    "4. Also give your own overall reading in `competence` and `asset_claim_check`; the program will derive its own and keep yours beside it.",
    "5. Output JSON only, with exactly these keys:",
    '   {"competence": "high" | "medium" | "low" | "unknown",',
    '    "domain": "<the domain as given>",',
    '    "claims": [{"statement": "...", "type": "<one of the five>", "outcome": "success" | "failure" | null, "record_ids": ["<id>", ...], "quote": "<verbatim substring>", "relation_to_asset": "supports" | "contradicts" | "silent"}],',
    '    "counter_evidence": [{"statement": "...", "type": "...", "outcome": ..., "record_ids": ["<id>"], "quote": "...", "relation_to_asset": "..."}],',
    '    "asset_claim_check": {"verdict": "supports" | "contradicts" | "silent", "type": "...", "outcome": ..., "record_ids": ["<id>"], "quote": "<verbatim substring that shows it>"},',
    '    "summary": "<2-4 sentences>"}',
  ].join("\n");
  const records = chosen.map((r) => `### ${r.record_id}  [${r.kind} · ${r.evidence_class}${r.meta?.type ? ` · ${r.meta.type}` : ""}${r.meta?.role ? ` · ${r.meta.role}` : ""}${r.meta?.provenance ? ` · ${r.meta.provenance}` : ""}${r.meta?.kind ? ` · ${r.meta.kind}` : ""}${r.meta?.upstream_status != null ? ` · status ${r.meta.upstream_status}` : ""}${r.meta?.paired_call ? ` · paired_call ${r.meta.paired_call}` : ""}${r.meta?.paired_intent ? ` · answers ${r.meta.paired_intent}` : ""}${r.meta?.pairing && r.meta.pairing !== "paired" ? ` · ${r.meta.pairing}` : ""}${r.meta?.asset_version != null && r.kind === "outcome" ? ` · v${r.meta.asset_version}` : ""}${r.at ? ` · ${r.at}` : ""}]\n${r.text}`).join("\n\n");
  const user = [
    `Author: ${pack.author.user_id} (agent ${pack.author.agent_id}), team ${pack.author.team_id}.`,
    `Domain to assess: ${domain}`,
    `Asset claim to check${assetId ? ` (asset ${assetId}${pack.asset?.version ? ` v${pack.asset.version}` : ""})` : ""}: ${assetClaim}`,
    `Evidence cutoff: ${pack.evidence_cutoff} — every record below is dated at or before it.`,
    pack.chain ? `Related evidence around v${pack.chain.asset_version}: wrote_this_version ${pack.chain.producer?.wrote_this_version ?? "unknown"} / agent ${pack.chain.producer?.owner_agent_id ?? "?"}; sessions ${pack.chain.collected?.source_sessions ?? 0}; operations ${pack.chain.collected?.operations ?? 0}; results ${pack.chain.collected?.results ?? 0}. Production link: UNPROVEN — ${pack.chain.production_note ?? "adjacency between records is not verified"}${(pack.chain.gaps ?? []).length ? `. Gaps: ${pack.chain.gaps.join("; ")}` : ""}` : null,
    pack.pairing ? `Call pairing: ${pack.pairing.paired} result(s) tied to their command, ${pack.pairing.ambiguous} ambiguous, ${pack.pairing.unpaired} unpaired, ${pack.pairing.intents_without_result} command(s) with no observed result.` : "",
    "",
    `Records (${chosen.length} of ${pack.record_count} in the pack; ids are the citation keys):`,
    "",
    records,
  ].filter((l) => l !== "").join("\n");
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

/** What the gate reads (asset/gate/assessment → metadata_json.gate.author_assessment). */
export function summaryForGate({ pack, verified, domain, assessedAt, outFile }) {
  return {
    schema: "author-assessment-summary-v2",
    competence: verified.competence,
    competence_as_said: verified.competence_as_said,
    domain,
    assessed_at: assessedAt,
    evidence_cutoff: pack.evidence_cutoff,
    citations: verified.counts.citations,
    execution_claims: { success: verified.execution_claims.success, failure: verified.execution_claims.failure, calls: verified.execution_claims.calls, ledgers: verified.execution_claims.ledgers },
    asset_claim_check: { verdict: verified.asset_claim_check.verdict, record_ids: verified.asset_claim_check.record_ids, strength: verified.asset_claim_check.strength ?? null },
    asset_claim_as_said: verified.asset_claim_as_said,
    author_user_id: pack.author.user_id,
    asset_version: pack.asset?.version ?? null,
    content_hash: pack.asset?.content_hash ?? null,
    // 2026-09-12 第二人复核之后没有 `complete` 这个概念了:写进 Core 的摘要也不能留一个恒为 null
    // 的 chain_complete,那会被读成"完整性未知"。改成把实际事实写清楚。
    chain_production_link: pack.chain?.production_link ?? null,
    chain_writer_known: pack.chain?.writer_known ?? null,
    chain_collected: pack.chain?.collected ?? null,
    chain_gaps: (pack.chain?.gaps ?? []).length || 0,
    pack_sha256: pack.sha256,
    assessment_file: outFile,
  };
}

function renderMd({ pack, verified, domain, assessedAt, modelName, sel }) {
  return [
    `# Author assessment — ${pack.author.user_id} — ${domain}`, "",
    `assessed ${assessedAt} · evidence cutoff ${pack.evidence_cutoff} · model ${modelName} · pack ${pack.sha256.slice(0, 12)} (${sel.chosen.length}/${pack.record_count} records shown; classes ${JSON.stringify(pack.by_class)})`, "",
    `**Competence: ${verified.competence}** — ${verified.competence_basis} (model said ${verified.competence_as_said})`,
    `**Asset claim check: ${verified.asset_claim_check.verdict}**${verified.asset_claim_check.strength ? ` (${verified.asset_claim_check.strength})` : ""}${verified.asset_claim_check.record_ids.length ? ` — ${verified.asset_claim_check.record_ids.join(", ")}` : ""}${verified.asset_claim_check.quote ? ` — "${verified.asset_claim_check.quote}"` : ""} (model said ${verified.asset_claim_as_said ?? "nothing"})`, "",
    `Derived summary: ${verified.summary}`, "",
    `Model summary (as said): ${verified.summary_as_said}`, "",
    pack.chain ? `Related evidence (v${pack.chain.asset_version}): wrote_this_version ${pack.chain.producer?.wrote_this_version ?? "unknown"} / agent ${pack.chain.producer?.owner_agent_id ?? "?"}; sessions ${pack.chain.collected?.source_sessions ?? 0}; operations ${pack.chain.collected?.operations ?? 0}; results ${pack.chain.collected?.results ?? 0}; production link UNPROVEN (adjacency between records not verified)${(pack.chain.gaps ?? []).length ? `; gaps: ${pack.chain.gaps.join(" | ")}` : ""}` : "",
    "",
    `## Surviving claims (${verified.claims_kept.length})`,
    ...verified.claims_kept.map((c) => `- [${c.group} · ${c.type}${c.outcome ? ` · ${c.outcome}` : ""}${c.relation !== "silent" ? ` · ${c.relation} (${c.strength})` : ""}] ${c.statement}${c.found_in ? `\n  - ${c.record_ids.join(", ")} (${c.evidence_class}) — "${c.quote}"` : ""}`),
    "", `## Dropped by the check (${verified.claims_dropped.length})`,
    ...verified.claims_dropped.map((c) => `- [${c.group} · ${c.type}] ${c.statement} — ${c.reason}${c.record_ids.length ? ` (${c.record_ids.join(", ")})` : ""}`),
    "",
  ].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = parseArgs(process.argv.slice(2));
  if (!a.pack || !a.domain || !a["asset-claim"]) { console.error("usage: node assess.mjs --pack=F --domain=… --asset-claim=… [--asset=ID] [--budget-chars=N] [--model=M] [--out=F] [--dry-run] [--recheck=F [--allow-pack-change]]"); process.exit(2); }
  const pack = JSON.parse(readFileSync(a.pack, "utf8"));
  if (pack.schema !== "author-evidence-pack-v2") { console.error(`pack schema ${pack.schema}: rebuild it with build-evidence-pack.mjs (v2 carries evidence classes and the cutoff)`); process.exit(1); }
  const packMap = new Map(pack.records.map((r) => [r.record_id, r]));
  const opts = { assetTokens: pack.asset?.tokens ?? [], assetId: pack.asset_id ?? null, assetVersion: pack.asset?.version ?? null, assetContentHash: pack.asset?.content_hash ?? null, authorId: pack.author?.user_id ?? null };
  // --recheck=F: re-run the check on a saved assessment's raw model output
  // (after a checker change) without another model call; the pack must be
  // the one the assessment was made from.
  if (a.recheck) {
    const prev = JSON.parse(readFileSync(a.recheck, "utf8"));
    // The pack must be the one the assessment was made from — unless it was
    // rebuilt on purpose because the BUILDER changed (2026-09-08d: outcome
    // records gained the content hash and the retraction, and retracted rows
    // left the pack). Then both shas are recorded, so the recheck says which
    // evidence it read.
    if (prev.pack?.sha256 !== pack.sha256) {
      if (!a["allow-pack-change"]) { console.error(`recheck: pack sha mismatch (${prev.pack?.sha256} vs ${pack.sha256}); pass --allow-pack-change if the pack was deliberately rebuilt`); process.exit(1); }
      prev.pack_sha_at_generation = prev.pack?.sha256 ?? null;
      prev.pack_rebuilt = true;
      prev.pack = { ...(prev.pack ?? {}), sha256: pack.sha256, records: pack.records.length };
    }
    let raw = {}; try { raw = JSON.parse(prev.raw_model_output); } catch { raw = {}; }
    const verified = checkAssessment(raw, packMap, opts);
    prev.verified = verified;
    // 包里的 chain 快照也跟着更新:否则评估文件里留着旧形状(operator: unknown、complete),
    // 与包本身矛盾(2026-09-12 第二人复核)。
    if (pack.chain) prev.chain = pack.chain;
    prev.rechecked_at = new Date().toISOString();
    prev.summary_for_gate = summaryForGate({ pack, verified, domain: prev.domain, assessedAt: prev.assessed_at, outFile: a.recheck });
    writeFileSync(a.recheck, JSON.stringify(prev, null, 2) + "\n");
    writeFileSync(a.recheck.replace(/\.json$/, ".md"), renderMd({ pack, verified, domain: prev.domain, assessedAt: prev.assessed_at, modelName: prev.model?.model ?? "?", sel: { chosen: { length: prev.pack?.shown ?? 0 } } }));
    console.log(`recheck: competence=${verified.competence} (said ${verified.competence_as_said}) asset_claim=${verified.asset_claim_check.verdict} kept=${verified.counts.kept} dropped=${verified.counts.dropped} → ${a.recheck}`);
    process.exit(0);
  }
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
  const verified = checkAssessment(res.parsed ?? {}, packMap, opts);
  const assessedAt = new Date().toISOString();
  const doc = {
    schema: "author-assessment-v2",
    assessed_at: assessedAt,
    evidence_cutoff: pack.evidence_cutoff,
    author: pack.author,
    asset_id: a.asset ?? pack.asset_id ?? null,
    asset: pack.asset ?? null,
    chain: pack.chain ?? null,
    domain: a.domain,
    asset_claim: a["asset-claim"],
    pack: { file: a.pack, sha256: pack.sha256, record_count: pack.record_count, by_class: pack.by_class, excluded: pack.excluded, shown: sel.chosen.length, left_out: sel.left_out, chars: sel.chars, terms: sel.terms },
    model: { url, model: res.model, usage: res.usage, temperature: 0 },
    raw_model_output: res.content,
    verified,
    summary_for_gate: summaryForGate({ pack, verified, domain: a.domain, assessedAt, outFile: out }),
  };
  writeFileSync(out, JSON.stringify(doc, null, 2) + "\n");
  writeFileSync(out.replace(/\.json$/, ".md"), renderMd({ pack, verified, domain: a.domain, assessedAt, modelName: res.model, sel }));
  console.log(`competence=${verified.competence} (said ${verified.competence_as_said}; ${verified.competence_basis}) asset_claim=${verified.asset_claim_check.verdict}${verified.asset_claim_check.strength ? `/${verified.asset_claim_check.strength}` : ""} (said ${verified.asset_claim_as_said}) kept=${verified.counts.kept} dropped=${verified.counts.dropped} → ${out}`);
}
