/**
 * Discriminative token extraction.
 *
 * "The asset was used" is only checkable if the asset contains something whose
 * appearance in the work has no other explanation. That is what a discriminative
 * token is: a string the model could not have produced without reading this
 * asset.
 *
 * Two filters, and the order matters because the second is the one that holds.
 *
 *   1. Derivability — a prior on the token's shape. `127.0.0.1` is the address
 *      every developer types from memory; `10.244.7.19` is not. This is a
 *      heuristic and it is deliberately conservative: it can only reject.
 *
 *   2. Screening — is the token already present somewhere the model can see?
 *      Other assets in the candidate pool, the task description, files as they
 *      stood before the change, and — the one that is easy to forget — the
 *      injected system prompt. A token that arrives in context by any other
 *      route explains an artifact just as well as the asset does.
 *
 * Screening is the real guarantee; derivability is only a prior. A token that
 * survives both is what this tool calls discriminative, and only those may be
 * used to promote an event to `used`.
 *
 * The screening corpus must include the system prompt, not just the pool. On
 * this deployment the injected `<skill_tools>` block contains the literal string
 * `http://127.0.0.1:8096/skill-bridge/v3/skill/search`, so an asset documenting
 * that endpoint has nothing to distinguish it: every session already carries the
 * answer. Screening against the pool alone would have called that token unique.
 *
 * Usage:
 *   node evaluation/attribution/extract-tokens.mjs <asset.md> [asset2.md ...] \
 *     [--pool=<snapshot.json>] [--capture=<capture.jsonl>] \
 *     [--context=<file>] [--task=<task.md>] [--out=<tokens.json>] [--json]
 *
 *   # P4-1b's check: does the task description leak an answer?
 *   node evaluation/attribution/extract-tokens.mjs a.md b.md --contains=task.md
 *
 * Exit status is 1 when an asset has no discriminative token, or when a
 * --contains file carries one. Both are conditions under which the scenario
 * cannot support an attribution claim, so they fail rather than warn.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { isDerivableFromDeployment } from "../runner/token-provenance.mjs";

// ── token shapes ──────────────────────────────────────────────────

/**
 * Addresses a model writes from memory. Everything in 127/8 is loopback and is
 * the single most guessable address there is; the rest are protocol constants.
 * Private ranges are NOT here: 10.244.7.19 is as unguessable as a public one.
 */
function ipv4Derivable(ip) {
  if (/^127\./.test(ip)) return true;
  if (ip === "0.0.0.0" || ip === "255.255.255.255") return true;
  if (/^169\.254\./.test(ip)) return true;            // link-local
  if (/^(\d+\.)\1{2}\d+$/.test(ip)) return true;      // 1.1.1.1, 8.8.8.8 shapes
  return false;
}

const WELL_KNOWN_PORTS = new Set([
  "1433", "3000", "3306", "5000", "5432", "5672", "6379", "8000", "8080",
  "8443", "9000", "9090", "9200", "27017",
]);

/**
 * Everything below 1024 is an assigned system port, so all of them are as
 * guessable as 443. Above that only the conventional choices are.
 */
function portDerivable(port) {
  return WELL_KNOWN_PORTS.has(port) || Number(port) < 1024;
}

/** Hyphenated strings that are standard vocabulary rather than asset content. */
const STANDARD_IDENTIFIERS = new Set([
  "content-type", "content-length", "user-agent", "accept-encoding",
  "cache-control", "x-request-id", "application-json",
]);

/**
 * Segments that make a hyphenated string ordinary English rather than a name.
 *
 * `built-in` and `read-only` are prose; `eval-bridge-endpoint-a` is a name. The
 * rule is that a compound made entirely of common words is derivable — anyone
 * writing about the topic would produce it.
 *
 * This list is necessarily incomplete, which is why it is only a prior:
 * screening against the real corpora is what actually decides. The cost of a
 * gap here is a token that survives extraction and is then rejected for being
 * present somewhere else, or — the case worth watching — one that survives both
 * and makes a weak `used` claim. Kinds are ranked so an ipv4 or an arbitrary
 * port is preferred whenever one exists.
 */
const COMMON_WORDS = new Set([
  "built", "in", "out", "read", "write", "only", "up", "to", "date", "end",
  "one", "two", "self", "non", "pre", "post", "re", "sub", "multi", "cross",
  "well", "known", "open", "close", "source", "line", "time", "based", "side",
  "off", "on", "by", "of", "and", "or", "the", "a", "an", "for", "with",
  "new", "old", "first", "last", "next", "back", "front", "top", "down",
  "left", "right", "high", "low", "long", "short", "full", "half", "case",
  "sensitive", "insensitive", "specific", "wide", "level", "step", "run",
  "check", "test", "dry", "hard", "soft", "fine", "grained", "real", "world",
]);

function hyphenatedDerivable(id) {
  if (STANDARD_IDENTIFIERS.has(id)) return true;
  return id.split("-").every((seg) => COMMON_WORDS.has(seg));
}

const COMMON_PATHS = new Set(["/", "/api", "/health", "/healthz", "/status", "/metrics", "/v1", "/v2", "/v3"]);

/**
 * Pull candidate tokens out of text. Deliberately over-collects: everything
 * found here still has to survive screening, and a token missed at this stage
 * can never be recovered.
 */
export function extractTokens(text) {
  const src = String(text ?? "");
  const found = new Map(); // token -> {token, kind, derivable, count}

  const add = (token, kind, derivable) => {
    if (!token) return;
    const existing = found.get(token);
    if (existing) { existing.count += 1; return; }
    found.set(token, { token, kind, derivable, count: 1 });
  };

  // IPv4, with the port kept as its own token: a scenario can be distinguished
  // by either half, and `10.244.7.19:8096` shares its port with everything else
  // on this deployment.
  for (const m of src.matchAll(/\b(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{2,5}))?\b/g)) {
    const [, ip, port] = m;
    if (ip.split(".").some((o) => Number(o) > 255)) continue;
    add(ip, "ipv4", ipv4Derivable(ip));
    if (port) add(port, "port", portDerivable(port));
  }

  // Prefixed ids (skl-…, usr-…, wiki-…): never guessable.
  for (const m of src.matchAll(/\b([a-z]{2,6}-[A-Za-z0-9]{6,})\b/g)) {
    add(m[1], "prefixed_id", false);
  }

  // Hyphenated identifiers — skill names, header names, flags.
  for (const m of src.matchAll(/\b([a-z][a-z0-9]*(?:-[a-z0-9]+){1,})\b/g)) {
    const t = m[1];
    if (found.has(t)) continue;
    add(t, "hyphenated_id", hyphenatedDerivable(t));
  }

  // Absolute paths with at least two segments.
  for (const m of src.matchAll(/(?<![\w.])(\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+)/g)) {
    const t = m[1];
    add(t, "path", COMMON_PATHS.has(t));
  }

  // Bare ports written as `port 8096` or `:8096`. Two digits and up, so the
  // short well-known ones are seen and classified rather than silently missed.
  for (const m of src.matchAll(/(?:\bport\s+|:)(\d{2,5})\b/gi)) {
    add(m[1], "port", portDerivable(m[1]));
  }

  return [...found.values()];
}

// ── screening ─────────────────────────────────────────────────────

/**
 * Reject every token that the model could have obtained elsewhere.
 *
 * `corpora` maps a source name to its text. The name is carried into the
 * result so a rejection can be explained rather than merely counted — knowing
 * a token was rejected is useless without knowing which source killed it.
 */
export function screen(tokens, corpora) {
  const entries = Object.entries(corpora ?? {}).map(([name, text]) => [name, String(text ?? "")]);
  return tokens.map((t) => {
    const blockedBy = entries.filter(([, text]) => text.includes(t.token)).map(([name]) => name);
    // A value that can be read off the deployment is not discriminative however
    // clean the corpora are (2026-09-09). An address, a port, a hostname: it is
    // in the proxy config, something is listening on it, and a shell can find
    // it — so its appearance in the work does not establish that the asset was
    // read. This is the same predicate `token-provenance.mjs` applies, imported
    // rather than restated so the extractor and the checker cannot drift apart.
    const fromDeployment = isDerivableFromDeployment(t.token);
    return {
      ...t,
      blocked_by: blockedBy,
      derivable_from_deployment: fromDeployment,
      discriminative: blockedBy.length === 0 && !t.derivable && !fromDeployment,
    };
  });
}

/** Convenience: extract, screen, keep the survivors, strongest kind first. */
const KIND_RANK = { ipv4: 0, prefixed_id: 1, port: 2, path: 3, hyphenated_id: 4 };

export function discriminativeTokens(text, corpora) {
  return screen(extractTokens(text), corpora)
    .filter((t) => t.discriminative)
    .sort((a, b) => (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9) || a.token.localeCompare(b.token));
}

/** Which of these tokens appear in `text` — the leak check for a task description. */
export function findTokens(text, tokens) {
  const src = String(text ?? "");
  return tokens.filter((t) => src.includes(typeof t === "string" ? t : t.token));
}

// ── context sources ───────────────────────────────────────────────

/**
 * Every system prompt in a capture, concatenated.
 *
 * This is the corpus most easily left out and the one that matters most: the
 * injected tool blocks name real endpoints, so an asset that documents an
 * endpoint is describing something the model was already told.
 */
export function systemPromptsFromCapture(captureText) {
  const out = [];
  for (const line of String(captureText ?? "").split("\n")) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event?.event !== "http.request") continue;
    const msgs = event?.body?.json?.messages;
    if (!Array.isArray(msgs) || msgs[0]?.role !== "system") continue;
    const c = msgs[0].content;
    out.push(typeof c === "string" ? c : JSON.stringify(c));
  }
  return out.join("\n");
}

/** Asset bodies from a pool snapshot, excluding the assets under test. */
export function poolCorpus(snapshot, excludeIds = []) {
  const skip = new Set(excludeIds);
  return (snapshot?.assets ?? [])
    .filter((a) => !skip.has(a.asset_id))
    .map((a) => [a.name, a.description, a.content].filter(Boolean).join("\n"))
    .join("\n");
}

/**
 * An asset's own `name` and `description`.
 *
 * These are metadata, and metadata reaches the model without the body ever
 * being fetched: the name is what `<available_skills>` and a `skill/search`
 * response list. A model that writes the skill name has demonstrated recall,
 * not use — so the name must not be able to promote an event to `used`, and it
 * is screened out with the reason stated rather than quietly skipped.
 */
export function ownMetadata(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(String(text ?? ""));
  if (!m) return "";
  const fields = [];
  for (const line of m[1].split("\n")) {
    const kv = /^(name|description|title)\s*:\s*(.+)$/.exec(line.trim());
    if (kv) fields.push(kv[2].trim());
  }
  return fields.join("\n");
}

// ── CLI ───────────────────────────────────────────────────────────

function render(assetName, screened) {
  const keep = screened.filter((t) => t.discriminative);
  const lines = [`## ${assetName}`, ""];
  if (keep.length === 0) {
    lines.push("  **no discriminative token** — nothing in this asset could only have come from it.");
  } else {
    lines.push("  discriminative:");
    for (const t of keep) lines.push(`    ${t.token.padEnd(28)} ${t.kind}`);
  }
  const rejected = screened.filter((t) => !t.discriminative);
  if (rejected.length > 0) {
    lines.push("", "  rejected:");
    for (const t of rejected.sort((a, b) => a.token.localeCompare(b.token))) {
      const why = t.blocked_by.length > 0 ? `already in ${t.blocked_by.join(", ")}`
        : t.derivable_from_deployment ? "readable off the deployment (address / port / host / too short)"
        : "derivable by shape";
      lines.push(`    ${t.token.padEnd(28)} ${t.kind.padEnd(15)} ${why}`);
    }
  }
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const flag = (name) => args.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3));
  const assetPaths = args.filter((a) => !a.startsWith("--"));
  const asJson = args.includes("--json");

  if (assetPaths.length === 0) {
    console.error("usage: node extract-tokens.mjs <asset.md> [...] [--pool=snap.json] [--capture=cap.jsonl] [--context=file] [--task=file] [--contains=file] [--json]");
    process.exit(2);
  }

  const read = (p) => readFileSync(p, "utf8");
  const assets = assetPaths.map((p) => ({ path: p, text: read(p) }));

  const corpora = {};
  for (const p of flag("pool")) corpora[`pool(${p})`] = poolCorpus(JSON.parse(read(p)));
  for (const p of flag("capture")) corpora[`system prompt(${p})`] = systemPromptsFromCapture(read(p));
  for (const p of flag("context")) corpora[`context(${p})`] = read(p);
  for (const p of flag("task")) corpora[`task(${p})`] = read(p);

  const results = [];
  let failures = 0;
  for (const asset of assets) {
    // Every *other* asset under test is part of the candidate pool too:
    // constraint (c) is about the pool as it will be, not as it was.
    const withSiblings = { ...corpora, "own name/description (listed without fetching)": ownMetadata(asset.text) };
    for (const other of assets) {
      if (other.path !== asset.path) withSiblings[`sibling(${other.path})`] = other.text;
    }
    const screened = screen(extractTokens(asset.text), withSiblings);
    results.push({ asset: asset.path, tokens: screened });
    if (!screened.some((t) => t.discriminative)) failures += 1;
    if (!asJson) console.log(render(asset.path, screened), "\n");
  }

  const all = results.flatMap((r) => r.tokens.filter((t) => t.discriminative).map((t) => t.token));
  for (const p of flag("contains")) {
    const leaked = findTokens(read(p), all);
    if (!asJson) {
      console.log(leaked.length === 0
        ? `  ${p}: clean — carries none of the ${all.length} discriminative token(s)`
        : `  ${p}: LEAKS ${leaked.join(", ")}`);
    }
    if (leaked.length > 0) failures += 1;
  }

  // Keyed by asset id, so the judge can look tokens up by the id its events
  // carry. The id comes from matching the file's frontmatter name against the
  // frozen pool — the file path is a local fact and means nothing downstream.
  const byAssetId = {};
  const poolPaths = flag("pool");
  if (poolPaths.length > 0) {
    const pooled = poolPaths.flatMap((p) => JSON.parse(read(p)).assets ?? []);
    for (const r of results) {
      const name = /^name:\s*(.+)$/m.exec(ownMetadata(assets.find((a) => a.path === r.asset).text))?.[1]?.trim()
        ?? /^\s*name:\s*(.+)$/m.exec(read(r.asset))?.[1]?.trim();
      const match = pooled.find((a) => a.name === name);
      // The revision travels with the tokens. A token list with no revision
      // attached cannot be matched to the fetch that delivered it, and the
      // judge would fall back to crediting whichever read came last — which is
      // how a token that only exists in v1 gets attributed to a later v2.
      if (match) {
        byAssetId[match.asset_id] = {
          version: match.version ?? null,
          tokens: r.tokens.filter((t) => t.discriminative).map((t) => t.token),
        };
      }
      else if (!asJson) console.log(`  [warn] ${r.asset}: name ${name ?? "?"} is not in the pool — its tokens cannot be keyed to an asset id`);
    }
  }

  for (const p of flag("out")) {
    writeFileSync(p, JSON.stringify(byAssetId, null, 2), "utf8");
    if (!asJson) console.log(`  tokens by asset id written to ${p}`);
  }

  if (asJson) console.log(JSON.stringify({ results, discriminative: all, by_asset_id: byAssetId, failures }, null, 2));
  else if (failures > 0) console.log(`\n${failures} problem(s): an asset with no discriminative token cannot support a "used" claim.`);

  process.exit(failures > 0 ? 1 : 0);
}
