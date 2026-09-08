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
 *      matching here.
 *   4. Absence is only evidence if the capture is known to cover the run.
 *      The longest single request is not the whole history: turn one may
 *      carry a token in a system prompt that turn two replaces. Every
 *      request is scanned, and unless the caller asserts coverage, "not
 *      seen" is reported as `not_seen_in_capture`, not as `not_delivered`.
 *
 * Tokens come from the run's frozen `tokens.json`. A regex over asset bodies
 * would decide this on discriminativeness it never verified.
 */

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
  const needle = String(token).toLowerCase();
  const paths = new Set();
  for (const { message } of entries) {
    if (message?.role !== "assistant") continue;
    for (const t of message?.tool_calls ?? []) {
      const args = String(t?.function?.arguments ?? "");
      if (!args.toLowerCase().includes(needle)) continue;
      // Whatever path this call names is a place the token may now live.
      let parsed = null;
      try { parsed = JSON.parse(args); } catch { parsed = null; }
      for (const k of ["file_path", "path", "notebook_path"]) {
        if (parsed && typeof parsed[k] === "string") paths.add(parsed[k]);
      }
      // A shell redirect writes without a file_path field.
      const cmd = parsed && typeof parsed.command === "string" ? parsed.command : args;
      for (const m of cmd.matchAll(/(?:>>?|open\(\s*['"])\s*['"]?([^\s'"]+)/g)) paths.add(m[1]);
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
 * @param opts.attributionOf  (position, entry) => asset_id | null — what the
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
      let firstInput = null, firstAuthored = null;
      for (const e of entries) {
        const pos = { request: e.request, index: e.index };
        const role = e.message?.role;
        if (INPUT_ROLES.has(role) && textOf(e.message).toLowerCase().includes(needle)) {
          if (!firstInput || before(pos, firstInput)) firstInput = { ...pos, role, entry: e };
        }
        if (role === "assistant" && authoredTextOf(e.message).toLowerCase().includes(needle)) {
          if (!firstAuthored || before(pos, firstAuthored)) firstAuthored = { ...pos, entry: e };
        }
      }

      const at = firstInput ? `request ${firstInput.request} message ${firstInput.index}` : null;
      if (!firstInput && !firstAuthored) {
        findings.push(coverage
          ? { token: t, verdict: "not_delivered", why: "the token appears nowhere in the capture, and the capture is asserted to cover the run" }
          : { token: t, verdict: "not_seen_in_capture", why: "the token is not in the saved capture; whether the capture covers the whole run has not been checked, so this is not yet 'not delivered'" });
        continue;
      }
      if (!firstInput) {
        findings.push({ token: t, verdict: "model_authored", at: `request ${firstAuthored.request} message ${firstAuthored.index}`,
          why: "only the model's own messages and tool arguments name it; the model writing a token is not the asset reaching the model" });
        continue;
      }
      // An echo is a LINK, not an order: the arrival came from reading a
      // path the model had itself written the token into.
      const wrote = pathsModelWroteTokenInto(entries.filter((e) => before({ request: e.request, index: e.index }, firstInput)), t);
      const source = attributionOf ? attributionOf({ request: firstInput.request, index: firstInput.index }, firstInput.entry) : null;
      const sourcePath = source && typeof source === "object" ? source.path ?? "" : "";
      if (wrote.size && [...wrote].some((p) => sourcePath.includes(p) || String(source?.command ?? "").includes(p))) {
        findings.push({ token: t, verdict: "model_echo", at, wrote_paths: [...wrote],
          why: `it came back by reading ${sourcePath || "a path"} that the model had itself written this token into — its own text returning, not a delivery` });
        continue;
      }
      if (!attributionOf || !source) {
        findings.push({ token: t, verdict: "source_unknown", at, role: firstInput.role,
          why: `arrived as ${firstInput.role} at ${at}, but nothing in the record says what produced that content, so whether it came from this asset cannot be said` });
        continue;
      }
      const from = typeof source === "object" ? source.asset_id ?? null : source;
      const shared = (owners.get(t) ?? []).filter((a) => a !== assetId);
      if (from !== assetId) {
        findings.push({ token: t, verdict: "ambiguous_source", at, from: from ?? "not an asset", shared_with: shared,
          why: `arrived at ${at} from ${from ?? "something that is not a pool asset"}; an alternative source carries this token, which does not show this asset reached the model` });
        continue;
      }
      if (!operation) {
        findings.push({ token: t, verdict: "delivered_order_unknown", at,
          why: `came from this asset at ${at}, but the operation being judged has no resolved position, so whether it arrived first is unknown` });
        continue;
      }
      if (!before({ request: firstInput.request, index: firstInput.index }, operation)) {
        findings.push({ token: t, verdict: "after_operation", at, operation_at: `request ${operation.request} message ${operation.index}`,
          why: `came from this asset at ${at}, after the operation at request ${operation.request} message ${operation.index}; later content cannot explain an earlier operation` });
        continue;
      }
      findings.push({ token: t, verdict: "delivered", at, operation_at: `request ${operation.request} message ${operation.index}`,
        why: `came from this asset at ${at}, before the operation` });
    }
    const rank = ["delivered", "ambiguous_source", "source_unknown", "delivered_order_unknown", "after_operation",
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
  return { request: at >= 0 ? at : 0, index: Number(idx), request_id: reqId, resolved_request: at >= 0 };
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
      // A skill read names the asset in the request body it sends.
      let asset_id = null;
      const m = /"skill_id"\s*:\s*"([^"]+)"/.exec(command) || /"skill_id"\s*:\s*"([^"]+)"/.exec(args);
      if (m && /\/skill\/(get|files\/read|export)/.test(command)) asset_id = m[1];
      byCallId.set(t.id, { asset_id, path, command: command.slice(0, 200), tool: t?.function?.name ?? null });
    }
  }
  return (_pos, entry) => {
    const id = entry?.message?.tool_call_id;
    return id ? (byCallId.get(id) ?? null) : null;
  };
}

export function summarizeDelivery(audit) {
  return Object.entries(audit.assets).map(([id, a]) => `${id}: ${a.verdict}` +
    (a.findings.length ? ` (${a.findings.map((f) => `${f.token}→${f.verdict}`).join(", ")})` : ""));
}
