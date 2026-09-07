/**
 * Citation check for a context-based author assessment.
 *
 * The assessment is written by a model that has read the author's own
 * records (L0 conversations, L1 memories, persona, earlier assets and their
 * outcomes). The model may say anything; this file decides what survives.
 * A claim survives only if every record id it cites exists in the evidence
 * pack and its quote is found, verbatim after whitespace/case folding, in at
 * least one of the cited records. Nothing else is accepted: no citation, no
 * claim; a quote the record does not contain, no claim.
 *
 * Competence is then read off the surviving claims, not the model's word:
 * with no surviving claim the competence is `unknown`, whatever the model
 * said. The asset-claim check (does the author's own record support,
 * contradict, or say nothing about what the asset asserts?) is verified the
 * same way and falls back to `silent`.
 *
 * Pure: no I/O. Used by assess.mjs; tested on its own.
 */

export const COMPETENCE = new Set(["high", "medium", "low", "unknown"]);
export const CLAIM_VERDICTS = new Set(["supports", "contradicts", "silent"]);

const fold = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Labels are the model's words, not evidence; spelling variants are folded
 * onto the vocabulary ("contradict" → contradicts). Anything else is left as
 * it is and then fails the vocabulary check.
 */
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

/** Does `quote` occur in `text`, after folding? Empty quotes never match. */
export function quoteFound(quote, text) {
  const q = fold(quote);
  if (q.length < 8) return false; // a few characters would match anything
  return fold(text).includes(q);
}

/**
 * Verify one cited statement against the pack.
 * @returns {{ ok: boolean, reason?: string, record_ids: string[] }}
 */
export function verifyCitation(item, pack) {
  const ids = Array.isArray(item?.record_ids) ? item.record_ids.map(String) : [];
  if (ids.length === 0) return { ok: false, reason: "no record cited", record_ids: [] };
  const missing = ids.filter((id) => !pack.has(id));
  if (missing.length) return { ok: false, reason: `cited record(s) not in the pack: ${missing.join(", ")}`, record_ids: ids };
  const quote = item?.quote;
  if (!quote || typeof quote !== "string") return { ok: false, reason: "no quote", record_ids: ids };
  const hit = ids.find((id) => quoteFound(quote, pack.get(id)));
  if (!hit) return { ok: false, reason: "quote not found in any cited record", record_ids: ids };
  return { ok: true, record_ids: ids, found_in: hit };
}

/**
 * @param raw   the model's parsed JSON output
 * @param pack  Map<record_id, text>
 */
export function checkAssessment(raw, pack) {
  const claims = Array.isArray(raw?.claims) ? raw.claims : [];
  const counter = Array.isArray(raw?.counter_evidence) ? raw.counter_evidence : [];
  const kept = [], dropped = [];
  for (const [group, list] of [["claim", claims], ["counter_evidence", counter]]) {
    for (const c of list) {
      const v = verifyCitation(c, pack);
      const row = { group, statement: String(c?.statement ?? ""), record_ids: v.record_ids, quote: c?.quote ?? null };
      if (v.ok) kept.push({ ...row, found_in: v.found_in });
      else dropped.push({ ...row, reason: v.reason });
    }
  }
  const claimsKept = kept.filter((k) => k.group === "claim");
  const saidRaw = normalizeCompetence(raw?.competence);
  const said = COMPETENCE.has(saidRaw) ? saidRaw : "unknown";
  // Competence rests on surviving claims. None → unknown, whatever was said.
  const competence = claimsKept.length > 0 ? said : "unknown";

  let assetClaim = { verdict: "silent", record_ids: [], quote: null, reason: "not asserted" };
  const acc = raw?.asset_claim_check;
  const accVerdict = acc ? normalizeVerdict(acc.verdict) : null;
  if (acc && CLAIM_VERDICTS.has(accVerdict)) {
    if (accVerdict === "silent") assetClaim = { verdict: "silent", record_ids: [], quote: null, reason: "model said silent" };
    else {
      const v = verifyCitation(acc, pack);
      assetClaim = v.ok
        ? { verdict: accVerdict, record_ids: v.record_ids, quote: acc.quote, found_in: v.found_in }
        : { verdict: "silent", record_ids: v.record_ids, quote: acc.quote ?? null, reason: `downgraded to silent: ${v.reason}` };
    }
  } else if (acc) {
    assetClaim = { verdict: "silent", record_ids: [], quote: null, reason: `verdict "${acc.verdict}" not in the vocabulary` };
  }

  return {
    competence,
    competence_as_said: said,
    competence_downgraded: competence !== said,
    asset_claim_check: assetClaim,
    claims_kept: kept,
    claims_dropped: dropped,
    counts: { claims: claims.length, counter_evidence: counter.length, kept: kept.length, dropped: dropped.length, citations: claimsKept.length },
    summary: typeof raw?.summary === "string" ? raw.summary : "",
  };
}
