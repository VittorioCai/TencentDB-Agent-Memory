/**
 * Did a pool asset's content actually reach the model, before the operation
 * being judged?
 *
 * The confounder detector this replaces watched one channel — skill-API
 * reads (`get` / `get-by-name`) — and reported "0 non-pool reads" for a run
 * whose captured request body plainly carried a hidden asset's address. A
 * report that says "isolation held" while content from outside the pool did
 * reach the model cannot be used to tell an isolation failure from an
 * attribution error, which is what the calibration rules turn on.
 *
 * So this asks about content, not about channels: the capture holds
 * everything sent to the model, whatever route it took. Scanning it and
 * calling every hit a delivery would be worse than the blind spot, though,
 * because it would rewrite a real false positive into an "isolation
 * failure" and hide the error. Four boundaries keep it honest:
 *
 *   1. What the model RECEIVED is not what the model WROTE. Only system,
 *      user and tool messages are input. An assistant message that names a
 *      token is the model's own text, and replaying that message on the
 *      next turn does not make it a delivery. A tool result counts as
 *      input, but its content can still be the model's: writing a token to
 *      a file and reading the file back is an echo, not a delivery, so an
 *      input hit preceded by the model having written that token is
 *      `model_echo`.
 *   2. First arrival, and it must precede the operation. Content that
 *      arrived later cannot explain an earlier operation, and a replay is
 *      not a new delivery.
 *   3. A token is not an asset. When the frozen list maps a token to more
 *      than one asset — or another source in the run carries it — the hit
 *      shows an alternative source exists, not that the hidden asset
 *      leaked: `ambiguous_source`, which is neither a clean isolation nor a
 *      failure.
 *   4. "Not found" only means "not delivered" if the capture covers enough.
 *      Otherwise `unknown`.
 *
 * The tokens come from the run's frozen `tokens.json`, not from a regex over
 * asset bodies: a discriminative-token list is part of what a batch freezes,
 * and an extractor that pulls `host` where the claim is `host:port` would
 * decide this on something it never verified.
 */

/** Roles whose content the model received rather than produced. */
const INPUT_ROLES = new Set(["system", "user", "tool"]);

function textOf(message) {
  const c = message?.content;
  if (typeof c === "string") return c;
  try { return JSON.stringify(c ?? ""); } catch { return ""; }
}

/**
 * The fullest message history in a capture. Each request carries the whole
 * conversation so far, so the longest one is the complete sequence and a
 * message's position in it is its position in the run.
 */
export function longestHistory(requests) {
  let best = [];
  for (const r of requests ?? []) {
    const body = r?.body ?? {};
    const json = (body && typeof body === "object" && "json" in body) ? body.json : body;
    const msgs = json?.messages;
    if (Array.isArray(msgs) && msgs.length > best.length) best = msgs;
  }
  return best;
}

/**
 * Where a token first appears, told apart by who put it there.
 * Returns { input, assistant } as message indices, or null when absent.
 */
export function firstAppearances(messages, token) {
  let input = null, assistant = null;
  const needle = String(token).toLowerCase();
  messages.forEach((m, i) => {
    if (!textOf(m).toLowerCase().includes(needle)) return;
    const role = m?.role;
    if (INPUT_ROLES.has(role)) { if (input === null) input = i; }
    else if (role === "assistant") { if (assistant === null) assistant = i; }
  });
  return { input, assistant };
}

/**
 * @param requests   the run's captured model requests
 * @param tokens     the run's frozen tokens.json: { asset_id: { tokens: [...] } }
 * @param opts.operationIndex  message index of the operation being judged;
 *                             null when it is not known, which makes the
 *                             ordering `unknown` rather than assumed
 * @param opts.captureComplete false when the capture is known to be partial
 * @param opts.sourceOf  (messageIndex) => string — what produced that
 *   message, when the run recorded it (the collector keeps the command
 *   beside each delivered result). Without it a token hit says only that
 *   the content arrived; with it the hit can be attributed, or not: content
 *   that arrived by reading the asset is that asset, and content carrying
 *   its token that arrived from somewhere else shows an alternative source
 *   rather than a leak.
 */
export function auditDelivery(requests, tokens, opts = {}) {
  const messages = longestHistory(requests);
  const operationIndex = opts.operationIndex ?? null;
  const complete = opts.captureComplete !== false && messages.length > 0;

  // Which assets each token could speak for. A token on more than one asset
  // cannot single any of them out.
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
      if (!complete) { findings.push({ token: t, verdict: "unknown", why: "the capture is empty or was not complete enough to say" }); continue; }
      const { input, assistant } = firstAppearances(messages, t);
      const shared = (owners.get(t) ?? []).filter((a) => a !== assetId);

      if (input === null && assistant === null) {
        findings.push({ token: t, verdict: "not_delivered", why: "the token appears nowhere in what the model was sent or wrote" });
        continue;
      }
      if (input === null) {
        findings.push({ token: t, verdict: "model_authored", at: assistant,
          why: `only the model's own messages name it (first at ${assistant}); the model writing a token is not the asset reaching the model` });
        continue;
      }
      if (assistant !== null && assistant < input) {
        findings.push({ token: t, verdict: "model_echo", at: input, model_wrote_at: assistant,
          why: `the model wrote it at ${assistant} before it came back as input at ${input} — an echo of its own text, not a delivery` });
        continue;
      }
      const role = messages[input]?.role ?? "?";
      if (shared.length) {
        findings.push({ token: t, verdict: "ambiguous_source", at: input, role, shared_with: shared,
          why: `the frozen list gives this token to ${shared.length + 1} assets (${[assetId, ...shared].join(", ")}), so its arrival shows an alternative source exists, not that this asset leaked` });
        continue;
      }
      // What produced the message the token arrived in. A token is not an
      // asset: the same address can sit in another skill, in the agent's own
      // memory, in a note the run wrote earlier. If the run recorded what
      // fetched this content and it was not this asset, the hit shows an
      // alternative source — neither a clean isolation nor a leak.
      // Unknown is unknown. An earlier version treated "the run did not
      // record what produced this message" as "it was not this asset", which
      // turned a gap in the record into a finding — the same mistake the
      // channel-watching detector made, in the other direction.
      const source = typeof opts.sourceOf === "function" ? opts.sourceOf(input) : null;
      if (typeof opts.sourceOf === "function" && !source) {
        findings.push({ token: t, verdict: "source_unknown", at: input, role,
          why: `arrived as ${role} at ${input}, but the run did not record what produced that message, so whether it came from this asset cannot be said` });
        continue;
      }
      if (source) {
        const names = source.includes(assetId) || (spec?.name && source.includes(spec.name));
        if (!names) {
          findings.push({ token: t, verdict: "ambiguous_source", at: input, role, source: String(source).slice(0, 160),
            why: `arrived as ${role} at ${input} from something that does not name this asset (${String(source).slice(0, 80)}), so an alternative source carries the token; it does not show this asset reached the model` });
          continue;
        }
      }
      if (operationIndex === null) {
        findings.push({ token: t, verdict: "delivered_order_unknown", at: input, role,
          why: `arrived as ${role} at ${input}, but the operation being judged carries no message index, so whether it arrived first is unknown` });
        continue;
      }
      if (input > operationIndex) {
        findings.push({ token: t, verdict: "after_operation", at: input, role, operation_at: operationIndex,
          why: `arrived as ${role} at ${input}, after the operation at ${operationIndex}; later content cannot explain an earlier operation` });
        continue;
      }
      findings.push({ token: t, verdict: "delivered", at: input, role, operation_at: operationIndex,
        why: `arrived as ${role} at ${input}, before the operation at ${operationIndex}` });
    }
    // The asset's own verdict is the strongest finding among its tokens:
    // one delivery is a delivery; short of that, one ambiguity is an
    // ambiguity; and an unknown is never reported as clean.
    const rank = ["delivered", "ambiguous_source", "source_unknown", "delivered_order_unknown", "after_operation", "unknown", "model_echo", "model_authored", "not_delivered"];
    const verdict = rank.find((v) => findings.some((f) => f.verdict === v)) ?? "not_delivered";
    assets[assetId] = { verdict, findings };
  }
  return { messages_scanned: messages.length, capture_complete: complete, operation_index: operationIndex, assets };
}

/** One line per asset, for a report. */
export function summarizeDelivery(audit) {
  return Object.entries(audit.assets).map(([id, a]) => `${id}: ${a.verdict}` +
    (a.findings.length ? ` (${a.findings.map((f) => `${f.token}→${f.verdict}`).join(", ")})` : ""));
}
