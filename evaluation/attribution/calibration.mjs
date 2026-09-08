/**
 * Calibration: how often the attribution judge was right, and what kind of
 * wrong it was when it was not.
 *
 * The distinction the rules turn on is that **a wrong verdict and a leaky
 * isolation are different failures**, and lumping them together flatters
 * both. If an asset was hidden, confirmed not to have reached the model, and
 * the judge still called it used — the judge is wrong, and that is a false
 * positive. If an asset was hidden but actually did reach the model by some
 * other route, the judge calling it used is *correct*; what failed is the
 * isolation, and recording that as a judging error would hide a real hole in
 * the experiment while making the judge look worse than it is.
 *
 *   hidden + not delivered + judged used   → false positive (the judge)
 *   hidden + delivered, from anywhere      → isolation failure (the setup)
 *
 * "From anywhere" matters. An arrival whose source is identified but is not
 * this asset — a knowledge file, a cached tool result, another skill — is
 * still an arrival, and on a hidden asset it is a leak. Only an arrival
 * whose source the record cannot name is unmeasurable.
 *
 * Everything the audit could not settle stays out of both. A run whose
 * capture does not cover it, a token that arrived from an alternative
 * source, an arrival that came after the operation being judged — none of
 * those are evidence for or against the judge, and counting them either way
 * would be inventing a result. They are reported on their own lines, which
 * is the only way the reader can see how much of the batch actually
 * measured anything.
 *
 * Cumulative totals and post-freeze verification are reported separately.
 * A batch run before the rules were frozen cannot verify those rules; it can
 * only describe what the older ones did. Merging them produces a number that
 * belongs to no rule set at all.
 */

/** Did the arrival happen, in time to explain the operation being judged? */
function reachedInTime(verdict) {
  if (verdict === "delivered") return "yes";
  // Content that arrived from a source that IS identified but is not this
  // asset still arrived (2026-09-08k). Filing it as unmeasurable is how the
  // batch's one real leak disappeared from the table: on a hidden asset this
  // is precisely an isolation failure, the row the table exists to show.
  if (verdict === "delivered_from_other_source") return "yes";
  if (verdict === "not_delivered") return "no";
  // after_operation did arrive, but not before what is being judged; for the
  // purpose of that operation it is "not in time", and it is named so the
  // reader can tell it from never arriving at all.
  if (verdict === "after_operation") return "not_in_time";
  return "unsettled";
}

/**
 * One asset in one run.
 * @param judgedUsed  did the judge say this asset was used
 * @param hidden      was it hidden from the model for this run
 * @param verdict     the delivery audit's verdict
 */
export function classify({ judgedUsed, hidden, verdict }) {
  const reached = reachedInTime(verdict);
  if (reached === "unsettled") {
    return { bucket: "unsettled", why: `delivery is ${verdict}: neither for nor against the judge`, counts_toward_rate: false };
  }
  if (hidden && reached === "yes") {
    return { bucket: "isolation_failure", why: "hidden, yet its content reached the model — the setup leaked, so a 'used' verdict here is not the judge's error", counts_toward_rate: false };
  }
  if (judgedUsed && reached !== "yes") {
    return { bucket: "false_positive", why: `judged used, but delivery is ${verdict} — nothing reached the model in time to be used`, counts_toward_rate: true };
  }
  if (judgedUsed && reached === "yes") {
    return { bucket: "true_positive", why: "judged used, and it did reach the model first", counts_toward_rate: true };
  }
  if (!judgedUsed && reached === "yes") {
    return { bucket: "false_negative", why: "it reached the model first, and the judge did not call it used", counts_toward_rate: true };
  }
  return { bucket: "true_negative", why: `not judged used, and delivery is ${verdict}`, counts_toward_rate: true };
}

/**
 * @param runs  [{ run_id, label, rules_version, started_at, baseline_frozen_at,
 *                 model, assets: { [asset_id]: { judgedUsed, hidden, verdict, asset_version } } }]
 */
export function calibrate(runs) {
  const rows = [];
  for (const r of runs ?? []) {
    for (const [assetId, a] of Object.entries(r.assets ?? {})) {
      const c = classify(a);
      rows.push({
        run_id: r.run_id, label: r.label, rules_version: r.rules_version ?? null,
        started_at: r.started_at ?? null, baseline_frozen_at: r.baseline_frozen_at ?? null,
        model: r.model ?? null, asset_id: assetId, asset_version: a.asset_version ?? null,
        judged_used: !!a.judgedUsed, hidden: !!a.hidden, delivery: a.verdict, ...c,
      });
    }
  }
  const tally = (subset) => {
    const t = { true_positive: 0, false_positive: 0, true_negative: 0, false_negative: 0, isolation_failure: 0, unsettled: 0 };
    for (const x of subset) t[x.bucket] += 1;
    const rated = subset.filter((x) => x.counts_toward_rate).length;
    // The denominator is what was actually measurable, and the share that was
    // not is printed beside it rather than dropped.
    const correct = t.true_positive + t.true_negative;
    return {
      ...t, decisions_rated: rated, decisions_total: subset.length,
      accuracy: rated ? Math.round((correct / rated) * 1000) / 1000 : null,
      unmeasurable_share: subset.length ? Math.round(((subset.length - rated) / subset.length) * 1000) / 1000 : null,
    };
  };
  const byRules = {};
  for (const x of rows) {
    const k = x.rules_version ?? "unrecorded";
    (byRules[k] ??= []).push(x);
  }
  return {
    rows,
    cumulative: tally(rows),
    // Cumulative and per-rule-set are both reported; the second is the one
    // that verifies a given rule set, the first only describes the history.
    by_rules_version: Object.fromEntries(Object.entries(byRules).map(([k, v]) => [k, tally(v)])),
  };
}

/** A short report; the caller decides where it goes. */
export function renderCalibration(result, { frozenRules } = {}) {
  const L = [];
  const line = (name, t) => `| ${name} | ${t.true_positive} | ${t.false_positive} | ${t.true_negative} | ${t.false_negative} | ${t.isolation_failure} | ${t.unsettled} | ${t.decisions_rated}/${t.decisions_total} | ${t.accuracy ?? "—"} |`;
  L.push("| set | TP | FP | TN | FN | isolation failure | unsettled | rated/total | accuracy |");
  L.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const [k, t] of Object.entries(result.by_rules_version)) L.push(line(`rules ${k}${frozenRules && k === frozenRules ? " (frozen)" : ""}`, t));
  L.push(line("**cumulative**", result.cumulative));
  L.push("");
  L.push("An isolation failure is not a judging error: the asset was hidden and its");
  L.push("content reached the model anyway, so calling it used was right and the");
  L.push("setup was what failed. Unsettled rows — capture that does not cover the");
  L.push("run, an alternative source, an arrival after the operation — count for");
  L.push("neither side; `rated/total` is how much of the batch measured anything.");
  return L.join("\n");
}
