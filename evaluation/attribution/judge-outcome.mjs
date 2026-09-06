/**
 * Outcome judge (P4-4): from `used` events and the acceptance verdict, produce
 * `validated`, `corrected` and `needs_review` events.
 *
 * The one rule: **an asset's outcome is tied to the specific call it fed, never
 * to how the run went overall.** Two misjudgements follow from grading assets
 * by task success, and both happened in the mainline scenario's own data:
 *
 *   1. The model dials the wrong address, fails, then dials the right one and
 *      succeeds. The run passes. Task-level grading marks BOTH assets validated,
 *      including the one that produced a failure.
 *   2. The right asset is used, the service happens to be down for that call.
 *      Task-level grading marks the correct asset corrected.
 *
 * So every `used` event is followed back to its call_id, that call's own
 * outcome is read from the verdict's attempts, and:
 *
 *   validated        the call succeeded AND the run's acceptance passed
 *   corrected(wrong) the call failed, the failure is a reachability class, and
 *                    the address dialled is the asset's own value — the content
 *                    explains the failure
 *   needs_review     everything else: the token appeared in something that was
 *                    not an acceptance attempt; the call failed for a reason the
 *                    content does not explain (service fault, rate limit); the
 *                    call succeeded but the run did not pass; the outcome could
 *                    not be read. Better left for a person than guessed.
 *
 * `used_soft` never produces validated: a model's opinion that an asset was
 * related is not evidence that its content drove a call.
 *
 * Usage:
 *   node evaluation/attribution/judge-outcome.mjs <used-events.jsonl> <verdict.json> <tokens.json> [--out=FILE]
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { eventId, parseJsonl } from "../provenance/build-events.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_OUT = join(HERE, "artifacts", "outcome-events.jsonl");

/** Failure classes that an address written in an asset can explain. */
export const REACHABILITY = new Set(["timed out", "could not connect"]);

/** The call id a `used` event's target_ref points at, or null. */
export function callIdOf(targetRef) {
  const m = /(call_[A-Za-z0-9_-]+)/.exec(String(targetRef ?? ""));
  return m ? m[1] : null;
}

/**
 * Does the asset's content explain this failed attempt? Only when the address
 * the model actually dialled carries one of the asset's discriminative tokens.
 * A token appearing elsewhere in the command (a comment, a header) does not
 * make the asset responsible for where the request went.
 */
export function dialledToken(attempt, tokens) {
  const dialled = [
    attempt.host && attempt.port ? `${attempt.host}:${attempt.port}` : null,
    attempt.host ?? null,
    attempt.port ?? null,
  ].filter(Boolean).map(String);
  return tokens.find((t) => dialled.some((d) => d === t || d.includes(t))) ?? null;
}

/** Decide the outcome state for one used event against its own call. */
export function outcomeOf({ used, attempt, tokens, verdict }) {
  if (!attempt) {
    return {
      state: "needs_review",
      why: "the token appeared in an operation that was not an acceptance attempt, so no outcome can be tied to it",
    };
  }
  if (attempt.ok === true) {
    if (verdict === "PASS") {
      return { state: "validated", why: `the call it fed succeeded (${attempt.why}) and the run's acceptance passed` };
    }
    return {
      state: "needs_review",
      why: `the call it fed succeeded (${attempt.why}) but the run's acceptance read ${verdict}; an asset is not credited with an outcome the run did not reach`,
    };
  }
  if (attempt.ok === false) {
    const reachability = REACHABILITY.has(attempt.why);
    const token = dialledToken(attempt, tokens);
    if (reachability && token) {
      return {
        state: "corrected",
        corrected_reason: "wrong",
        why: `the call it fed dialled ${attempt.host}:${attempt.port} — the asset's own value (${token}) — and ${attempt.why}; the content explains the failure`,
      };
    }
    if (!reachability) {
      return {
        state: "needs_review",
        why: `the call it fed failed (${attempt.why}), a reason the asset's content does not explain — a service-side fault is not a wrong address`,
      };
    }
    return {
      state: "needs_review",
      why: `the call it fed ${attempt.why}, but the address dialled (${attempt.host}:${attempt.port}) is not the asset's value; the failure is not tied to its content`,
    };
  }
  return { state: "needs_review", why: `the outcome of the call it fed could not be read (${attempt.why})` };
}

/**
 * Judge every `used` event. `verdictDoc` is verify.mjs --json output;
 * `tokensByAsset` is extract-tokens --out (asset → {version, tokens}).
 */
export function judgeOutcome({ usedEvents, verdictDoc, tokensByAsset }) {
  const attempts = new Map((verdictDoc?.attempts ?? []).map((a) => [a.call_id, a]));
  const verdict = verdictDoc?.verdict ?? "ERROR";
  const out = [];
  const skipped = [];

  for (const used of usedEvents) {
    if (used.state !== "used") {
      skipped.push({ event_id: used.event_id, asset_id: used.asset_id, reason: `${used.state} does not produce an outcome` });
      continue;
    }
    const callId = callIdOf(used.target_ref);
    const attempt = callId ? attempts.get(callId) ?? null : null;

    // Tokens are versioned. Judging a v2 event with v3's tokens would tie an
    // outcome to text the model never saw.
    const entry = tokensByAsset?.[used.asset_id];
    let tokens = entry?.tokens ?? [];
    let versionNote = null;
    if (entry && used.asset_version != null && String(entry.version) !== String(used.asset_version)) {
      tokens = [];
      versionNote = `tokens on file are for v${entry.version}, the event credits v${used.asset_version}`;
    }

    let decision = outcomeOf({ used, attempt, tokens, verdict });
    // A failed call can only be blamed on content we can check; with the wrong
    // version's tokens on file there is nothing to check it against.
    if (versionNote && attempt && attempt.ok === false) {
      decision = { state: "needs_review", why: `${versionNote}; cannot tie the failure to this version's content` };
    }

    const ref = `${used.run_id ?? used.session_key}:verify.mjs:call=${callId ?? "none"}:ok=${attempt ? String(attempt.ok) : "n/a"}`;
    out.push({
      ...used,
      event_id: eventId([used.session_key, used.asset_id, decision.state, used.asset_version ?? "", callId ?? ""]),
      state: decision.state,
      evidence_tier: "hard",
      corrected_reason: decision.corrected_reason ?? null,
      proof_refs: [
        { kind: "verify_result", ref, detail: decision.why + (attempt ? ` (${attempt.why})` : "") },
        ...(used.proof_refs ?? []).filter((p) => p.kind === "tool_arg" || p.kind === "diff_hunk"),
      ],
      parent_event_ids: [used.event_id],
      metadata: {
        ...(used.metadata ?? {}),
        call_id: callId,
        attempt: attempt ? { host: attempt.host, port: attempt.port, ok: attempt.ok, why: attempt.why, message_index: attempt.message_index } : null,
        run_verdict: verdict,
      },
    });
  }
  return { events: out, skipped };
}

export function renderOutcome({ events, skipped }) {
  const lines = ["# Outcome judgement", ""];
  if (events.length === 0) lines.push("no used events to judge");
  for (const e of events) {
    const tag = e.state === "corrected" ? `corrected(${e.corrected_reason})` : e.state;
    lines.push(`  ${tag.padEnd(17)} ${(e.asset_name || e.asset_id).slice(0, 30).padEnd(32)} v${e.asset_version ?? "?"}  call=${e.metadata?.call_id ?? "-"}`);
    lines.push(`       ${e.proof_refs[0].detail}`);
  }
  if (skipped.length) {
    lines.push("", "skipped:");
    for (const s of skipped) lines.push(`  ${s.event_id}  ${s.asset_id}: ${s.reason}`);
  }
  return lines.join("\n");
}

// ── CLI ──────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith("--"));
  const outArg = args.find((a) => a.startsWith("--out="));
  const [usedPath, verdictPath, tokensPath] = positional;
  if (!usedPath || !verdictPath || !tokensPath) {
    console.error("usage: node judge-outcome.mjs <used-events.jsonl> <verdict.json> <tokens.json> [--out=FILE]");
    process.exit(2);
  }
  const usedEvents = parseJsonl(readFileSync(usedPath, "utf8"));
  const verdictDoc = JSON.parse(readFileSync(verdictPath, "utf8"));
  const tokensByAsset = JSON.parse(readFileSync(tokensPath, "utf8"));
  const result = judgeOutcome({ usedEvents, verdictDoc, tokensByAsset });
  const out = outArg ? outArg.slice("--out=".length) : DEFAULT_OUT;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, result.events.map((e) => JSON.stringify(e)).join("\n") + (result.events.length ? "\n" : ""));
  console.log(renderOutcome(result));
  console.log(`\n${result.events.length} outcome event(s) → ${out}`);
}
