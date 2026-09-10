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

import { createHash } from "node:crypto";

/** 正则转义。 */
const ESC = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** sha256 十六进制。哈希模式下,采纳判定把观察到的字段值哈希后与存的 sha256 比。 */
const sha256Hex = (s) => createHash("sha256").update(String(s)).digest("hex");

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

/**
 * 一个 token 若被采用,**必然会出现在哪个字段**。
 *
 * 判 `adopted:false` 的前提是"用了就一定看得见",所以这里要精确到字段,不能是
 * "这一族里随便哪个字段出现过一次"。上一轮就松在这里:token 该写在请求体、而记录
 * 只有 URL 时,仍然判了未采纳——URL 根本不承载请求体的值。
 *
 * 每一项是一组**可替代**的字段:组内字段要全有,组间满足一个即可。
 *   address  地址写在 host+port,或者写在一个完整 url 里
 *   opaque   不透明标记只认 value(请求体里的那个值);url 不算,它不承载请求体
 *
 * 场景可以用 tokens.json 的 `adoption_fields` 直接声明,声明优先于按形状猜——
 * "判别性强"不等于"采用必然原样出现",那是场景的性质,不是字符串的性质。
 */
export function fieldGroupsFor(token, spec) {
  const declared = spec?.adoption_fields;
  if (Array.isArray(declared) && declared.length) return [declared.map(String)];
  return surfaceOf(token) === "address" ? [["host", "port"], ["url"]] : [["value"]];
}

/** 命中时查的字段(比覆盖面宽:命中是宽的,缺席才要求严)。 */
const MATCH_FIELDS = ["host", "port", "url", "value", "endpoint"];

const nonEmpty = (v) => String(v ?? "").trim() !== "";

/**
 * 一次尝试里是否命中这个 token。
 *
 * 场景声明了 `adoption_fields` 时**只查声明的字段**:声明的含义是"采用这项内容
 * 必然在这个字段留下这个 token",那么别处出现就不是采用的证据。没有声明时按宽口径
 * 查所有字段——宁可多命中,也不要把一次真的采用漏掉。
 */
export function attemptCarries(attempt, token, declaredFields = null) {
  if (Array.isArray(declaredFields) && declaredFields.length) {
    return declaredFields.some((f) => boundaryHit(attempt?.[f], token));
  }
  for (const f of MATCH_FIELDS) if (boundaryHit(attempt?.[f], token)) return true;
  const h = attempt?.host, p = attempt?.port;
  if (h && p && boundaryHit(`${h}:${p}`, token)) return true;
  return false;
}

/** 这一次尝试有没有把该 token 该出现的字段记全。 */
export function attemptReadableFor(attempt, groups) {
  return (groups ?? []).some((g) => g.every((f) => nonEmpty(attempt?.[f])));
}

/**
 * 缺席能不能算数:**每一次**尝试都要记全,不是某一次记全。
 * 有一次尝试缺字段,那一次就可能正好用了它,整体只能是未知。
 */
export function absenceReadable(attempts, groups) {
  const list = attempts ?? [];
  if (!list.length) return false;
  return list.every((a) => attemptReadableFor(a, groups));
}

/** 记录里实际出现过的字段,用来把"覆盖不到"讲具体。 */
function recordedFields(attempts) {
  const s = new Set();
  for (const a of attempts ?? []) for (const f of MATCH_FIELDS) if (nonEmpty(a?.[f])) s.add(f);
  return [...s];
}

/** 收益:任何一次成功就是成功;全部失败才是失败;有读不出的就是未知。 */
export function benefitOf(attempts) {
  const oks = (attempts ?? []).map((a) => a?.ok);
  if (oks.some((v) => v === true)) return true;
  if (oks.some((v) => typeof v !== "boolean")) return null;
  return oks.length ? false : null;
}

const unknown = (why, extra = {}) => ({ adopted: null, benefited: null, attempts: [], why, ...extra });

/**
 * @param verdict  该次运行的 verdict.json(可为 null)
 * @param tokens   该次运行冻结的 tokens.json:
 *                 { asset_id: { tokens: [...], adoption_fields?: [...] } }
 * @returns { [asset_id]: { adopted: true|false|null, benefited: true|false|null,
 *                          attempts: [...], surfaces, why } }
 */
/**
 * 一个资产的判别值,统一成"匹配器"。两种形态:
 *
 *   明文  spec.tokens=[...]        —— 老批次,按边界/子串在字段里找
 *   哈希  spec.token_sha256=[...]  —— 方案 2(2026-09-10),仓库不放明文,只放 sha256。
 *                                     采纳判定把观察到的字段值哈希一下和它比,
 *                                     不需要明文——这正是"明文只在 Core"的要求。
 *
 * 哈希形态**必须**声明 adoption_fields:没有明文就没有形状可猜,判别值该出现在哪个
 * 字段只能由场景说。matchKey 用于判归属(共享 token);label 用于讲人话。
 */
function matchersFor(spec) {
  const declared = Array.isArray(spec?.adoption_fields) && spec.adoption_fields.length ? spec.adoption_fields.map(String) : null;
  if (Array.isArray(spec?.token_sha256) && spec.token_sha256.length) {
    const fields = declared ?? ["value"];
    return spec.token_sha256.filter(Boolean).map((h) => ({
      mode: "hash", key: String(h).toLowerCase(), label: `sha256:${String(h).slice(0, 12)}…`,
      fields, groups: [fields],
      carries: (a) => fields.some((f) => nonEmpty(a?.[f]) && sha256Hex(String(a[f])) === String(h).toLowerCase()),
    }));
  }
  return (spec?.tokens ?? []).filter(Boolean).map((t) => ({
    mode: "plain", key: String(t).toLowerCase(), label: String(t),
    fields: declared, groups: fieldGroupsFor(t, spec),
    carries: (a) => attemptCarries(a, t, declared),
  }));
}

export function adoptionFromAcceptance(verdict, tokens) {
  const attempts = Array.isArray(verdict?.attempts) ? verdict.attempts : [];
  const ids = Object.keys(tokens ?? {});

  // 哪些资产声明了同一个判别值。共享时归属是歧义的(明文按值、哈希按 sha256 比)。
  const owners = new Map();
  for (const id of ids) {
    for (const m of matchersFor(tokens[id])) {
      if (!owners.has(m.key)) owners.set(m.key, new Set());
      owners.get(m.key).add(id);
    }
  }
  const sharedWith = (key, self) => [...(owners.get(key) ?? [])].filter((x) => x !== self);

  const out = {};
  for (const id of ids) {
    const spec = tokens[id] ?? {};
    const toks = matchersFor(spec);
    const surfaces = spec.token_sha256 ? ["hashed"] : [...new Set((spec.tokens ?? []).map(surfaceOf))];

    if (!attempts.length) { out[id] = unknown("验收记录里没有任何尝试,操作用了什么无从判断", { surfaces }); continue; }
    if (!toks.length) { out[id] = unknown("这个资产没有判别性 token,采纳与否无从对照", { surfaces }); continue; }

    // 命中:逐匹配器记下是哪一次尝试命中的,以及它是不是这个资产独有的。
    const hits = [];
    for (const a of attempts) {
      for (const t of toks) {
        if (!t.carries(a)) continue;
        hits.push({ attempt: a, token: t.label, shared: sharedWith(t.key, id) });
      }
    }
    if (hits.length) {
      const own = hits.filter((h) => !h.shared.length);
      if (!own.length) {
        const others = [...new Set(hits.flatMap((h) => h.shared))];
        out[id] = unknown(
          `命中的 token(${[...new Set(hits.map((h) => h.token))].join("、")})同时属于 ${others.join("、")},操作用了哪一个的内容无从区分,归属未知`,
          { surfaces, shared_with: others },
        );
        continue;
      }
      const mine = [...new Set(own.map((h) => h.attempt))];
      out[id] = {
        adopted: true, benefited: benefitOf(mine), attempts: mine, surfaces,
        why: `操作在 ${mine.map((a) => a.value ?? `${a.host}:${a.port}`).join("、")} 上尝试过,用的是这个资产独有的值`,
      };
      continue;
    }

    // 没命中。缺席能不能算"未采纳",取决于每一次尝试都记全了这些判别值该出现的字段。
    const unreadable = toks.filter((t) => !absenceReadable(attempts, t.groups));
    if (unreadable.length) {
      const need = [...new Set(unreadable.flatMap((t) => t.groups.map((g) => g.join("+"))))];
      out[id] = unknown(
        `判未采纳需要每一次尝试都记下 ${need.join(" 或 ")};记录里只有 ${recordedFields(attempts).join(" / ") || "(空)"},缺席不能读成未采纳`,
        { surfaces },
      );
      continue;
    }
    out[id] = {
      adopted: false, benefited: null, attempts: [], surfaces,
      why: `每一次尝试都记下了这些 token 该出现的字段,其中没有一次用到这个资产的值`,
    };
  }
  return out;
}
