/**
 * 使用检测的参考判定,必须来自独立的操作证据。
 *
 * 现有的校准把**送达**当成"判定器说 used"的真值:内容到了就算判对,没到就算判错。
 * 那测的是送达一致性,不是实际使用。两者在这批数据里恰好高度重合,所以差别一直没
 * 暴露——但"模型读了资产、操作却没采用它"正是本课题要区分的情形,而在送达口径下
 * 它会被记成假阴性,把判定器的一次正确判断算成错误。
 *
 * 采纳的证据只能来自**操作本身**:`verdict.json` 的 attempts 记着任务被判定的那次
 * 尝试用了哪个地址、成功与否,它既不来自 delivery,也不来自待测的判定器。
 *
 * 三件事分开:
 *   送达 —— 内容是否到达模型      (capture)
 *   采纳 —— 操作是否实际用了它    (verdict.json attempts)
 *   收益 —— 用了以后是否奏效      (attempt.ok)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { adoptionFromAcceptance } from "./adoption.mjs";
import { classifyUsage, calibrateUsage } from "./calibration.mjs";

const TOKENS = {
  "skl-a": { tokens: ["10.244.7.19"] },
  "skl-b": { tokens: ["47318"] },
};

const attempt = (host, port, ok) => ({ host, port, endpoint: "skill:search", ok, call_id: `call_${port}` });

test("采纳来自操作证据:尝试用了该资产记录的地址,就是采纳", () => {
  const v = { verdict: "PASS", attempts: [attempt("127.0.0.1", "47318", true)] };
  const a = adoptionFromAcceptance(v, TOKENS);
  assert.equal(a["skl-b"].adopted, true, "操作用了 47318,skl-b 被采纳");
  assert.equal(a["skl-b"].benefited, true, "该次尝试 ok");
});

test("尝试失败仍然是采纳——收益是另一个问题", () => {
  const v = { verdict: "PASS", attempts: [attempt("10.244.7.19", "8096", false), attempt("127.0.0.1", "47318", true)] };
  const a = adoptionFromAcceptance(v, TOKENS);
  assert.equal(a["skl-a"].adopted, true, "地址被拨过就是采纳了它的内容");
  assert.equal(a["skl-a"].benefited, false, "但没奏效");
  assert.equal(a["skl-b"].adopted, true);
  assert.equal(a["skl-b"].benefited, true);
});

test("有尝试、且识别出用的是另一个资产,才可以判未采纳", () => {
  const v = { verdict: "PASS", attempts: [attempt("127.0.0.1", "47318", true)] };
  const a = adoptionFromAcceptance(v, TOKENS);
  assert.equal(a["skl-a"].adopted, false, "操作identifiably用了 skl-b 的地址,没用 skl-a 的");
  assert.equal(a["skl-a"].benefited, null, "没采纳就谈不上收益");
});

test("没有尝试记录 → 采纳未知,不能当作未采纳", () => {
  for (const v of [null, {}, { verdict: "ERROR", attempts: [] }]) {
    const a = adoptionFromAcceptance(v, TOKENS);
    assert.equal(a["skl-a"].adopted, null, `${JSON.stringify(v)} 应为 unknown`);
    assert.equal(a["skl-b"].adopted, null);
  }
});

test("地址面已被记录、两个资产的地址都没用到 → 两个都判未采纳", () => {
  // 原来这里判 unknown,理由是"没有区分力"。那混淆了两件事:分不清用的是哪个资产,
  // 与看得出两个都没用到。判别性 token 的前提是"用了就会出现";记录覆盖了它该出现的
  // 那一面而它不在,就是未采纳的正面证据。
  const v = { verdict: "PASS", attempts: [attempt("192.0.2.1", "9999", true)] };
  const a = adoptionFromAcceptance(v, TOKENS);
  assert.equal(a["skl-a"].adopted, false, "操作用的地址不是它记录的那个");
  assert.equal(a["skl-b"].adopted, false);
});

// ---------------------------------------------------------------------------
// 四条分类规则 —— 参考判定是采纳,不是送达
// ---------------------------------------------------------------------------

test("已读但未采用、判未使用 → 真阴性,不是假阴性", () => {
  const c = classifyUsage({ judgedUsed: false, adopted: false });
  assert.equal(c.bucket, "true_negative",
    "送达口径会把这判成假阴性,那是把判定器的一次正确判断算成错误");
  assert.equal(c.counts_toward_rate, true);
});

test("已读但未采用、判已使用 → 假阳性", () => {
  const c = classifyUsage({ judgedUsed: true, adopted: false });
  assert.equal(c.bucket, "false_positive");
  assert.equal(c.counts_toward_rate, true);
});

test("确已采用、判未使用 → 假阴性", () => {
  const c = classifyUsage({ judgedUsed: false, adopted: true });
  assert.equal(c.bucket, "false_negative");
  assert.equal(c.counts_toward_rate, true);
});

test("确已采用、判已使用 → 真阳性", () => {
  const c = classifyUsage({ judgedUsed: true, adopted: true });
  assert.equal(c.bucket, "true_positive");
  assert.equal(c.counts_toward_rate, true);
});

test("采纳未知 → 不得塞进任何确定类别", () => {
  for (const judgedUsed of [true, false]) {
    const c = classifyUsage({ judgedUsed, adopted: null });
    assert.equal(c.bucket, "unknown_adoption", "未知就是未知");
    assert.equal(c.counts_toward_rate, false, "不能进分母");
  }
});

test("汇总单独报告未知数量与覆盖率", () => {
  const runs = [
    { run_id: "r1", assets: { "skl-a": { judgedUsed: true, adopted: true }, "skl-b": { judgedUsed: false, adopted: false } } },
    { run_id: "r2", assets: { "skl-a": { judgedUsed: true, adopted: null }, "skl-b": { judgedUsed: false, adopted: null } } },
  ];
  const r = calibrateUsage(runs);
  assert.equal(r.cumulative.true_positive, 1);
  assert.equal(r.cumulative.true_negative, 1);
  assert.equal(r.cumulative.unknown_adoption, 2, "未知单独一类");
  assert.equal(r.cumulative.decisions_rated, 2);
  assert.equal(r.cumulative.decisions_total, 4);
  assert.equal(r.cumulative.adoption_coverage, 0.5, "有采纳证据的比例要报出来");
});

test("没有任何可评样本时不产出准确率", () => {
  const r = calibrateUsage([
    { run_id: "r1", assets: { "skl-a": { judgedUsed: true, adopted: null } } },
  ]);
  assert.equal(r.cumulative.decisions_rated, 0);
  assert.equal(r.cumulative.accuracy, null, "分母为 0 时不得给出准确率");
});

// ---------------------------------------------------------------------------
// 匹配的边界与匹配面 —— 2026-09-09 独立审阅 D1 / D5 / D6
//
// 采纳判定拿 token 去比对尝试记录。比对有两个前提,原来都没验:
//   1. 命中要看**边界**。把字段拼成一段文本再 includes,端口 147318 会命中 47318。
//   2. 缺席要看**匹配面**。尝试记录只有 host/port/endpoint/url/value;一个只会出现在
//      请求体里的标记,在地址字段里查不到是理所当然的,不能读成"没采纳"。
// ---------------------------------------------------------------------------

test("端口 147318 不是 token 47318 的命中 —— 数字相邻不算边界", () => {
  const v = { verdict: "PASS", attempts: [attempt("127.0.0.1", "147318", true)] };
  const a = adoptionFromAcceptance(v, { "skl-b": { tokens: ["47318"] } });
  assert.notEqual(a["skl-b"].adopted, true, "子串命中会把一次没采纳的操作记成采纳");
});

test("IPv4 也要看边界:10.244.7.190 不是 10.244.7.19", () => {
  const v = { verdict: "PASS", attempts: [attempt("10.244.7.190", "8096", true)] };
  const a = adoptionFromAcceptance(v, { "skl-a": { tokens: ["10.244.7.19"] } });
  assert.notEqual(a["skl-a"].adopted, true);
});

test("边界修好之后,真正的命中仍然是命中", () => {
  const v = { verdict: "PASS", attempts: [attempt("10.244.7.19", "8096", false), attempt("127.0.0.1", "47318", true)] };
  const a = adoptionFromAcceptance(v, TOKENS);
  assert.equal(a["skl-a"].adopted, true);
  assert.equal(a["skl-b"].adopted, true);
});

test("单资产池也能判未采纳:记录覆盖了该 token 该出现的面,而它不在", () => {
  const v = { verdict: "PASS", attempts: [attempt("127.0.0.1", "147318", true)] };
  const a = adoptionFromAcceptance(v, { "skl-only": { tokens: ["47318"] } });
  assert.equal(a["skl-only"].adopted, false, "判未采纳不该依赖池里恰好还有另一个资产");
});

test("token 落在尝试记录不覆盖的面上 → 未知,并说明是哪一面", () => {
  const v = { verdict: "PASS", attempts: [attempt("127.0.0.1", "47318", true)] };
  const a = adoptionFromAcceptance(v, { "skl-c": { tokens: ["qz7-checklist-marker-9f31"] } });
  assert.equal(a["skl-c"].adopted, null, "地址字段里查不到请求体里的标记,不能因此说没采纳");
  assert.match(a["skl-c"].why, /缺席不能读成未采纳/);
});

test("扩展场景的 token 记在 attempt.value 上,同样算采纳", () => {
  const v = { verdict: "PASS", attempts: [{ host: "127.0.0.1", port: "47318", endpoint: "skill:get", value: "skl-Bwuta6kNQ6wq", ok: true }] };
  const a = adoptionFromAcceptance(v, { "skl-K": { tokens: ["skl-Bwuta6kNQ6wq"] }, "skl-e": { tokens: ["skl-MyrdnecjeYSb"] } });
  assert.equal(a["skl-K"].adopted, true, "请求体里的值也是操作用了什么的证据");
  assert.equal(a["skl-e"].adopted, false, "同一面上,另一个资产的值没被用到");
});

// ---------------------------------------------------------------------------
// 覆盖要精确到字段,归属要唯一,收益里的未知要留着
// —— 2026-09-09 第二轮审阅
//
// 上一轮把"缺席即未采纳"的前提写成了"该面的某个候选字段非空",太松:token 应写在
// 请求体、而记录只有 URL 没有请求体值时,仍然判 false。判 false 的前提是**如果用了
// 就一定会看见**,所以要求的是那个 token 该出现的字段被逐次完整记录,不是家族里
// 随便哪个字段出现过一次。
// ---------------------------------------------------------------------------

test("token 该出现在请求体、记录只有 URL → 未知,不是未采纳", () => {
  const v = { verdict: "PASS", attempts: [{ url: "http://127.0.0.1:47318/skill-bridge/v3/skill/get", endpoint: "skill:get", ok: true }] };
  const a = adoptionFromAcceptance(v, { "skl-c": { tokens: ["qz7-checklist-marker-9f31"] } });
  assert.equal(a["skl-c"].adopted, null, "URL 不承载请求体的值,看不见不等于没用");
});

test("有一次尝试缺了必需字段 → 整体未知:那一次可能正好用了它", () => {
  const v = { verdict: "PASS", attempts: [attempt("127.0.0.1", "47318", true), { endpoint: "skill:search", ok: false }] };
  const a = adoptionFromAcceptance(v, { "skl-a": { tokens: ["10.244.7.19"] } });
  assert.equal(a["skl-a"].adopted, null, "缺字段的那次尝试用了什么无从判断");
});

test("每一次尝试都记全了、token 一次没出现 → 才判未采纳", () => {
  const v = { verdict: "PASS", attempts: [attempt("127.0.0.1", "47318", true), attempt("127.0.0.1", "47318", false)] };
  const a = adoptionFromAcceptance(v, { "skl-a": { tokens: ["10.244.7.19"] } });
  assert.equal(a["skl-a"].adopted, false);
});

test("场景可以直接声明 token 该出现在哪个字段,声明优先于按形状猜", () => {
  const v = { verdict: "PASS", attempts: [{ host: "127.0.0.1", port: "47318", value: "skl-other", ok: true }] };
  const declared = { "skl-x": { tokens: ["47318"], adoption_fields: ["value"] } };
  const a = adoptionFromAcceptance(v, declared);
  assert.equal(a["skl-x"].adopted, false, "声明了看 value,value 里没有它");
  const noValue = adoptionFromAcceptance({ verdict: "PASS", attempts: [attempt("127.0.0.1", "47318", true)] }, declared);
  assert.equal(noValue["skl-x"].adopted, null, "声明的字段没被记录 → 未知,哪怕地址正好命中");
});

test("两个资产共享同一 token、没有独有证据 → 归属未知,不是两个都采用", () => {
  const v = { verdict: "PASS", attempts: [attempt("10.244.7.19", "8096", true)] };
  const a = adoptionFromAcceptance(v, {
    "skl-p": { tokens: ["10.244.7.19"] },
    "skl-q": { tokens: ["10.244.7.19"] },
  });
  assert.equal(a["skl-p"].adopted, null);
  assert.equal(a["skl-q"].adopted, null);
  assert.match(a["skl-p"].why, /共享|归属/);
});

test("共享 token 之外还有独有 token 命中 → 该资产仍然是采用", () => {
  const v = { verdict: "PASS", attempts: [{ host: "10.244.7.19", port: "8096", value: "rk-only-p-9f31", ok: true }] };
  const a = adoptionFromAcceptance(v, {
    "skl-p": { tokens: ["10.244.7.19", "rk-only-p-9f31"] },
    "skl-q": { tokens: ["10.244.7.19"] },
  });
  assert.equal(a["skl-p"].adopted, true, "独有 token 命中,归属没有歧义");
  assert.equal(a["skl-q"].adopted, null, "它只有共享的那一个");
});

test("收益:一次失败加一次结果未知 → 未知,不是失败", () => {
  const v = { verdict: "PASS", attempts: [attempt("10.244.7.19", "8096", false), { host: "10.244.7.19", port: "8096", ok: null }] };
  const a = adoptionFromAcceptance(v, { "skl-a": { tokens: ["10.244.7.19"] } });
  assert.equal(a["skl-a"].adopted, true);
  assert.equal(a["skl-a"].benefited, null, "读不出结果的那次可能是成功的");
});

test("收益:全部失败才是失败;有一次成功就是成功", () => {
  const bad = adoptionFromAcceptance(
    { verdict: "FAIL", attempts: [attempt("10.244.7.19", "8096", false), attempt("10.244.7.19", "8096", false)] },
    { "skl-a": { tokens: ["10.244.7.19"] } });
  assert.equal(bad["skl-a"].benefited, false);
  const good = adoptionFromAcceptance(
    { verdict: "PASS", attempts: [attempt("10.244.7.19", "8096", false), { host: "10.244.7.19", port: "8096", ok: true }] },
    { "skl-a": { tokens: ["10.244.7.19"] } });
  assert.equal(good["skl-a"].benefited, true);
});
