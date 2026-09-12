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
/**
 * 受限事实句:只用记录里的结构化字段造句,不碰模型那句话的语义(2026-09-12 第三轮复核)。
 *
 * 复核的反例:引文属实、状态属实、资产绑定属实,声明却是"作者不具备部署能力,而且这个地址在
 * 任何环境都不能工作"——程序核的是引用真实性、结果类型一致性和资产关联,**核不了**这句话的
 * 语义与适用范围。所以输出里把两件事分开摆:`fact_sentence` 是程序从记录造的句子,
 * `model_statement` 是模型的原话,属推断。null 表示这条记录没有可造句的结构化事实。
 */
export function factSentence(rec, foundIn) {
  if (!rec || typeof rec !== "object") return null;
  const m = rec.meta ?? {};
  if (rec.evidence_class === "harness_verified" && m.state) {
    const bits = [`Core 结果记录 ${foundIn ?? ""}`.trim(), `资产 ${m.asset_id ?? "?"}${m.asset_version != null ? ` v${m.asset_version}` : ""}`, `state=${m.state}${m.corrected_reason ? `(${m.corrected_reason})` : ""}`];
    if (m.consumer_user_id) bits.push(`消费者 ${m.consumer_user_id}`);
    if (m.call_id) bits.push(`call ${m.call_id}`);
    if (m.recorded_at ?? rec.at) bits.push(String(m.recorded_at ?? rec.at));
    if (m.final === false) bits.push("已被同一调用的后续结果取代");
    return bits.join(",");
  }
  if (rec.evidence_class === "proxy_observed") {
    const st = m.upstream_status;
    const bits = [`proxy 观察 ${foundIn ?? ""}`.trim(), m.kind ? `kind=${m.kind}` : null, Number.isFinite(Number(st)) && Number(st) > 0 ? `upstream_status=${st}` : "没有观察到上游响应(model_intent)"];
    if (m.reject_reason) bits.push(`reject_reason=${m.reject_reason}`);
    if (rec.at) bits.push(String(rec.at));
    return bits.filter(Boolean).join(",");
  }
  return null;
}

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
  // Superseded by a later result for the same call: the row records what
  // happened and is no longer the result of that call, so nothing rests on
  // it — whatever asset is being judged. Core decides this (`final`), with
  // the same collapse rule the gate uses.
  //
  // This check used to sit inside the same-asset branch below, so judging a
  // DIFFERENT asset that documents the same address skipped it entirely and
  // the row fell through to the generic token match as contradicts/strong —
  // while the ledger, which does honour `final`, counted only the later
  // success. Ledger and prose split (2026-09-08i). Finality is a property of
  // the row, not of which asset happens to be under assessment.
  if (cls === "harness_verified" && rec.meta?.final === false) {
    return { ok: true, type, outcome, relation: "silent", strength: null,
      note: `${foundIn} was superseded by ${rec.meta?.superseded_by ?? "a later result"} for the same call; it is history and cannot support or contradict any asset` };
  }
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
    if (assetTokens.length === 0) {
      // 2026-09-12 第二人复核:原来没有判别值时整段跳过相关性检查——于是**别的资产**上一条
      // 真实的失败记录也能被说成"矛盾/强"。引文是真的,两件事无关。同资产同版本同内容的
      // 记录已在上面按身份关联并返回;走到这里的都不是,相关性无从验证,只能记 silent。
      return { ok: true, type, outcome, relation: "silent", strength: null,
        note: `相关性无法验证(relevance unverifiable):${foundIn} 不在被评估资产${assetId ? `(${assetId})` : ""}上,而该资产没有可用于核对的判别值(tokens 为空)。引文属实,但它支持或反驳的是别的东西,按 silent 记` };
    }
    {
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
export function deriveCompetence(execCalls, { assetId = null } = {}) {
  // 2026-09-12 第二人复核:等级原来统计作者的**全部**业务结果,不按被评估的领域筛选——
  // 39 条 bridge 地址结果也能把"退出码解析能力"读成 medium。评价范围不同,不是校准问题。
  // 现在只有**被评估资产上**的业务结果决定等级;其余留作历史,单独报,不参与定级。
  const inDomain = (c) => !assetId || c.asset_id === assetId;
  const history = { success: 0, failure: 0 };
  for (const c of execCalls) {
    if (inDomain(c)) continue;
    if (c.outcome === "success") history.success += 1; else if (c.outcome === "failure") history.failure += 1;
  }
  const scoped = execCalls.filter(inDomain);
  const ledgers = { own_business: { success: 0, failure: 0 }, others_on_assets: { success: 0, failure: 0 }, own_transport: { success: 0, failure: 0 } };
  for (const c of scoped) { const l = ledgers[c.ledger ?? "own_transport"]; if (c.outcome === "success") l.success += 1; else if (c.outcome === "failure") l.failure += 1; }
  const bSuccess = ledgers.own_business.success + ledgers.others_on_assets.success;
  const bFailure = ledgers.own_business.failure + ledgers.others_on_assets.failure;
  const success = bSuccess + ledgers.own_transport.success;
  const failure = bFailure + ledgers.own_transport.failure;
  const transportNote = ledgers.own_transport.success + ledgers.own_transport.failure ? `; transport: ${ledgers.own_transport.success} answered 2xx, ${ledgers.own_transport.failure} not (reported, not decisive)` : "";
  const domain_counts = { success: bSuccess, failure: bFailure };
  const history_counts = { ...history };
  const historyNote = assetId && (history.success + history.failure)
    ? `;该作者在其他资产上另有 ${history.success + history.failure} 条业务结果(${history.success} 成功 / ${history.failure} 纠错),属历史记录,与本次评估的领域不同,不参与定级`
    : "";
  const extra = { domain_counts, history_counts, scoped_to: assetId };
  if (bSuccess + bFailure === 0) return { competence: "unknown", success, failure, ledgers, ...extra, basis: `${assetId ? `被评估资产 ${assetId} 上没有业务结果` : "no business-level result"}${historyNote}${transportNote || (assetId ? "" : "; no execution-grade claim survived")}` };
  if (bSuccess === 0) return { competence: "low", success, failure, ledgers, ...extra, basis: `${bFailure} business-level failure(s), no success (own ${ledgers.own_business.failure}, others on the author's assets ${ledgers.others_on_assets.failure})${transportNote}${historyNote}` };
  return { competence: "medium", success, failure, ledgers, ...extra, basis: `${bSuccess} business-level success(es) (own ${ledgers.own_business.success}, others on the author's assets ${ledgers.others_on_assets.success})${bFailure ? `, ${bFailure} failure(s) beside them` : ""}${transportNote}; high is not derived without calibration${historyNote}` };
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
        if (asOp.ok) { kept.push({ ...row, fact_sentence: factSentence(recordOf(pack, v.found_in), v.found_in), model_statement: c?.statement ?? null, type: "observed_operation", outcome: null, relation: "silent", strength: null, found_in: v.found_in, evidence_class: recordOf(pack, v.found_in).evidence_class, downgraded_from: "execution_result", note: `kept as intent: ${f.reason}` }); continue; }
      }
      if (!f.ok) { dropped.push({ ...row, type: f.type, reason: f.reason }); continue; }
      kept.push({ ...row, fact_sentence: factSentence(recordOf(pack, foundIn), foundIn), model_statement: c?.statement ?? null, type: f.type, outcome: f.outcome, relation: f.relation, strength: f.strength, by_identity: f.by_identity ?? false, note: f.note ?? null, found_in: foundIn, evidence_class: recordOf(pack, foundIn).evidence_class });
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
      .map(({ id, rec }) => ({ found_in: id, outcome: recordedOutcome(rec), ledger: ledgerOf(rec, authorId), asset_id: rec.meta?.asset_id ?? null, from: "core" }));
  } else {
    const byCallFinal = new Map();
    const stamp = (rec) => String(rec.meta?.recorded_at ?? rec.at ?? "");
    for (const { id, rec } of harness) {
      // Keyed by asset too, as Core keys it. One call can carry results about
      // two assets — one row each — and that is still one call; collapsing
      // the rows together would let the result about one asset displace the
      // result about the other (2026-09-08h).
      const key = rec.meta?.call_id ? `${rec.meta.asset_id ?? "?"}|call:${rec.meta.call_id}` : id;
      const prev = byCallFinal.get(key);
      if (!prev || stamp(rec) >= stamp(prev.rec)) byCallFinal.set(key, { id, rec });
    }
    ledgerRows = [...byCallFinal.values()].map(({ id, rec }) => ({ found_in: id, outcome: recordedOutcome(rec), ledger: ledgerOf(rec, authorId), asset_id: rec.meta?.asset_id ?? null, from: "pack" }));
  }
  const supersededCalls = harness.length - ledgerRows.length;
  // Cited calls carry the transport ledger; with no author known, cited
  // harness rows are read as others' results (the pack ledger did not run).
  const transport = [...byCall.values()].filter((k) => recordOf(pack, k.found_in).evidence_class !== "harness_verified").map((k) => ({ ...k, ledger: "own_transport", from: "cited" }));
  const citedHarness = authorId ? [] : [...byCall.values()].filter((k) => recordOf(pack, k.found_in).evidence_class === "harness_verified").map((k) => ({ ...k, ledger: "others_on_assets", from: "cited" }));
  const execCalls = [...ledgerRows, ...citedHarness, ...transport];
  const derived = deriveCompetence(execCalls, { assetId });
  const saidRaw = normalizeCompetence(raw?.competence);
  const said = COMPETENCE.has(saidRaw) ? saidRaw : "unknown";

  const about = kept.filter((k) => k.relation !== "silent");
  const contradicts = about.filter((k) => k.relation === "contradicts");
  const supports = about.filter((k) => k.relation === "supports");
  const pick = (list) => list.find((k) => k.strength === "strong") ?? list[0];
  let assetClaim;
  const basisOf = (list) => [...new Set(list.map((k) => k.found_in))];
  // by_identity / note 一起带出来:同资产同版本按身份关联,和"引文里出现了判别值"不是一回事,
  // 读的人要能分开(2026-09-12 第二人复核)。
  if (contradicts.length) { const c = pick(contradicts); assetClaim = { verdict: "contradicts", record_ids: c.record_ids, quote: c.quote, strength: c.strength, by_identity: c.by_identity ?? false, note: c.note ?? null, basis: basisOf(contradicts) }; }
  else if (supports.length) { const s = pick(supports); assetClaim = { verdict: "supports", record_ids: s.record_ids, quote: s.quote, strength: s.strength, by_identity: s.by_identity ?? false, note: s.note ?? null, basis: basisOf(supports) }; }
  else {
    // silent 的理由要带上:被丢掉/中和的那条说了什么,读的人才知道是"没人提"还是"提了但无法验证相关性"。
    const neutralised = kept.find((k) => k.group === "asset_claim_check" && k.relation === "silent" && k.note) ?? kept.find((k) => k.relation === "silent" && k.note);
    assetClaim = { verdict: "silent", record_ids: [], quote: null, strength: null, by_identity: false, note: neutralised?.note ?? null, basis: [], reason: acc ? (neutralised?.note ?? "nothing accepted supports or contradicts the asset") : "not asserted" };
  }
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
    execution_claims: { success: derived.success, failure: derived.failure, calls: execCalls.length, ledgers: derived.ledgers, domain_counts: derived.domain_counts ?? null, cross_asset_history: derived.history_counts ?? null, scoped_to: derived.scoped_to ?? null, harness_records: ledgerRows.length, superseded_by_a_later_row: supersededCalls, cited_transport_calls: transport.length },
    // 程序核到哪一步,必须自己说清楚(2026-09-12 第三轮复核)
    scope_note: "程序核对的是:引用的记录存在、引文在记录里、结构化结果与声明的类型一致、与被评估资产的绑定关系。声明里自由文本的语义与适用范围(例如「作者不具备某能力」「在任何环境都不成立」)不在核对范围内——每条保留的声明都附了程序从记录造的 fact_sentence,模型原话在 model_statement 里,按推断读。",
    asset_claim_check: assetClaim,
    asset_claim_as_said: accSaid,
    claims_kept: kept,
    claims_dropped: dropped,
    counts: { claims: claims.length, counter_evidence: counter.length, kept: kept.length, dropped: dropped.length, citations: kept.filter((k) => k.group === "claim" && k.type !== "coverage_unknown").length, execution: execClaims.length },
    summary,
    summary_as_said: typeof raw?.summary === "string" ? raw.summary : "",
  };
}
