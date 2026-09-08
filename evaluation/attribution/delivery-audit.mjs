/**
 * Did a pool asset's content actually reach the model, before the operation
 * being judged, and can the arrival be attributed to that asset?
 *
 * The confounder detector this replaces watched one channel — skill-API
 * reads — and reported "0 non-pool reads" for a run whose captured body
 * plainly carried a hidden asset's address. A report that says isolation
 * held while outside content did reach the model cannot tell an isolation
 * failure from an attribution error, which is what the calibration turns on.
 *
 * Scanning for tokens and calling every hit a delivery would be worse than
 * the blind spot: it would rewrite a real false positive into an "isolation
 * failure" and hide the error. Four boundaries, and each is a place an
 * earlier draft of this file got it wrong:
 *
 *   1. What the model RECEIVED is not what the model WROTE — and what the
 *      model wrote includes its tool-call ARGUMENTS, not just its prose. A
 *      token written into a Write argument and read back was invisible to a
 *      content-only scan and came out as a delivery. Nor is order an echo
 *      relation: the model mentioning an address from memory and later
 *      genuinely reading the asset is a delivery, not an echo. An echo is
 *      established by the LINK — the arrival came from reading a path the
 *      model had itself written the token into.
 *   2. First arrival, and it must precede the operation being judged. The
 *      operation's position comes from the used-event's `target_ref`
 *      (`request(<id>):msg[<n>]:<call>`), which the runner already records.
 *   3. A token is not an asset, and a command that merely NAMES an asset is
 *      not a fetch of it: `grep skl-x /tmp/other-memory` mentions the id and
 *      reads something else. Attribution comes from the collector, which
 *      knows what each request actually returned — never from substring
 *      matching here. Finding ANOTHER source is a result in its own right
 *      (`delivered_from_other_source`) and must not be filed with "no source
 *      could be found" (`source_unknown`): the first says content reached the
 *      model by a route that is known, which is what an isolation failure
 *      looks like; the second says the record does not reach.
 *   4. Absence is only evidence if the capture is known to cover the run.
 *      The longest single request is not the whole history: turn one may
 *      carry a token in a system prompt that turn two replaces. Every
 *      request is scanned, and unless the caller asserts coverage, "not
 *      seen" is reported as `not_seen_in_capture`, not as `not_delivered`.
 *
 * Tokens come from the run's frozen `tokens.json`. A regex over asset bodies
 * would decide this on discriminativeness it never verified.
 */

/**
 * Does this text carry the token?
 *
 * Not as simply as it sounds. A search result does not hand back the asset's
 * text: SQLite's FTS5 snippet splits on punctuation and pads with spaces, so
 * `10.244.7.19` arrives as `10.244 . 7.19`. A contiguous-substring match
 * misses that, and missing an arrival is the direction that hides a leak —
 * it reads as "not delivered", which the calibration files as a clean true
 * negative. One real false positive in the record was this and nothing else.
 *
 * So whitespace is normalised away as a fallback, and the match reports HOW
 * it matched: gluing text together can in principle join two unrelated
 * numbers across a line break, and a reader should be able to tell an exact
 * hit from a reconstructed one.
 */
export function containsToken(text, token) {
  const t = String(text ?? "");
  const needle = String(token ?? "").toLowerCase();
  if (!needle) return { hit: false, mode: null };
  if (t.toLowerCase().includes(needle)) return { hit: true, mode: "exact" };
  const squeeze = (x) => x.toLowerCase().replace(/\s+/g, "");
  if (squeeze(t).includes(squeeze(needle))) return { hit: true, mode: "whitespace_normalised" };
  return { hit: false, mode: null };
}

const INPUT_ROLES = new Set(["system", "user", "tool"]);

function textOf(message) {
  const c = message?.content;
  if (typeof c === "string") return c;
  if (c == null) return "";
  try { return JSON.stringify(c); } catch { return ""; }
}

/** Everything the model itself produced in a message: prose and arguments. */
function authoredTextOf(message) {
  const parts = [textOf(message)];
  for (const t of message?.tool_calls ?? []) {
    const fn = t?.function ?? {};
    parts.push(String(fn.arguments ?? ""));
  }
  return parts.join("\n");
}

/** Every message across every request, each with where it sat. */
export function allMessages(requests) {
  const out = [];
  (requests ?? []).forEach((r, ri) => {
    const body = r?.body ?? {};
    const json = (body && typeof body === "object" && "json" in body) ? body.json : body;
    (json?.messages ?? []).forEach((m, mi) => out.push({ request: ri, index: mi, message: m }));
  });
  return out;
}

/** Position ordering: request first, then message index within it. */
const before = (a, b) => a.request < b.request || (a.request === b.request && a.index < b.index);

/**
 * Paths the model wrote a token into, by tool-call argument. Used to
 * establish an echo by LINK rather than by order: an arrival that came from
 * reading one of these paths is the model's own text coming back.
 */
export function pathsModelWroteTokenInto(entries, token) {
  const paths = new Set();
  for (const { message } of entries) {
    if (message?.role !== "assistant") continue;
    for (const t of message?.tool_calls ?? []) {
      const args = String(t?.function?.arguments ?? "");
      if (!containsToken(args, token).hit) continue;
      // Whatever path this call names is a place the token may now live.
      let parsed = null;
      try { parsed = JSON.parse(args); } catch { parsed = null; }
      for (const k of ["file_path", "path", "notebook_path"]) {
        if (parsed && typeof parsed[k] === "string") paths.add(parsed[k]);
      }
      // A shell redirect writes without a file_path field.
      const cmd = parsed && typeof parsed.command === "string" ? parsed.command : args;
      // Only things shaped like a path; `b)` out of `if (a > b)` is not one.
      for (const m of cmd.matchAll(/(?:>>?|open\(\s*['"])\s*['"]?([^\s'"]+)/g)) { if (m[1].includes("/")) paths.add(m[1]); }
    }
  }
  return paths;
}

/**
 * @param requests  the run's captured model requests
 * @param tokens    the run's frozen tokens.json: { asset_id: { tokens: [...] } }
 * @param opts.operation  { request, index } of the operation being judged,
 *                        resolved from the used-event's target_ref; null when
 *                        unknown, which makes the ordering unknown rather
 *                        than assumed
 * @param opts.attributionOf  (position, entry, token) => { asset_id, … } | null — what the
 *                        collector says this content actually came from.
 *                        Never inferred from strings here.
 * @param opts.coverageAsserted  true only when the caller has checked the
 *                        capture covers the run; otherwise absence is
 *                        reported as "not seen", not as "not delivered".
 */
export function auditDelivery(requests, tokens, opts = {}) {
  const entries = allMessages(requests);
  const operation = opts.operation ?? null;
  const attributionOf = typeof opts.attributionOf === "function" ? opts.attributionOf : null;
  const coverage = opts.coverageAsserted === true;

  const owners = new Map();
  for (const [assetId, spec] of Object.entries(tokens ?? {})) {
    for (const t of spec?.tokens ?? []) {
      if (!owners.has(t)) owners.set(t, []);
      owners.get(t).push(assetId);
    }
  }

  const assets = {};
  for (const [assetId, spec] of Object.entries(tokens ?? {})) {
    const findings = [];
    for (const t of spec?.tokens ?? []) {
      const needle = String(t).toLowerCase();

      // EVERY arrival, not just the first (2026-09-08l). Taking only the
      // earliest let a knowledge file mask a genuine read of the asset that
      // happened later and still before the operation: the verdict then
      // rested on "content arrived from somewhere", and would have handed
      // out the same true positive had the real read never happened. The
      // conclusion was right in batch 3; the reasoning was not.
      const inputs = [], authored = [];
      for (const e of entries) {
        const pos = { request: e.request, index: e.index };
        const role = e.message?.role;
        const asInput = INPUT_ROLES.has(role) ? containsToken(textOf(e.message), t) : { hit: false };
        if (asInput.hit) inputs.push({ ...pos, role, entry: e, match: asInput.mode });
        if (role === "assistant" && containsToken(authoredTextOf(e.message), t).hit) authored.push(pos);
      }
      const where = (p) => `request ${p.request} message ${p.index}`;

      if (!inputs.length && !authored.length) {
        findings.push(coverage
          ? { token: t, verdict: "not_delivered", why: "the token appears nowhere in the capture, and the capture is asserted to cover the run" }
          : { token: t, verdict: "not_seen_in_capture", why: "the token is not in the saved capture; whether the capture covers the whole run has not been checked, so this is not yet 'not delivered'" });
        continue;
      }
      if (!inputs.length) {
        findings.push({ token: t, verdict: "model_authored", at: where(authored[0]),
          why: "only the model's own messages and tool arguments name it; the model writing a token is not the asset reaching the model" });
        continue;
      }

      // Judge each arrival on its own: an echo among the later ones is just
      // as much an echo, and checking only the first left that open.
      const judged = inputs.map((hit) => {
        const source = attributionOf ? attributionOf({ request: hit.request, index: hit.index }, hit.entry, t) : null;
        const callArgs = String((source && typeof source === "object" && source.args) || "");
        if (containsToken(callArgs, t).hit) {
          return { ...hit, kind: "echo", why: "the call that produced this result already carried the token in its own arguments — the result is echoing its own command" };
        }
        const wrote = pathsModelWroteTokenInto(entries.filter((e) => before({ request: e.request, index: e.index }, hit)), t);
        const sourcePath = source && typeof source === "object" ? source.path ?? "" : "";
        const samePath = (pth) => {
          if (!pth.includes("/")) return false;
          const base = pth.split("/").pop();
          return sourcePath === pth || (!!base && sourcePath.split("/").pop() === base);
        };
        if (wrote.size && [...wrote].some(samePath)) {
          return { ...hit, kind: "echo", why: `it came back by reading ${sourcePath || "a path"} that the model had itself written this token into` };
        }
        if (!attributionOf || !source) return { ...hit, kind: "unattributed", why: "nothing in the record says what produced this content" };
        const from = typeof source === "object" ? source.asset_id ?? null : source;
        const place = (typeof source === "object" && (source.path || source.command)) || null;
        return from === assetId
          ? { ...hit, kind: "asset", from, why: "came from this asset" }
          : { ...hit, kind: "other", from, place, why: `came from ${from ?? `something that is not a pool asset${place ? ` (${String(place).slice(0, 80)})` : ""}`}` };
      });

      // An echo is not an arrival anywhere, so it leaves the whole set — not
      // just the in-time slice (2026-09-08m). Leaving echoes in `judged` let
      // a run whose only appearances were the model quoting itself fall
      // through to `after_operation`, which says "it arrived, just late"
      // about content that never arrived, and named an echo as the arrival.
      const real = judged.filter((h) => h.kind !== "echo");
      const inTime = operation ? real.filter((h) => before({ request: h.request, index: h.index }, operation)) : real;
      const arrivals = inTime;
      const trail = judged.map((h) => ({ at: where(h), kind: h.kind, from: h.from ?? null, match: h.match ?? null, why: h.why }));

      if (!arrivals.length) {
        if (!real.length) {
          // Nothing reached the model. Two shapes, kept apart because they
          // say different things about the record: the token came back as
          // input but only as the model's own words returning (echo), or it
          // never appeared on the input side at all (authored).
          findings.push(judged.length
            ? { token: t, verdict: "model_echo", at: where(judged[0]), arrivals: trail,
                why: `${judged[0].why} — nothing reached the model; every appearance on the input side is its own text coming back` }
            : { token: t, verdict: "model_authored", at: where(authored[0]), arrivals: trail,
                why: "only the model's own messages and tool arguments name it; the model writing a token is not the asset reaching the model" });
          continue;
        }
        // Something did arrive, but not before what is being judged.
        findings.push({ token: t, verdict: "after_operation", at: where(real[0]), arrivals: trail, operation_at: where(operation),
          why: `every arrival is at or after the operation at ${where(operation)}; later content cannot explain an earlier operation` });
        continue;
      }
      if (!operation) {
        findings.push({ token: t, verdict: "delivered_order_unknown", at: where(arrivals[0]), arrivals: trail,
          why: "content arrived, but the operation being judged has no resolved position, so whether it arrived first is unknown" });
        continue;
      }
      // One arrival from the asset itself settles it, wherever it sits among
      // the others; an identified other source is the next strongest.
      const own = arrivals.find((h) => h.kind === "asset");
      if (own) { findings.push({ token: t, verdict: "delivered", at: where(own), arrivals: trail, operation_at: where(operation), why: `came from this asset at ${where(own)}, before the operation` }); continue; }
      const other = arrivals.find((h) => h.kind === "other");
      if (other) {
        findings.push({ token: t, verdict: "delivered_from_other_source", at: where(other), arrivals: trail, from: other.from ?? "not a pool asset", where: other.place, shared_with: (owners.get(t) ?? []).filter((a) => a !== assetId),
          why: `${other.why} at ${where(other)}; the content reached the model, and no arrival before the operation came from this asset` });
        continue;
      }
      findings.push({ token: t, verdict: "source_unknown", at: where(arrivals[0]), arrivals: trail,
        why: `content arrived at ${where(arrivals[0])}, but nothing in the record says what produced it, so whether it came from this asset cannot be said` });
    }
    const rank = ["delivered", "delivered_from_other_source", "source_unknown", "delivered_order_unknown", "after_operation",
                  "not_seen_in_capture", "model_echo", "model_authored", "not_delivered"];
    const verdict = rank.find((v) => findings.some((f) => f.verdict === v)) ?? "not_delivered";
    assets[assetId] = { verdict, findings };
  }
  return { messages_scanned: entries.length, requests_scanned: (requests ?? []).length, coverage_asserted: coverage, operation, assets };
}

/**
 * The message a used-event's `target_ref` points at:
 * `request(<id>):msg[<n>]:<call_id>:<field>`. The runner records this, so an
 * operation's position does not have to be guessed.
 */
export function operationFromTargetRef(targetRef, requests) {
  const m = /^request\(([^)]+)\):msg\[(\d+)\]/.exec(String(targetRef ?? ""));
  if (!m) return null;
  const [, reqId, idx] = m;
  const at = (requests ?? []).findIndex((r) => String(r?.requestId ?? r?.request_id ?? "") === reqId);
  // Unresolvable means unknown, not request 0 (2026-09-08k). Anchoring to
  // the first request makes every later arrival look like it came after the
  // operation, which is the direction that hides a leak — and the caller
  // had no flag it was obliged to read.
  if (at < 0) return null;
  return { request: at, index: Number(idx), request_id: reqId, resolved_request: true };
}

/**
 * Attribution from the capture itself: a tool result carries the id of the
 * call that produced it, and that call's arguments say what was fetched. So
 * "what did this content come from" is read from the record rather than
 * guessed from the text.
 *
 * An asset id is only returned when the call actually asked for that asset —
 * a skill read naming it in `skill_id`. A command that merely mentions an id
 * (`grep skl-x /tmp/other`) yields the command, not the asset.
 */
export function attributionFromCapture(requests) {
  const byCallId = new Map();
  for (const { message } of allMessages(requests)) {
    for (const t of message?.tool_calls ?? []) {
      if (!t?.id) continue;
      const args = String(t?.function?.arguments ?? "");
      let parsed = null;
      try { parsed = JSON.parse(args); } catch { parsed = null; }
      const command = typeof parsed?.command === "string" ? parsed.command : "";
      const path = typeof parsed?.file_path === "string" ? parsed.file_path : (typeof parsed?.path === "string" ? parsed.path : "");
      byCallId.set(t.id, { path, command: command.slice(0, 200), args, tool: t?.function?.name ?? null });
    }
  }
  return (_pos, entry, token) => {
    const id = entry?.message?.tool_call_id;
    if (!id) return null;
    const call = byCallId.get(id);
    if (!call) return null;
    // The response is the binding: the server says which asset it returned.
    // Reading the request instead misses `get-by-name`, which asks by name,
    // and cannot tell which of a search's several results carried the token.
    return { ...call, asset_id: assetOwningTokenInResult(textOf(entry.message), token) };
  };
}

/**
 * Which asset a token belongs to inside a tool result. A result carries the
 * response verbatim, and a skill response names its `skill_id`; a search
 * response names one per hit. The token sits inside one hit's body, so the
 * asset is the one whose id most closely precedes it. Returns null when the
 * result names no asset, or when the token appears before any of them.
 */
/**
 * Every balanced `{…}` / `[…]` span in a string, outermost first. Quotes and
 * escapes are respected, so a brace inside a JSON string does not throw the
 * count off. Bounded work: a span that never closes is skipped.
 */
export function jsonCandidates(text) {
  const s = String(text ?? "");
  const out = [];
  for (let i = 0; i < s.length; i += 1) {
    const open = s[i];
    if (open !== "{" && open !== "[") continue;
    const close = open === "{" ? "}" : "]";
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < s.length; j += 1) {
      const ch = s[j];
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === open) depth += 1;
      else if (ch === close) {
        depth -= 1;
        if (depth === 0) { out.push(s.slice(i, j + 1)); i = i; break; }
      }
    }
  }
  return out;
}

export function assetOwningTokenInResult(text, token) {
  const s = String(text ?? "");
  const needle = String(token ?? "").toLowerCase();
  if (!needle || !containsToken(s, token).hit) return null;
  // Parse rather than count bytes (2026-09-08k). Byte offsets assume every
  // hit writes its skill_id before its body; a response that puts the body
  // first hands the token to the previous hit, silently.
  //
  // A tool result is `Command: curl … -d '{"skill_name":"…"}'` and THEN the
  // response, so the first `{` in the text belongs to the command, not the
  // envelope — taking it lost every real attribution in the off arm the
  // first time this was written. Every balanced candidate is tried, and the
  // one that actually contains the token is the one that answers.
  let parsed = null;
  for (const candidate of jsonCandidates(s)) {
    if (!containsToken(candidate, token).hit) continue;
    try { parsed = JSON.parse(candidate); break; } catch { /* not this one */ }
  }
  if (parsed == null) return null;
  // The owner is the nearest enclosing object that names a skill_id.
  let owner = null;
  const walk = (node, inherited) => {
    if (owner) return;
    if (Array.isArray(node)) { for (const v of node) walk(v, inherited); return; }
    if (node && typeof node === "object") {
      const mine = typeof node.skill_id === "string" ? node.skill_id : inherited;
      for (const v of Object.values(node)) walk(v, mine);
      return;
    }
    if (typeof node === "string" && containsToken(node, token).hit) owner = inherited ?? null;
  };
  walk(parsed, null);
  return owner;
}

/**
 * Does the capture cover the whole run?
 *
 * "The token is not in the capture" is only evidence of absence if the
 * capture is the whole conversation. A non-empty file is not that: the probe
 * could have been attached late, or stopped early, and either way the file
 * looks fine. So coverage is checked from the shape of the exchange rather
 * than asserted:
 *
 *   - every request has its response and every response its request;
 *   - nothing was truncated and every response is 2xx;
 *   - a turn that ends `tool_calls` is asking to continue, so it must be
 *     followed by another request — if the last turn asks to continue and
 *     nothing follows, the capture stops mid-run;
 *   - the conversation starts at its start: a first request already holding
 *     assistant or tool turns was captured after the run began;
 *   - each request extends the one before it, since every turn carries the
 *     whole history — a divergence means a missing turn, a splice, or a
 *     replaced system prompt;
 *   - the last turn ends on a terminal reason (`stop` / `end_turn`).
 *     `length` terminates too, but because the model was cut off, which is
 *     reported rather than treated as a clean end.
 *
 * Returns { complete, reasons } — reasons are why not, and are empty when it
 * is complete.
 */
export function verifyCoverage(rows) {
  const reasons = [];
  const requests = (rows ?? []).filter((r) => r?.event === "http.request");
  const responses = (rows ?? []).filter((r) => r?.event === "http.response");
  if (!requests.length) return { complete: false, reasons: ["the capture holds no model request at all"], requests: 0, responses: 0 };

  const reqIds = new Set(requests.map((r) => r.requestId));
  const resById = new Map(responses.map((r) => [r.requestId, r]));
  for (const r of requests) if (!resById.has(r.requestId)) reasons.push(`request ${r.requestId} has no response — the capture stops inside a turn`);
  for (const r of responses) if (!reqIds.has(r.requestId)) reasons.push(`response ${r.requestId} has no request — the capture starts inside a turn`);

  const finishOf = (res) => {
    const txt = (res?.body ?? {}).text ?? "";
    const all = [...String(txt).matchAll(/"finish_reason"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
    return all.length ? all[all.length - 1] : null;
  };
  // Where the conversation starts. A run begins with the system prompt and
  // the task; a first request that already holds assistant turns or tool
  // results was captured after the run had begun — the probe attached late
  // (2026-09-08k). Everything else about such a file looks perfect, which is
  // why this has to be checked rather than assumed.
  const msgsOf = (r) => (((r?.body ?? {}).json ?? r?.body ?? {}).messages ?? []);
  const first = msgsOf(requests[0]);
  if (first.some((m) => m?.role === "assistant" || m?.role === "tool")) {
    reasons.push("the first captured request already contains assistant or tool messages — it begins mid-conversation, so earlier turns are not in this file");
  }
  // Each turn carries the whole history so far, so every request must extend
  // the one before it. A history that diverges means a turn is missing, or
  // that two runs were spliced, or that a system prompt was replaced — and a
  // replaced system prompt is exactly where a token can vanish from view.
  for (let i = 1; i < requests.length; i += 1) {
    const prev = msgsOf(requests[i - 1]), cur = msgsOf(requests[i]);
    if (cur.length < prev.length) { reasons.push(`request ${i} carries fewer messages than request ${i - 1} — the history shrank`); continue; }
    const same = prev.every((m, k) => JSON.stringify(m) === JSON.stringify(cur[k]));
    if (!same) reasons.push(`request ${i} does not extend request ${i - 1} — the earlier history was changed or a turn is missing`);
  }

  const ordered = requests.map((r) => ({ req: r, res: resById.get(r.requestId) })).filter((p) => p.res);
  ordered.forEach((p, i) => {
    const b = p.res.body ?? {};
    if (b.truncated) reasons.push(`response ${i} was truncated, so its content is not all here`);
    const status = Number(p.res.status ?? 0);
    if (status < 200 || status >= 300) reasons.push(`response ${i} returned ${status}`);
    const fin = finishOf(p.res);
    const last = i === ordered.length - 1;
    if (!last && fin && fin !== "tool_calls") {
      // A turn that ended cleanly followed by more turns is not a gap, but it
      // does mean the run continued past a natural end; worth naming.
      reasons.push(`turn ${i} ended "${fin}" yet more turns follow — the capture may join two runs`);
    }
    if (last) {
      if (fin === "tool_calls") reasons.push(`the last turn ended "tool_calls" — it asked to continue and nothing follows, so the capture stops mid-run`);
      else if (fin === "length") reasons.push(`the last turn ended "length" — the model was cut off; the run ended, but not by finishing`);
      else if (!fin) reasons.push("the last turn carries no finish_reason, so whether the run ended cannot be told");
    }
  });
  return { complete: reasons.length === 0, reasons, requests: requests.length, responses: responses.length };
}

/**
 * Is a frozen token actually discriminative for this run?
 *
 * The module refuses to pull tokens out of asset bodies with a regex,
 * because discriminativeness would then never have been checked. The frozen
 * `tokens.json` has the same problem unless it is checked too: `47318` is a
 * bare five-digit number, and a token already present in the run's opening
 * request is not evidence of anything a later arrival delivered — it was in
 * the room before the task started.
 *
 * Returns one entry per token: `ok`, or why it cannot carry a verdict.
 */
export function verifyTokensDiscriminative(requests, tokens) {
  const first = (() => {
    const r = (requests ?? [])[0];
    const body = r?.body ?? {};
    const json = (body && typeof body === "object" && "json" in body) ? body.json : body;
    return (json?.messages ?? []).map((m) => textOf(m)).join("\n").toLowerCase();
  })();
  const out = {};
  for (const [assetId, spec] of Object.entries(tokens ?? {})) {
    for (const t of spec?.tokens ?? []) {
      const key = `${assetId}:${t}`;
      if (containsToken(first, t).hit) {
        out[key] = { ok: false, why: "the token is already in the run's opening request, so its later presence shows nothing" };
      } else if (/^\d{1,6}$/.test(String(t))) {
        out[key] = { ok: true, warn: "a bare number can occur by chance; it carries a verdict here only because it is absent from the opening request" };
      } else {
        out[key] = { ok: true };
      }
    }
  }
  return out;
}

export function summarizeDelivery(audit) {
  return Object.entries(audit.assets).map(([id, a]) => `${id}: ${a.verdict}` +
    (a.findings.length ? ` (${a.findings.map((f) => `${f.token}→${f.verdict}`).join(", ")})` : ""));
}
