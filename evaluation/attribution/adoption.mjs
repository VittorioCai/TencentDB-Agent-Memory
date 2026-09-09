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
 * 判 `false` 需要正面证据。判别性 token 的前提是"用了就会出现",所以**尝试记录
 * 覆盖了这个 token 该出现的那一面、而它不在**,就是未采纳的正面证据。反过来,
 * 记录覆盖不到那一面时(例如 token 只会写在请求体里,而记录只有 host/port),
 * 缺席什么也不说明,结果是 `null`——未知必须原样保留到最后,不能折叠成"未采纳"。
 *
 * 两条判据都是 2026-09-09 独立审阅翻出来的:
 *
 *   D1  命中用拼接文本 `includes`,端口 `147318` 命中 token `47318`,
 *       一次没采纳的操作被记成采纳。命中必须看边界。
 *   D5  判 `false` 原来要求"识别出用的是池内**另一个**资产",于是单资产池里
 *       `false` 结构上不可达。可达与否不该取决于池里恰好还有别的资产。
 */

/** 正则转义。 */
const ESC = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 边界命中。相邻字符是数字 / 字母 / `.` / `_` / `-` 时不算命中:
 * `147318` 里的 `47318`、`10.244.7.190` 里的 `10.244.7.19` 都是另一个值。
 * `:` 与空白不在其中,所以 `10.244.7.19:8096` 里的地址仍然命中。
 */
export function boundaryHit(text, token) {
  const t = String(text ?? ""), k = String(token ?? "");
  if (!t || !k) return false;
  return new RegExp(`(?<![0-9A-Za-z._-])${ESC(k)}(?![0-9A-Za-z._-])`, "i").test(t);
}

/**
 * 这个 token 会出现在哪一面。
 *
 *   address  地址类:裸端口、IPv4、host[:port] —— 记在 attempt 的 host / port / url
 *   opaque   不透明标记:资产 id、清单 marker —— 记在 attempt 的 value / url
 *
 * 分面是为了回答"缺席能不能算数",不是为了限制命中:命中照样查所有字段。
 */
export function surfaceOf(token) {
  const v = String(token ?? "").trim();
  if (!v) return "opaque";
  if (/^\d{1,5}$/.test(v)) return "address";
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d{1,5})?$/.test(v)) return "address";
  if (/^(localhost|[a-z0-9-]+(\.[a-z0-9-]+)+)(:\d{1,5})?$/i.test(v)) return "address";
  return "opaque";
}

/** 每一面由 attempt 的哪些字段承载。 */
const FIELDS_FOR = { address: ["host", "port", "url"], opaque: ["value", "url"] };
/** 命中时查的字段(比覆盖面宽:命中是宽的,缺席才要求严)。 */
const MATCH_FIELDS = ["host", "port", "url", "value", "endpoint"];

/** 一次尝试里,任何字段边界命中这个 token。 */
export function attemptCarries(attempt, token) {
  for (const f of MATCH_FIELDS) if (boundaryHit(attempt?.[f], token)) return true;
  const h = attempt?.host, p = attempt?.port;
  if (h && p && boundaryHit(`${h}:${p}`, token)) return true;
  return false;
}

/** 这批尝试记录有没有覆盖某一面 —— 该面的字段至少有一次是非空的。 */
export function surfaceCovered(attempts, surface) {
  const fields = FIELDS_FOR[surface] ?? [];
  return (attempts ?? []).some((a) => fields.some((f) => String(a?.[f] ?? "").trim() !== ""));
}

/** 记录里实际出现过的字段,用来把"覆盖不到"讲具体。 */
function recordedFields(attempts) {
  const s = new Set();
  for (const a of attempts ?? []) for (const f of MATCH_FIELDS) if (String(a?.[f] ?? "").trim() !== "") s.add(f);
  return [...s];
}

const unknown = (why, extra = {}) => ({ adopted: null, benefited: null, attempts: [], why, ...extra });

/**
 * @param verdict  该次运行的 verdict.json(可为 null)
 * @param tokens   该次运行冻结的 tokens.json:{ asset_id: { tokens: [...] } }
 * @returns { [asset_id]: { adopted: true|false|null, benefited: true|false|null,
 *                          attempts: [...], surfaces, why } }
 */
export function adoptionFromAcceptance(verdict, tokens) {
  const attempts = Array.isArray(verdict?.attempts) ? verdict.attempts : [];
  const ids = Object.keys(tokens ?? {});
  const out = {};

  for (const id of ids) {
    const toks = (tokens[id]?.tokens ?? []).filter(Boolean);
    const surfaces = [...new Set(toks.map(surfaceOf))];

    if (!attempts.length) {
      out[id] = unknown("验收记录里没有任何尝试,操作用了什么无从判断", { surfaces });
      continue;
    }
    if (!toks.length) {
      out[id] = unknown("这个资产没有判别性 token,采纳与否无从对照", { surfaces });
      continue;
    }

    const mine = attempts.filter((a) => toks.some((t) => attemptCarries(a, t)));
    if (mine.length) {
      // 用过这个值就是采用了它的内容;成不成功是收益,不是采纳。
      const oks = mine.map((a) => a?.ok).filter((v) => typeof v === "boolean");
      out[id] = {
        adopted: true,
        benefited: oks.length ? oks.some(Boolean) : null,
        attempts: mine,
        surfaces,
        why: `操作在 ${mine.map((a) => a.value ?? `${a.host}:${a.port}`).join("、")} 上尝试过,用的是这个资产记录的值`,
      };
      continue;
    }

    // 没命中。缺席能不能算"未采纳",取决于记录有没有覆盖这些 token 该出现的面。
    const uncovered = surfaces.filter((s) => !surfaceCovered(attempts, s));
    if (uncovered.length) {
      out[id] = unknown(
        `尝试记录只有 ${recordedFields(attempts).join(" / ") || "(空)"},覆盖不到 ${uncovered.join(" / ")} 面的 token;缺席不能读成未采纳`,
        { surfaces },
      );
      continue;
    }
    out[id] = {
      adopted: false, benefited: null, attempts: [], surfaces,
      why: `尝试记录覆盖了 ${surfaces.join(" / ")} 面,其中没有一次用到这个资产的值`,
    };
  }
  return out;
}
