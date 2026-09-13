/**
 * 一次运行里"候选怎么变成上下文"的展示,把两层过滤分开说。
 *
 * 为什么要分开:它们是两个执行者在两个问题上做的过滤。
 *   - **准入**:产品闸门问"这份资产可不可以被送达"。与当前任务无关 —— 同一份资产在任何任务下
 *     都是同样的准入结果。模型路径只放行 approved。
 *   - **相关性**:模型自己检索时问"这份资产跟我手头这件事有没有关系"。
 * 混成一句"筛掉了 N 项",读者就分不清是产品拦下的,还是模型看了没要 —— 而这两件事的含义完全不同。
 *
 * 另:**没有测量的东西不报**。这里能数的是字符数;手边没有分词器,就不拿 chars/4 冒充 token 数。
 */
export const ADMIT_STATES = ["approved"];

export function selectionView({ pool = [], calls = [], verdict = {} } = {}) {
  const admitted = pool.filter((a) => ADMIT_STATES.includes(a.status));
  const excluded = pool.filter((a) => !ADMIT_STATES.includes(a.status))
    .map((a) => ({ ...a, why: `闸门状态 ${a.status} —— 模型路径只放行 ${ADMIT_STATES.join("/")}` }));

  const searches = calls.filter((c) => c.kind === "search").length;
  const taken = [...new Set(calls.map((c) => c.fetched).filter(Boolean))];
  const not_taken = admitted.map((a) => a.name).filter((n) => !taken.includes(n));
  const fetchChars = calls.filter((c) => c.fetched).reduce((s, c) => s + (c.chars ?? 0), 0);

  return {
    pool_total: pool.length,
    admission: {
      admitted: admitted.length,
      excluded,
      note: "这一层与任务无关:同一份资产在任何任务下都是同样的准入结果。",
    },
    relevance: {
      searches, taken, not_taken,
      note: searches === 0
        ? "这次运行没有发起检索 —— 注入清单对新 agent 是空的,而模型也没有主动搜;所以不是「筛掉了」,是根本没找。"
        : `模型检索 ${searches} 次,从已准入的 ${admitted.length} 项里取回 ${taken.length} 项;其余 ${not_taken.length} 项是「已准入但模型没要」,与闸门无关。`,
    },
    context: {
      chars: fetchChars,
      note: `进入上下文的是取回内容,共 ${fetchChars} **字符**(不是 token —— 这里没有分词器,未测量 token 数)。`,
    },
    sufficiency: verdict?.verdict
      ? `留下的内容够不够完成任务,只看独立验收:${verdict.verdict}${verdict.reason ? `(${String(verdict.reason).slice(0, 60)})` : ""}。这里不另下结论。`
      : "没有验收结果,不对「够不够」下结论。",
  };
}

export function renderSelection(v) {
  return [
    `池中 ${v.pool_total} 项`,
    "",
    `① 准入过滤(产品闸门做的,与任务无关)`,
    `   放行 ${v.admission.admitted} 项;挡下 ${v.admission.excluded.length} 项:`,
    ...v.admission.excluded.map((e) => `     - ${e.name}(${e.asset_id}):${e.why}`),
    `   ${v.admission.note}`,
    "",
    `② 任务相关性筛选(模型自己做的)`,
    `   ${v.relevance.note}`,
    ...(v.relevance.taken.length ? [`   取回:${v.relevance.taken.join("、")}`] : []),
    ...(v.relevance.not_taken.length ? [`   已准入但没要:${v.relevance.not_taken.join("、")}`] : []),
    "",
    `③ 最终进入上下文`,
    `   ${v.context.note}`,
    "",
    `④ 够不够完成任务`,
    `   ${v.sufficiency}`,
  ].join("\n");
}
