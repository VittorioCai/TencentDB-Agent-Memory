/**
 * Calibration: how often the attribution judge was right, and what kind of
 * wrong it was when it was not.
 *
 * The distinction the rules turn on is that **a wrong verdict and a leaky
 * isolation are different failures**, and lumping them together flatters
 * both. If an asset was hidden, confirmed not to have reached the model, and
 * the judge still called it used — the judge is wrong, and that is a false
 * positive. If an asset was hidden but actually did reach the model by some
 * other route, what this table records is the **isolation failure**; whether the
 * use verdict was right is a separate question, settled by the adoption evidence
 * in the usage table — content reaching the model does not mean the model used it
 * (2026-09-12 second review). Recording a leak as a judging error would hide a real
 * hole in the experiment; calling it a vindication of the judge would be the mirror
 * mistake, and this table does neither.
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
function reachedInTime(verdict, coverageAsserted) {
  if (verdict === "delivered") return "yes";
  // The model's own words — written by it, or echoed back from its own
  // command — are evidence that nothing reached it, PROVIDED the capture is
  // known to cover the run (2026-09-08m). Filing them as unsettled made the
  // sharpest false positive there is unmeasurable: the model dialled an
  // address it was never given, and the judge called the asset used.
  if (verdict === "model_authored" || verdict === "model_echo") return coverageAsserted ? "no" : "unsettled";
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
export function classify({ judgedUsed, hidden, verdict, coverageAsserted }) {
  // Whether the asset was hidden is half of every verdict below, so not
  // knowing it is not the same as it being visible (2026-09-08m). Batch 1
  // recorded no gate block; `hidden` defaulted to false, and three gate-on
  // runs became true negatives. A leak in one of them would have been a true
  // negative too, which made that batch's "isolation failures: 0"
  // structurally guaranteed rather than measured.
  if (hidden === null || hidden === undefined) {
    return { bucket: "unsettled", why: "the run does not record whether it was hidden, so neither a leak nor a clean isolation can be read from it", counts_toward_rate: false };
  }
  const reached = reachedInTime(verdict, coverageAsserted);
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
        run_id: r.run_id, label: r.label, rules_version: r.rules_version ?? null, experiment: r.experiment ?? null,
        started_at: r.started_at ?? null, baseline_frozen_at: r.baseline_frozen_at ?? null,
        model: r.model ?? null, asset_id: assetId, asset_version: a.asset_version ?? null,
        judged_used: !!a.judgedUsed, hidden: a.hidden ?? null, delivery: a.verdict,
        capture_complete: a.coverageAsserted ?? null, run_verdict: r.run_verdict ?? null, ...c,
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
  // 再分一层:(rules_version, 实验标识)。同一规则下的不同实验(换 token / 消费者 /
  // 资产版本)不并成一行,旧批次各自成行(2026-09-10)。
  const byExp = {};
  for (const x of rows) (byExp[`${x.rules_version ?? "unrecorded"} · ${x.experiment ?? "unknown"}`] ??= []).push(x);
  return {
    rows,
    cumulative: tally(rows),
    // Cumulative and per-rule-set are both reported; the second is the one
    // that verifies a given rule set, the first only describes the history.
    by_rules_version: Object.fromEntries(Object.entries(byRules).map(([k, v]) => [k, tally(v)])),
    by_experiment: Object.fromEntries(Object.entries(byExp).map(([k, v]) => [k, tally(v)])),
  };
}

/** A short report; the caller decides where it goes. */
export function renderCalibration(result, { frozenRules, byExperiment } = {}) {
  const L = [];
  const line = (name, t) => `| ${name} | ${t.true_positive} | ${t.false_positive} | ${t.true_negative} | ${t.false_negative} | ${t.isolation_failure} | ${t.unsettled} | ${t.decisions_rated}/${t.decisions_total} | ${t.accuracy ?? "—"} |`;
  L.push("| set | TP | FP | TN | FN | isolation failure | unsettled | rated/total | accuracy |");
  L.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
  const groups = byExperiment && result.by_experiment ? Object.entries(result.by_experiment) : Object.entries(result.by_rules_version);
  for (const [k, t] of groups) {
    const frozenMark = frozenRules && (k === frozenRules || k.startsWith(`${frozenRules} · `)) ? " (frozen)" : "";
    L.push(line(`${byExperiment && result.by_experiment ? "" : "rules "}${k}${frozenMark}`, t));
  }
  L.push(line("**cumulative**", result.cumulative));
  L.push("");
  // 这段是判据说明,不是数字断言;但它必须跟着判据走。"来源是别处"曾经算未定,
  // 现在算到达(隐藏时即泄漏),所以那句话必须一起改,否则报告会自相矛盾。
  L.push("An isolation failure is a failure of the setup: the asset was hidden and its");
  L.push("content reached the model anyway. Whether the use verdict was right is settled");
  L.push("by the adoption evidence in the usage table, not here — a leak and a wrong use");
  L.push("verdict can happen at the same time (2026-09-12 review). FN in THIS table means");
  L.push("\"delivered but not judged used\", not a missed detection of use.");
  L.push("Unsettled rows — a capture that does not cover the");
  L.push("run, a source the record cannot name, whether the asset was hidden not");
  L.push("recorded — count for neither side; `rated/total` is how much of the batch");
  L.push("measured anything. An arrival from an identified other source is NOT");
  L.push("unsettled: the content did reach the model.");
  return L.join("\n");
}

// ---------------------------------------------------------------------------
// 使用检测的校准 —— 参考判定是**采纳**,不是送达
// ---------------------------------------------------------------------------
/**
 * 上面那套用送达当真值,测的是"判定器有没有凭空说用了"。那不是使用准确率:
 * 内容到了而操作没采用它,判定器说"没用"是**对的**,送达口径却会记成假阴性。
 *
 * 所以这一套的参考判定来自 `adoption.mjs` —— 独立的操作证据,既不来自 delivery,
 * 也不来自待测的判定器。证据不足时是 `unknown_adoption`,单独一类,不进分母。
 */
export function classifyUsage({ judgedUsed, adopted }) {
  if (adopted === null || adopted === undefined) {
    return { bucket: "unknown_adoption", why: "没有独立证据说明操作是否采用了它,既不能算判对也不能算判错", counts_toward_rate: false };
  }
  if (adopted && judgedUsed) return { bucket: "true_positive", why: "操作确实采用了它,判定器也说用了", counts_toward_rate: true };
  if (adopted && !judgedUsed) return { bucket: "false_negative", why: "操作确实采用了它,判定器没说用", counts_toward_rate: true };
  if (!adopted && judgedUsed) return { bucket: "false_positive", why: "操作没有采用它,判定器却说用了", counts_toward_rate: true };
  return { bucket: "true_negative", why: "操作没有采用它,判定器也没说用——这是判对,不是漏报", counts_toward_rate: true };
}

export function calibrateUsage(runs) {
  const rows = [];
  for (const r of runs ?? []) {
    for (const [assetId, a] of Object.entries(r.assets ?? {})) {
      const c = classifyUsage(a);
      rows.push({
        run_id: r.run_id, label: r.label ?? null, rules_version: r.rules_version ?? null, experiment: r.experiment ?? null,
        model: r.model ?? null, run_verdict: r.run_verdict ?? null,
        asset_id: assetId, asset_version: a.asset_version ?? null,
        judged_used: !!a.judgedUsed, adopted: a.adopted ?? null, benefited: a.benefited ?? null,
        adoption_why: a.adoption_why ?? null, delivery: a.verdict ?? null, ...c,
      });
    }
  }
  const tally = (subset) => {
    const t = { true_positive: 0, false_positive: 0, true_negative: 0, false_negative: 0, unknown_adoption: 0 };
    for (const x of subset) t[x.bucket] += 1;
    const rated = subset.filter((x) => x.counts_toward_rate).length;
    const correct = t.true_positive + t.true_negative;
    // 采纳而未奏效的次数单独数:采用不等于有收益,这是第三个问题。
    const adoptedRows = subset.filter((x) => x.adopted === true);
    return {
      ...t, decisions_rated: rated, decisions_total: subset.length,
      accuracy: rated ? Math.round((correct / rated) * 1000) / 1000 : null,
      adoption_coverage: subset.length ? Math.round((rated / subset.length) * 1000) / 1000 : null,
      adopted_and_worked: adoptedRows.filter((x) => x.benefited === true).length,
      adopted_but_failed: adoptedRows.filter((x) => x.benefited === false).length,
      adopted_benefit_unknown: adoptedRows.filter((x) => x.benefited === null).length,
    };
  };
  const byRules = {};
  for (const x of rows) (byRules[x.rules_version ?? "unrecorded"] ??= []).push(x);
  const byExp = {};
  for (const x of rows) (byExp[`${x.rules_version ?? "unrecorded"} · ${x.experiment ?? "unknown"}`] ??= []).push(x);
  return {
    rows, cumulative: tally(rows),
    by_rules_version: Object.fromEntries(Object.entries(byRules).map(([k, v]) => [k, tally(v)])),
    by_experiment: Object.fromEntries(Object.entries(byExp).map(([k, v]) => [k, tally(v)])),
  };
}

export function renderUsage(result, { frozenRules, byExperiment } = {}) {
  const L = [];
  const line = (name, t) => `| ${name} | ${t.true_positive} | ${t.false_positive} | ${t.true_negative} | ${t.false_negative} | ${t.unknown_adoption} | ${t.decisions_rated}/${t.decisions_total} | ${t.accuracy ?? "—"} | ${t.adoption_coverage ?? "—"} |`;
  L.push("| set | TP | FP | TN | FN | 采纳未知 | rated/total | accuracy | 采纳证据覆盖率 |");
  L.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
  const groups = byExperiment && result.by_experiment ? Object.entries(result.by_experiment) : Object.entries(result.by_rules_version);
  for (const [k, t] of groups) {
    const frozenMark = frozenRules && (k === frozenRules || k.startsWith(`${frozenRules} · `)) ? " (frozen)" : "";
    L.push(line(`${byExperiment && result.by_experiment ? "" : "rules "}${k}${frozenMark}`, t));
  }
  L.push(line("**cumulative**", result.cumulative));
  return L.join("\n");
}
