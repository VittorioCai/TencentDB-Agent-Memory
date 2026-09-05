/**
 * Hard-evidence judge: did this asset actually influence the work?
 *
 * The claim it makes is narrow on purpose:
 *
 *   this asset, at this version, had its content pulled into the session at
 *   time T, and a token that could only have come from it appears in an
 *   operation the model performed after T.
 *
 * Every clause is load-bearing.
 *
 * **This version.** A fetch of v2 says nothing about v3. The pool rolls
 * forward, and matching on asset id alone attributes a run to whichever
 * revision happens to be current.
 *
 * **Content pulled in.** Not "the asset was offered", not "its name appeared in
 * a listing". The `<available_skills>` block and a `skill/search` response
 * carry names and descriptions — the *body* only arrives through a call that
 * asked for it. So the judge does not trust the state name: it requires a
 * `fetched` event whose `executed_endpoint` is set and is not an enumeration.
 * A state label is a conclusion someone else drew; the endpoint is a fact about
 * what was called.
 *
 * **After T, strictly.** Same session is not enough. A token appearing before
 * the content arrived came from somewhere else by definition.
 *
 * **An operation the model performed.** Matching is done against what the model
 * *wrote* — tool call arguments, diff hunks, test commands — and never against
 * what came back. A token in a result proves the service returned it; only a
 * token in an argument shows the model acting on it. This is also what closes
 * the command-echo false positive structurally rather than by pattern: the echo
 * lives in the result, and the result is not searched.
 *
 * Outcomes:
 *   used           token matched, and a qualifying fetch preceded it
 *   needs_review   token matched, but nothing establishes the content arrived
 *                  first — the model may have known it from elsewhere
 *   (nothing)      a fetch with no token hit stays `fetched`; retrieval is not
 *                  use, and inventing a further state would say it was
 *
 * Usage:
 *   node evaluation/attribution/judge-hard.mjs \
 *     <events.jsonl ...> <run-artifacts.json> <tokens.json>
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { eventId, parseJsonl, isListingAction } from "../provenance/build-events.mjs";

/**
 * Commands that look for a string rather than use one.
 *
 * The third gate0 false positive in one line: the model grepped this repository
 * and the result carried the checker's own pattern, so the detector passed
 * because the model had searched for the detector. Writing a token into a
 * search command is looking for it, which is the opposite of the claim.
 */
const SEARCH_COMMAND = /\b(grep|rg|ag|ack|fgrep|egrep|find|locate)\b/;

/** Where a token found here would sit, in the contract's vocabulary. */
const TARGET_TYPE = {
  tool_call: "tool_call",
  test_command: "test_action",
  diff_hunk: "code_change",
};

const PROOF_KIND = {
  tool_call: "tool_arg",
  test_command: "test_command",
  diff_hunk: "diff_hunk",
};

/**
 * Does this `fetched` event establish that the asset's content arrived?
 *
 * Checked structurally rather than by state name. `fetched` is written by an
 * upstream stage, and a stage that trusts a label inherits every mistake made
 * upstream of it — which is exactly how an asset that merely appeared in a
 * search listing would be promoted two steps later.
 */
export function isContentBearingFetch(event) {
  if (event?.state !== "fetched") return false;
  const endpoint = String(event.executed_endpoint ?? "");
  if (!endpoint) return false;                 // nothing says what was called
  if (isListingAction(endpoint)) return false; // an enumeration offers, it does not deliver

  // A non-enumeration endpoint is not enough. `get` with include_content:false
  // returns id, name and version; `update` returns a metadata summary. Both
  // name the asset, both come from an allowed endpoint, and neither hands back
  // a line of the body — so the response itself has to be the thing that says
  // content arrived. Null means the response was never captured: unknown, and
  // unknown is not a licence to promote.
  if (event.content_delivered !== true) return false;

  // And it has to be known *where* it arrived, or nothing can be shown to
  // follow it.
  if (event.context_entry_index == null) return false;

  return Array.isArray(event.proof_refs) && event.proof_refs.length > 0;
}

/**
 * The tokens for one asset, and the revision they were taken from.
 *
 * Accepts the flat `[token, …]` shape as well, but marks it version-less: a
 * token list with no revision attached cannot be matched to the fetch that
 * delivered it, and crediting it to whichever fetch came last is how a token
 * that only exists in v1 gets attributed to v2.
 */
export function tokenSet(entry) {
  if (Array.isArray(entry)) return { version: null, tokens: entry };
  return { version: entry?.version ?? null, tokens: entry?.tokens ?? [] };
}

/**
 * Did the content arrive before the model wrote this operation?
 *
 * Judged on position in the message sequence, not on time. A model can emit
 * several tool calls in one message: they share a timestamp, and the second was
 * written before the first one's result existed. Comparing timestamps reads
 * that as influence. Comparing positions — the index of the message carrying
 * the *response* against the index of the message carrying the *call* — does
 * not, because both calls sit at the same index and neither is after the other.
 *
 * A diff hunk has no position. "After everything in the run" cannot establish
 * that the asset was read first, because a run that edited the file and then
 * read the asset leaves exactly the same diff.
 */
export function precedes(fetch, operation) {
  const arrived = fetch?.context_entry_index;
  const wrote = operation?.message_index;
  if (arrived == null || wrote == null) return false;
  return arrived < wrote;
}

/**
 * Judge one session.
 *
 * `tokensByAsset` maps asset_id to the discriminative tokens extract-tokens.mjs
 * kept. Those were already screened against the pool, the system prompt and the
 * asset's own name; here they are screened again against *this run's* task
 * description and pre-change files, because those are properties of the run
 * rather than of the asset.
 */
export function judgeSession({ events, artifacts, tokensByAsset }) {
  const out = [];
  const skipped = [];
  const session = artifacts?.session_key ?? "";
  const task = String(artifacts?.task_description ?? "");
  const preChange = Object.entries(artifacts?.pre_change_files ?? {});
  const fetches = events.filter(isContentBearingFetch);
  // Everything that reached the model through a tool result, in arrival
  // order — bodies of fetched assets, file reads, search snippets. Falls back
  // to the listing-only view for artifacts collected before it existed.
  const delivered = artifacts?.delivered_content ?? artifacts?.offered_content ?? [];

  for (const [assetId, entry] of Object.entries(tokensByAsset ?? {})) {
    const { version: tokenVersion, tokens } = tokenSet(entry);
    for (const token of tokens) {
      // (a) the task description must not name it — otherwise the model was told
      if (task.includes(token)) { skipped.push({ asset_id: assetId, token, reason: "in the task description" }); continue; }
      // (b) nor may it already be in the files as they stood
      const inPre = preChange.find(([, content]) => String(content).includes(token));
      if (inPre) { skipped.push({ asset_id: assetId, token, reason: `already in ${inPre[0]} before the change` }); continue; }

      for (const op of artifacts?.operations ?? []) {
        if (!String(op.text ?? "").includes(token)) continue;

        const searching = op.kind !== "diff_hunk" && SEARCH_COMMAND.test(String(op.text ?? ""));

        // Where did this token FIRST reach the model, before the operation?
        //
        // The credit can only go to the fetch that delivered the token first.
        // If anything earlier carried it — a search snippet, another asset's
        // body, a file read, the model's own auto-extracted skill — then the
        // later use cannot be told apart from having read that earlier thing,
        // and the credited fetch is at best a second source. The real runs
        // supplied both shapes: `47318` came back in a search snippet in one
        // session; in the next, the consumer read its own auto-extracted skill
        // at message 4, well before any credited asset. That skill happened
        // not to carry the tokens. Nothing guarantees the next one will not.
        const earliest = delivered
          .filter((d) => (op.message_index == null || d.message_index < op.message_index)
            && String(d.text ?? "").includes(token))
          .sort((a, b) => a.message_index - b.message_index)[0] ?? null;

        // Only a fetch of the revision these tokens came from may be credited.
        // A token that exists only in v1 must not be attributed to a later read
        // of v2 merely because that read is the most recent one.
        const sameRevision = (f) => tokenVersion != null
          && String(f.asset_version ?? "") === String(tokenVersion);

        const preceding = fetches.filter((f) => f.asset_id === assetId && precedes(f, op));
        // The latest qualifying arrival, by position rather than by clock.
        const fetch = preceding
          .filter(sameRevision)
          .sort((a, b) => b.context_entry_index - a.context_entry_index)[0];

        // The credited fetch must BE the earliest delivery. Equal index means
        // the same tool result; anything earlier is a different source.
        const earlierSource = earliest && (!fetch || earliest.message_index < fetch.context_entry_index)
          ? earliest
          : null;

        const blocked = searching
          ? "the token appears in a search command — the model was looking for it, not using it"
          : earlierSource
            ? ((earlierSource.kind === "listing" || (earlierSource.endpoint && isListingAction(earlierSource.endpoint)))
                ? `the token was in a search snippet (message ${earlierSource.message_index}) before this operation, so its use cannot be told apart from reading that snippet`
                : `the token first reached the model at message ${earlierSource.message_index} via ${earlierSource.source || earlierSource.endpoint || "another tool result"}, before the credited fetch — its use cannot be attributed to that fetch`)
          : op.message_index == null
            ? "a diff has no position in the run, so it cannot show the asset was read before the change was made"
            : !fetch && tokenVersion == null
              ? "these tokens carry no version, so no particular fetch can be credited with delivering them"
              : !fetch && preceding.length > 0
                ? `content of v${tokenVersion} did not arrive before this operation; what did arrive was v${preceding.map((f) => f.asset_version ?? "?").join(", v")}`
                : !fetch
                  ? "no delivery of this asset's content precedes the operation, so the token may have come from elsewhere"
                  : "";

        const state = blocked ? "needs_review" : "used";
        const reason = blocked
          || `content of v${fetch.asset_version} entered the context at message ${fetch.context_entry_index}, before this operation at message ${op.message_index}`;

        const proofRefs = [{
          kind: PROOF_KIND[op.kind] ?? "tool_arg",
          ref: op.locus,
          detail: `token ${token}; ${reason}`,
        }];
        if (state === "used") proofRefs.push(...(fetch.proof_refs ?? []).slice(0, 1));

        const base = fetch ?? events.find((e) => e.asset_id === assetId) ?? {};
        out.push({
          schema_version: "provenance-v1",
          event_id: eventId([session, assetId, state, op.locus, token]),
          state,
          session_key: session,
          run_id: artifacts?.run_id ?? null,
          task_id: artifacts?.task_id ?? null,
          occurred_at: op.occurred_at ?? null,
          asset_id: assetId,
          asset_type: base.asset_type ?? "",
          asset_name: base.asset_name ?? "",
          // Only the version whose content is being credited. Absent a fetch
          // there is no version to claim, and the asset's current one is not it.
          asset_version: state === "used" ? (fetch.asset_version ?? null) : null,
          asset_created_at: base.asset_created_at ?? "",
          pool_snapshot_at: base.pool_snapshot_at ?? "",
          excluded_by_snapshot: Boolean(base.excluded_by_snapshot),
          producer_user_id: base.producer_user_id ?? "",
          producer_agent_id: base.producer_agent_id ?? "",
          actor_user_id: base.actor_user_id ?? "",
          actor_agent_id: base.actor_agent_id ?? "",
          relation: base.relation ?? "unknown",
          observation: state === "used" ? (fetch.observation ?? "wire_only") : "none",
          evidence_tier: state === "used" ? "hard" : null,
          bridge_source: state === "used" ? (fetch.bridge_source ?? "") : "",
          executed_endpoint: state === "used" ? (fetch.executed_endpoint ?? "") : "",
          upstream_status: state === "used" ? (fetch.upstream_status ?? 0) : 0,
          target_type: TARGET_TYPE[op.kind] ?? "tool_call",
          target_ref: op.locus,
          proof_refs: proofRefs,
          corrected_reason: null,
          parent_event_ids: state === "used" ? [fetch.event_id] : [],
        });
      }
    }
  }
  return { events: out, skipped };
}

export function judge({ events, sessions, tokensByAsset }) {
  const all = [];
  const skipped = [];
  for (const artifacts of sessions) {
    const scoped = events.filter((e) => !e.session_key || e.session_key === artifacts.session_key);
    const r = judgeSession({ events: scoped, artifacts, tokensByAsset });
    all.push(...r.events);
    skipped.push(...r.skipped);
  }
  return { events: all, skipped };
}

export function renderJudgement({ events, skipped }, { events: inputEvents = [] } = {}) {
  const used = events.filter((e) => e.state === "used");
  const review = events.filter((e) => e.state === "needs_review");
  const fetched = inputEvents.filter(isContentBearingFetch);
  const usedAssets = new Set(used.map((e) => e.asset_id));

  const lines = ["# Hard-evidence judgement", ""];
  lines.push(`  ${used.length} used, ${review.length} needs_review, from ${fetched.length} content-bearing fetch(es)`, "");

  for (const e of [...used, ...review]) {
    lines.push(`  ${e.state.padEnd(13)} ${(e.asset_name || e.asset_id).slice(0, 30).padEnd(32)} v${e.asset_version ?? "?"}  ${e.target_type}`);
    lines.push(`       ${e.proof_refs[0].detail}`);
    lines.push(`       ${e.target_ref}`);
  }

  // One line per revision, not per event: the same asset fetched in two
  // sessions is one asset that went unused, not two.
  const silent = new Map();
  for (const f of fetched) {
    if (usedAssets.has(f.asset_id)) continue;
    silent.set(`${f.asset_id}|${f.asset_version ?? ""}`, f);
  }
  if (silent.size > 0) {
    lines.push("", `${silent.size} asset revision(s) were fetched and left no trace in the work:`);
    for (const f of silent.values()) lines.push(`  - ${f.asset_name || f.asset_id} v${f.asset_version ?? "?"}`);
    lines.push("They stay at `fetched`. Retrieval is not use, and an asset that was read and");
    lines.push("ignored is a real outcome — arguably the one a team asset system most needs to");
    lines.push("see — so it is reported rather than promoted.");
  }
  if (skipped.length > 0) {
    lines.push("", `${skipped.length} token(s) could not be used as evidence in this run:`);
    for (const s of skipped) lines.push(`  - ${s.token} (${s.asset_id}): ${s.reason}`);
  }
  return lines.join("\n");
}

// ── CLI ───────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const flag = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const positional = args.filter((a) => !a.startsWith("--"));
  const eventPaths = positional.filter((a) => a.endsWith(".jsonl"));
  const jsonPaths = positional.filter((a) => a.endsWith(".json"));
  const artifactsPath = flag("artifacts") ?? jsonPaths[0];
  const tokensPath = flag("tokens") ?? jsonPaths[1];

  if (!artifactsPath || !tokensPath || eventPaths.length === 0) {
    console.error("usage: node judge-hard.mjs <events.jsonl ...> <run-artifacts.json> <tokens.json>");
    console.error("       --artifacts= and --tokens= override the positional order");
    process.exit(2);
  }

  const events = eventPaths.flatMap((p) => parseJsonl(readFileSync(p, "utf8")));
  const sessions = JSON.parse(readFileSync(artifactsPath, "utf8"));
  // Written by extract-tokens.mjs --out: { assetId: { version, tokens[] } }.
  // The flat { assetId: [tokens] } shape is accepted and treated as version-less.
  const tokensByAsset = JSON.parse(readFileSync(tokensPath, "utf8"));

  const result = judge({ events, sessions, tokensByAsset });
  const outPath = "evaluation/attribution/artifacts/used-events.jsonl";
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, result.events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  console.log(renderJudgement(result, { events }));
  console.log(`\nWritten to ${outPath}`);
}
