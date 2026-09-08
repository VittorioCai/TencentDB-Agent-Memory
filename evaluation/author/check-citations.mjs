/**
 * Verification of a context-based author assessment (v2, 2026-09-08b).
 *
 * The assessment is written by a model that has read the author's own
 * records. The model may say anything; this file decides what survives, and
 * then derives the conclusions itself. Two things are checked, apart:
 *
 *   1. the citation — every record id exists in the pack and the quote is a
 *      verbatim substring (after whitespace/case folding) of a cited record;
 *   2. the fact — what the cited record IS can carry the claim's type:
 *
 *        execution_result           only a proxy-observed call (call:) or a
 *                                   harness-verified outcome (outcome:), and
 *                                   the claimed outcome must agree with the
 *                                   record's own status; an assistant's
 *                                   narration is a report, not a result
 *        observed_operation         a raw message (l0:), a call, an outcome,
 *                                   or a derived memory (l1:) that has a
 *                                   traceable source
 *        environment_applicability  anything, persona (team principles, L3)
 *                                   included
 *        model_inference            anything cited; never counts
 *        coverage_unknown           no citation needed; never counts
 *
 *      and a claim that supports or contradicts the asset must quote the
 *      asset's own token (its address, its id) so it is about that asset.
 *
 * Conclusions are then rebuilt from the surviving claims, never taken from
 * the model. Execution results are counted per CALL, not per claim: a call
 * can carry many sentences and contributes one result. They are also kept
 * in three ledgers, because they say different things about the author:
 *
 *   own_business      the author's own operation with a business-level
 *                     result (a harness-verified outcome where the author
 *                     is the consumer)
 *   others_on_assets  someone else's use of the author's asset, verified
 *                     by the harness
 *   own_transport     the author's own call answered by upstream (an HTTP
 *                     status the proxy saw); a 2xx says the endpoint
 *                     answered, nothing about the business envelope
 *
 * Competence rests on the business ledgers only: none → unknown; failures
 * only → low; any success → medium. `high` is never derived — nothing here
 * is calibrated to say it — so a derived assessment cannot lower a
 * candidate's review priority. Failures beside successes are reported, not
 * subtracted. The asset-claim verdict comes from accepted supports /
 * contradicts claims; the summary from the counts. The model's own
 * competence and verdict are kept as "as said".
 *
 * Pure: no I/O. Used by assess.mjs; tested on its own.
 */

export const COMPETENCE = new Set(["high", "medium", "low", "unknown"]);
export const CLAIM_VERDICTS = new Set(["supports", "contradicts", "silent"]);
export const CLAIM_TYPES = new Set(["observed_operation", "execution_result", "environment_applicability", "model_inference", "coverage_unknown"]);
export const EXECUTION_CLASSES = new Set(["proxy_observed", "harness_verified", "tool_result"]);
export const OPERATION_CLASSES = new Set(["proxy_observed", "harness_verified", "tool_result", "user_instruction", "assistant_report", "derived_memory"]);

const fold = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/** Labels are the model's words; spelling variants fold onto the vocabulary. Evidence is never folded. */
export function normalizeVerdict(v) {
  const f = fold(v);
  if (/^contradict/.test(f)) return "contradicts";
  if (/^support/.test(f)) return "supports";
  if (/^silent|^none|^no evidence|^n\/a|^nothing/.test(f)) return "silent";
  return f;
}
export function normalizeCompetence(c) {
  const f = fold(c);
  if (f === "moderate" || f === "mid" || f === "average") return "medium";
  if (f === "" || f === "none" || f === "n/a" || f === "unknown" || f === "insufficient" || f === "not enough evidence") return "unknown";
  return f;
}
export function normalizeType(t) {
  const f = fold(t).replace(/[\s-]+/g, "_");
  if (/^exec|^result|^outcome/.test(f)) return "execution_result";
  if (/^observ|^operation|^action/.test(f)) return "observed_operation";
  if (/^env|^applic|^context/.test(f)) return "environment_applicability";
  if (/^infer|^model|^reason|^opinion/.test(f)) return "model_inference";
  if (/^coverage|^unknown|^absent|^gap|^missing/.test(f)) return "coverage_unknown";
  return f;
}
export function normalizeOutcome(o) {
  const f = fold(o);
  if (/^succ|^ok|^pass|^work/.test(f)) return "success";
  if (/^fail|^error|^timeout|^timed|^refus|^reject/.test(f)) return "failure";
  return f;
}

/** Does `quote` occur in `text`, after folding? Empty quotes never match. */
export function quoteFound(quote, text) {
  const q = fold(quote);
  if (q.length < 8) return false; // a few characters would match anything
  return fold(text).includes(q);
}

const KIND_PREFIXES = ["l0:", "l1:", "persona:", "skill:", "outcome:", "call:"];

/** A pack value may be a record ({text, kind, evidence_class, …}) or, in older callers and tests, the text alone. */
export function recordOf(pack, id) {
  const v = pack.get(id);
  if (v === undefined) return null;
  if (typeof v === "string") return { text: v, kind: id.split(":")[0], evidence_class: classFromKind(id.split(":")[0], null), meta: {} };
  return { text: v.text ?? "", kind: v.kind ?? id.split(":")[0], evidence_class: v.evidence_class ?? classFromKind(v.kind ?? id.split(":")[0], v.meta ?? null), meta: v.meta ?? {} };
}

/** What a record is, for the fact check, when the pack did not say. */
export function classFromKind(kind, meta) {
  switch (kind) {
    case "call": return "proxy_observed";
    case "outcome": return "harness_verified";
    case "l0": return meta?.role === "tool" ? "tool_result" : meta?.role === "user" ? "user_instruction" : "assistant_report";
    case "l1": return "derived_memory";
    case "persona": return "team_principles";
    case "skill": return "authored_text";
    default: return "unknown";
  }
}

/**
 * A record id is a key, not evidence. A model that writes `msg-1` for
 * `l0:msg-1` has dropped the kind prefix, not invented a record; the id is
 * resolved when exactly one pack key matches it with a prefix. Anything
 * ambiguous or absent stays unresolved and the claim is dropped.
 */
export function resolveRecordId(id, pack) {
  const s = String(id);
  if (pack.has(s)) return s;
  const withPrefix = KIND_PREFIXES.map((p) => p + s).filter((k) => pack.has(k));
  if (withPrefix.length === 1) return withPrefix[0];
  const suffix = [...pack.keys()].filter((k) => k.endsWith(":" + s));
  return suffix.length === 1 ? suffix[0] : null;
}

/**
 * Verify one citation against the pack: records exist, quote found.
 * @returns {{ ok: boolean, reason?: string, record_ids: string[], found_in?: string }}
 */
export function verifyCitation(item, pack) {
  const rawIds = Array.isArray(item?.record_ids) ? item.record_ids.map(String) : [];
  if (rawIds.length === 0) return { ok: false, reason: "no record cited", record_ids: [] };
  const ids = rawIds.map((id) => resolveRecordId(id, pack) ?? id);
  const missing = ids.filter((id) => !pack.has(id));
  if (missing.length) return { ok: false, reason: `cited record(s) not in the pack: ${missing.join(", ")}`, record_ids: ids };
  const quote = item?.quote;
  if (!quote || typeof quote !== "string") return { ok: false, reason: "no quote", record_ids: ids };
  const hits = ids.filter((id) => quoteFound(quote, recordOf(pack, id).text));
  if (hits.length === 0) return { ok: false, reason: "quote not found in any cited record", record_ids: ids };
  return { ok: true, record_ids: ids, found_in: hits[0], found_in_all: hits };
}

/**
 * The status a proxy-observed call or a harness outcome records, as
 * success / failure / null. For a proxy-observed call this is the HTTP
 * status the proxy saw from upstream: success means the request was
 * answered 2xx, which says the person reached and operated the endpoint;
 * an application-level refusal carried inside a 200 envelope (a 40401
 * body) is not visible here and is not claimed as such.
 */
export function recordedOutcome(rec) {
  if (!rec) return null;
  if (rec.evidence_class === "harness_verified") {
    const st = rec.meta?.state;
    return st === "validated" ? "success" : st === "corrected" ? "failure" : null;
  }
  if (rec.evidence_class === "proxy_observed") {
    const s = Number(rec.meta?.upstream_status ?? NaN);
    if (rec.meta?.reject_reason) return "failure";
    if (Number.isFinite(s) && s > 0) return s >= 200 && s < 300 ? "success" : "failure";
    return null; // a model_intent row: the model meant to call; nothing was observed
  }
  return null;
}

/**
 * The fact check for one claim: can the cited record carry a claim of this
 * type, and does the claim agree with what the record says?
 */
export function verifyFact(claim, pack, foundIn, assetTokens = [], assetId = null, assetVersion = null, assetContentHash = null) {
  const type = normalizeType(claim?.type);
  if (!CLAIM_TYPES.has(type)) return { ok: false, reason: `claim type "${claim?.type}" not in the vocabulary`, type };
  const rec = recordOf(pack, foundIn);
  const cls = rec.evidence_class;
  let outcome = null;
  if (type === "execution_result") {
    if (!EXECUTION_CLASSES.has(cls)) return { ok: false, reason: `an execution result needs a proxy-observed call or a harness-verified outcome; the quote is from ${cls} (${foundIn})`, type };
    outcome = normalizeOutcome(claim?.outcome);
    if (outcome !== "success" && outcome !== "failure") return { ok: false, reason: "an execution result must say success or failure", type };
    const recorded = recordedOutcome(rec);
    if (recorded === null) return { ok: false, reason: `${foundIn} records no result (intent only); it cannot carry an execution result`, type };
    if (recorded !== outcome) return { ok: false, reason: `claimed ${outcome} but ${foundIn} records ${recorded}`, type };
  } else if (type === "observed_operation") {
    if (!OPERATION_CLASSES.has(cls)) return { ok: false, reason: `an observed operation needs a message, a call or an outcome; the quote is from ${cls} (${foundIn})`, type };
    if (cls === "derived_memory" && rec.meta?.provenance === "source_unavailable") return { ok: false, reason: `${foundIn} is a derived memory with no traceable source; it cannot show an operation`, type };
  }
  let relation = claim?.relation_to_asset === undefined || claim?.relation_to_asset === null ? "silent" : normalizeVerdict(claim.relation_to_asset);
  if (!CLAIM_VERDICTS.has(relation)) return { ok: false, reason: `relation_to_asset "${claim?.relation_to_asset}" not in the vocabulary`, type };
  // A harness-verified outcome recorded ON the assessed asset is about that
  // asset by identity, and its state is the relation: corrected(wrong/stale)
  // contradicts what the asset asserts, validated supports it. The model's
  // label cannot override the record; a contrary label is dropped.
  if (assetId && cls === "harness_verified" && rec.meta?.asset_id === assetId && type === "execution_result") {
    const st = rec.meta?.state; const why = rec.meta?.corrected_reason;
    const byRecord = st === "validated" ? "supports" : st === "corrected" && (why === "wrong" || why === "stale") ? "contradicts" : null;
    // Core's own verdict on the row, carried in the pack (2026-09-08e).
    // Comparing versions and hashes a second time here is a second copy of
    // the rule, and a copy drifts; it is only computed locally when the
    // pack came from a Core that did not stamp the row, and then the record
    // says so. A retracted or untrusted row never reaches the pack.
    const bound = rec.meta?.bound ?? (
      !assetVersion ? "current"
      : rec.meta?.asset_version == null ? "unbound"
      : rec.meta.asset_version !== assetVersion ? "other_version"
      : !assetContentHash ? "current"
      : !rec.meta?.content_hash ? "unbound"
      : rec.meta.content_hash !== assetContentHash ? "other_version"
      : "current");
    // Superseded by a later result for the same call: the row is a record of
    // what happened, not the result of that call any more. Core decides this
    // (`final`), with the same collapse rule the gate uses.
    if (byRecord && rec.meta?.final === false) {
      return { ok: true, type, outcome, relation: "silent", strength: null,
        note: `${foundIn} was superseded by ${rec.meta?.superseded_by ?? "a later result"} for the same call; it is history and cannot support or contradict the asset` };
    }
    if (byRecord && bound === "current") {
      if (relation !== "silent" && relation !== byRecord) return { ok: false, reason: `labelled ${relation}, but ${foundIn} is a ${st}${why ? `(${why})` : ""} outcome on this very asset, which ${byRecord === "supports" ? "supports" : "contradicts"} it`, type };
      return { ok: true, type, outcome, relation: byRecord, strength: "strong", by_identity: true };
    }
    if (byRecord) {
      // An outcome on another version or another content of this asset is
      // about that text, not the one under assessment: the result stands,
      // the relation does not.
      const note = bound === "other_version"
        ? `${foundIn} is about version ${rec.meta.asset_version}${rec.meta.content_hash ? ` (${String(rec.meta.content_hash).slice(0, 10)})` : ""} of this asset, not version ${assetVersion}${assetContentHash ? ` (${String(assetContentHash).slice(0, 10)})` : ""}; it neither supports nor contradicts the current text`
        : `${foundIn} carries no ${rec.meta?.asset_version == null ? "version" : "content hash"}, so it cannot claim the text under assessment`;
      return { ok: true, type, outcome, relation: "silent", strength: null, note };
    }
  }
  let strength = null;
  if (relation !== "silent") {
    if (type === "model_inference" || type === "coverage_unknown") return { ok: false, reason: `a ${type} claim cannot support or contradict the asset`, type };
    if (assetId && rec.kind === "skill" && rec.meta?.skill_id === assetId) return { ok: false, reason: `${foundIn} is the asset's own text; it cannot support or contradict its own claim`, type };
    if (assetTokens.length > 0) {
      const hay = fold(rec.text);
      const q = fold(claim?.quote);
      // Exact: 10.244.7.19:9999 failing says nothing about 10.244.7.19:8096,
      // and a host alone does not name a host:port.
      const names = (text, t) => text.includes(t);
      const hit = assetTokens.find((t) => names(q, fold(t)) || names(hay, fold(t)));
      if (!hit) return { ok: false, reason: `claims to ${relation === "supports" ? "support" : "contradict"} the asset but neither the quote nor ${foundIn} names the asset's token (${assetTokens.join(", ")})`, type };
    }
    // Strong means a business result: the harness watched the asset be used
    // and recorded what came of it. A proxy 2xx says the endpoint answered
    // and nothing about whether the read succeeded or the task was done, so
    // transport evidence supports or contradicts at most weakly
    // (2026-09-08d) — it can never carry a claim on its own.
    strength = type === "execution_result" && cls === "harness_verified" ? "strong" : "weak";
    if (type === "execution_result" && cls !== "harness_verified") {
      return { ok: true, type, outcome, relation, strength, note: `${foundIn} is ${cls} — a transport observation; it can show the endpoint answered, not that the operation succeeded, so the relation is weak` };
    }
  }
  return { ok: true, type, outcome, relation, strength };
}

/** Which ledger a status record belongs to, for the author being assessed. */
export function ledgerOf(rec, authorId) {
  if (!rec) return "own_transport";
  if (rec.evidence_class === "harness_verified") return authorId && rec.meta?.consumer_user_id === authorId ? "own_business" : "others_on_assets";
  return "own_transport";
}

/**
 * Competence from distinct calls with a result, by ledger. Only business
 * results (the author's own, or others' on the author's assets) decide;
 * transport results are reported. `high` is never derived.
 */
export function deriveCompetence(execCalls) {
  const ledgers = { own_business: { success: 0, failure: 0 }, others_on_assets: { success: 0, failure: 0 }, own_transport: { success: 0, failure: 0 } };
  for (const c of execCalls) { const l = ledgers[c.ledger ?? "own_transport"]; if (c.outcome === "success") l.success += 1; else if (c.outcome === "failure") l.failure += 1; }
  const bSuccess = ledgers.own_business.success + ledgers.others_on_assets.success;
  const bFailure = ledgers.own_business.failure + ledgers.others_on_assets.failure;
  const success = bSuccess + ledgers.own_transport.success;
  const failure = bFailure + ledgers.own_transport.failure;
  const transportNote = ledgers.own_transport.success + ledgers.own_transport.failure ? `; transport: ${ledgers.own_transport.success} answered 2xx, ${ledgers.own_transport.failure} not (reported, not decisive)` : "";
  if (bSuccess + bFailure === 0) return { competence: "unknown", success, failure, ledgers, basis: `no business-level result${transportNote || "; no execution-grade claim survived"}` };
  if (bSuccess === 0) return { competence: "low", success, failure, ledgers, basis: `${bFailure} business-level failure(s), no success (own ${ledgers.own_business.failure}, others on the author's assets ${ledgers.others_on_assets.failure})${transportNote}` };
  return { competence: "medium", success, failure, ledgers, basis: `${bSuccess} business-level success(es) (own ${ledgers.own_business.success}, others on the author's assets ${ledgers.others_on_assets.success})${bFailure ? `, ${bFailure} failure(s) beside them` : ""}${transportNote}; high is not derived without calibration` };
}

/**
 * @param raw     the model's parsed JSON output
 * @param pack    Map<record_id, record | text>
 * @param opts    { assetTokens?: string[] }
 */
export function checkAssessment(raw, pack, opts = {}) {
  const assetTokens = Array.isArray(opts.assetTokens) ? opts.assetTokens.filter(Boolean) : [];
  const claims = Array.isArray(raw?.claims) ? raw.claims : [];
  const counter = Array.isArray(raw?.counter_evidence) ? raw.counter_evidence : [];
  // The model's asset_claim_check is one more claim about the asset.
  const acc = raw?.asset_claim_check && typeof raw.asset_claim_check === "object" ? raw.asset_claim_check : null;
  const accAsClaim = acc && normalizeVerdict(acc.verdict) !== "silent"
    ? [{ statement: `asset claim check: ${acc.verdict}`, record_ids: acc.record_ids, quote: acc.quote, type: acc.type ?? "observed_operation", outcome: acc.outcome, relation_to_asset: acc.verdict }]
    : [];
  const assetId = opts.assetId ?? null;
  const assetVersion = opts.assetVersion ?? null;
  const assetContentHash = opts.assetContentHash ?? null;
  const authorId = opts.authorId ?? null;
  const kept = [], dropped = [];
  for (const [group, list] of [["claim", claims], ["counter_evidence", counter], ["asset_claim_check", accAsClaim]]) {
    for (const c of list) {
      const type = normalizeType(c?.type);
      const row = { group, statement: String(c?.statement ?? ""), record_ids: [], quote: c?.quote ?? null, type, outcome: null, relation: "silent", strength: null };
      if (type === "coverage_unknown") { kept.push({ ...row, found_in: null, note: "statement of absence; not evidence" }); continue; }
      const v = verifyCitation(c, pack);
      row.record_ids = v.record_ids;
      if (!v.ok) { dropped.push({ ...row, reason: v.reason }); continue; }
      // The quote may sit in several cited records (a model_intent row and
      // the bridge_call that followed it); the claim stands on the first
      // one that can carry it, and is dropped only if none can.
      // For an execution result the status must come from a record that
      // answered the quoted command: the quoted record itself when it carries
      // a status, or the bridge_call the pack paired with the quoted intent.
      // A cited call that answered some other command cannot be borrowed —
      // two calls are not one success. With no such record the sentence is
      // kept as an observed operation (intent), never as a result.
      const isExec = normalizeType(c?.type) === "execution_result";
      const candidates = isExec
        ? [...new Set(v.found_in_all.flatMap((id) => { const r = recordOf(pack, id); const paired = r.meta?.paired_call; return paired && v.record_ids.includes(paired) ? [id, paired] : [id]; }))]
        : v.found_in_all;
      let f = null; let foundIn = null;
      for (const id of candidates) {
        const t = verifyFact(c, pack, id, assetTokens, assetId, assetVersion, assetContentHash);
        if (t.ok) { f = t; foundIn = id; break; }
        if (!f) f = t;
      }
      if (!f.ok && isExec && /intent only|needs a proxy-observed call/.test(f.reason)) {
        const asOp = verifyFact({ ...c, type: "observed_operation", relation_to_asset: "silent" }, pack, v.found_in, assetTokens, assetId, assetVersion, assetContentHash);
        if (asOp.ok) { kept.push({ ...row, type: "observed_operation", outcome: null, relation: "silent", strength: null, found_in: v.found_in, evidence_class: recordOf(pack, v.found_in).evidence_class, downgraded_from: "execution_result", note: `kept as intent: ${f.reason}` }); continue; }
      }
      if (!f.ok) { dropped.push({ ...row, type: f.type, reason: f.reason }); continue; }
      kept.push({ ...row, type: f.type, outcome: f.outcome, relation: f.relation, strength: f.strength, by_identity: f.by_identity ?? false, note: f.note ?? null, found_in: foundIn, evidence_class: recordOf(pack, foundIn).evidence_class });
    }
  }
  // One call, one result: several sentences on the same status record count once.
  const execClaims = kept.filter((k) => k.type === "execution_result");
  const byCall = new Map();
  for (const k of execClaims) if (!byCall.has(k.found_in)) byCall.set(k.found_in, k);
  // The business ledgers are read from the pack's harness records
  // themselves — they are structured (state, consumer, asset, call) and do
  // not depend on which of them the model happened to cite. Cited claims
  // still carry the transport ledger and the relation to the asset.
  // Only when the author is known: a harness row is "the author's own" or
  // "others' on the author's asset" relative to that author.
  const harness = authorId ? [...pack.keys()].map((id) => ({ id, rec: recordOf(pack, id) })).filter(({ rec }) => rec.evidence_class === "harness_verified" && recordedOutcome(rec)) : [];
  // One call counts once, as what it FINALLY came to: a call recorded
  // `used`, then `validated`, then `corrected` is one corrected call, not a
  // success beside a failure. Which row that is comes from Core (`final`),
  // the same answer the gate and the relation check above use — the ledger
  // deciding it separately is how the two came apart (2026-09-08f). The
  // local fallback is for a pack built against a Core without the field.
  const stamped = harness.some(({ rec }) => rec.meta?.final !== undefined && rec.meta?.final !== null);
  let ledgerRows;
  if (stamped) {
    ledgerRows = harness.filter(({ rec }) => rec.meta.final !== false)
      .map(({ id, rec }) => ({ found_in: id, outcome: recordedOutcome(rec), ledger: ledgerOf(rec, authorId), from: "core" }));
  } else {
    const byCallFinal = new Map();
    const stamp = (rec) => String(rec.meta?.recorded_at ?? rec.at ?? "");
    for (const { id, rec } of harness) {
      const key = rec.meta?.call_id ? `call:${rec.meta.call_id}` : id;
      const prev = byCallFinal.get(key);
      if (!prev || stamp(rec) >= stamp(prev.rec)) byCallFinal.set(key, { id, rec });
    }
    ledgerRows = [...byCallFinal.values()].map(({ id, rec }) => ({ found_in: id, outcome: recordedOutcome(rec), ledger: ledgerOf(rec, authorId), from: "pack" }));
  }
  const supersededCalls = harness.length - ledgerRows.length;
  // Cited calls carry the transport ledger; with no author known, cited
  // harness rows are read as others' results (the pack ledger did not run).
  const transport = [...byCall.values()].filter((k) => recordOf(pack, k.found_in).evidence_class !== "harness_verified").map((k) => ({ ...k, ledger: "own_transport", from: "cited" }));
  const citedHarness = authorId ? [] : [...byCall.values()].filter((k) => recordOf(pack, k.found_in).evidence_class === "harness_verified").map((k) => ({ ...k, ledger: "others_on_assets", from: "cited" }));
  const execCalls = [...ledgerRows, ...citedHarness, ...transport];
  const derived = deriveCompetence(execCalls);
  const saidRaw = normalizeCompetence(raw?.competence);
  const said = COMPETENCE.has(saidRaw) ? saidRaw : "unknown";

  const about = kept.filter((k) => k.relation !== "silent");
  const contradicts = about.filter((k) => k.relation === "contradicts");
  const supports = about.filter((k) => k.relation === "supports");
  const pick = (list) => list.find((k) => k.strength === "strong") ?? list[0];
  let assetClaim;
  const basisOf = (list) => [...new Set(list.map((k) => k.found_in))];
  if (contradicts.length) { const c = pick(contradicts); assetClaim = { verdict: "contradicts", record_ids: c.record_ids, quote: c.quote, strength: c.strength, basis: basisOf(contradicts) }; }
  else if (supports.length) { const s = pick(supports); assetClaim = { verdict: "supports", record_ids: s.record_ids, quote: s.quote, strength: s.strength, basis: basisOf(supports) }; }
  else assetClaim = { verdict: "silent", record_ids: [], quote: null, strength: null, basis: [], reason: acc ? "nothing accepted supports or contradicts the asset" : "not asserted" };
  const accSaid = acc ? normalizeVerdict(acc.verdict) : null;

  const summary = [
    `competence ${derived.competence}: ${derived.basis}`,
    `asset claim ${assetClaim.verdict}${assetClaim.basis.length ? ` on ${assetClaim.basis.join(", ")} (${assetClaim.strength})` : ""}`,
    `${kept.filter((k) => k.type !== "coverage_unknown").length} claim(s) kept, ${dropped.length} dropped${dropped.length ? ` (${[...new Set(dropped.map((d) => d.reason.split(";")[0].split(":")[0]))].join("; ")})` : ""}`,
  ].join(". ") + ".";

  return {
    competence: derived.competence,
    competence_basis: derived.basis,
    competence_as_said: said,
    competence_downgraded: derived.competence !== said,
    execution_claims: { success: derived.success, failure: derived.failure, calls: execCalls.length, ledgers: derived.ledgers, harness_records: ledgerRows.length, superseded_by_a_later_row: supersededCalls, cited_transport_calls: transport.length },
    asset_claim_check: assetClaim,
    asset_claim_as_said: accSaid,
    claims_kept: kept,
    claims_dropped: dropped,
    counts: { claims: claims.length, counter_evidence: counter.length, kept: kept.length, dropped: dropped.length, citations: kept.filter((k) => k.group === "claim" && k.type !== "coverage_unknown").length, execution: execClaims.length },
    summary,
    summary_as_said: typeof raw?.summary === "string" ? raw.summary : "",
  };
}
