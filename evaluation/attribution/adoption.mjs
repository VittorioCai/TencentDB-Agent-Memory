/**
 * 操作是否**实际采用**了这个资产 —— 以及采用之后是否奏效。
 *
 * 这和"内容是否送达"是两个问题,和"判定器怎么说"更是两个问题。把送达当成采纳的
 * 真值,测出来的是送达一致性;而"模型读了资产、操作却没用它"在送达口径下会被记成
 * 假阴性,把判定器的一次正确判断算成错误。要区分这两者,参考判定必须来自**操作
 * 本身**,不能由 delivery 推出,更不能由待测的判定器推出。
 *
 * 证据是验收记录 `verdict.json` 的 attempts:任务被判定的那次尝试用了哪个地址、
 * 由哪次调用发出、成功与否。它在那儿,与归因判定说了什么无关。
 *
 * 三件事各自命名:
 *
 *   送达  内容到达模型          capture(delivery-audit.mjs)
 *   采纳  操作用了它的内容      verdict.json 的 attempts —— 本文件
 *   收益  用了以后是否奏效      attempt.ok
 *
 * 判 `false` 需要正面证据。尝试记录里识别出用的是**池内另一个**资产,才能说这一个
 * 没被采用;若一次尝试都对不上任何池内资产,证据就没有区分力,结果是 `null` 而不是
 * `false` —— 未知必须原样保留到最后,不能在中途折叠成"未采纳"。
 */

/** 一次尝试里能用来认地址的所有字段,拼成一段可检索的文本。 */
function addressTextOf(attempt) {
  const host = attempt?.host ?? "";
  const port = attempt?.port ?? "";
  return [host, port, host && port ? `${host}:${port}` : "", attempt?.endpoint ?? "", attempt?.url ?? ""]
    .filter(Boolean).map(String).join(" ");
}

/**
 * @param verdict  该次运行的 verdict.json(可为 null)
 * @param tokens   该次运行冻结的 tokens.json:{ asset_id: { tokens: [...] } }
 * @returns { [asset_id]: { adopted: true|false|null, benefited: true|false|null,
 *                          attempts: [...], why } }
 */
export function adoptionFromAcceptance(verdict, tokens) {
  const attempts = Array.isArray(verdict?.attempts) ? verdict.attempts : [];
  const ids = Object.keys(tokens ?? {});

  // 每个资产命中了哪些尝试。
  const hits = new Map(ids.map((id) => [id, []]));
  for (const at of attempts) {
    const text = addressTextOf(at).toLowerCase();
    if (!text) continue;
    for (const id of ids) {
      const toks = tokens[id]?.tokens ?? [];
      if (toks.some((t) => t && text.includes(String(t).toLowerCase()))) hits.get(id).push(at);
    }
  }
  const anyHit = ids.some((id) => hits.get(id).length > 0);

  const out = {};
  for (const id of ids) {
    const mine = hits.get(id);
    if (!attempts.length) {
      out[id] = { adopted: null, benefited: null, attempts: [], why: "验收记录里没有任何尝试,操作用了什么无从判断" };
      continue;
    }
    if (mine.length) {
      // 拨过这个地址就是采用了它的内容;成不成功是收益,不是采纳。
      const oks = mine.map((a) => a?.ok).filter((v) => typeof v === "boolean");
      const benefited = oks.length ? oks.some(Boolean) : null;
      out[id] = {
        adopted: true, benefited, attempts: mine,
        why: `操作在 ${mine.map((a) => `${a.host}:${a.port}`).join("、")} 上尝试过,用的是这个资产记录的地址`,
      };
      continue;
    }
    if (anyHit) {
      out[id] = {
        adopted: false, benefited: null,
        attempts: [],
        why: "验收记录里的尝试用的是池内另一个资产的地址,没有一次用这个资产的",
      };
      continue;
    }
    out[id] = {
      adopted: null, benefited: null, attempts: [],
      why: "有尝试记录,但没有一次能对上任何池内资产,证据没有区分力",
    };
  }
  return out;
}
