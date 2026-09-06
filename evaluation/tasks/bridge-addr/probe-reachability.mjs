/**
 * Independent reachability probe — the "independent validator" the outcome
 * judge needs before it may call an asset wrong.
 *
 * A model's call timing out at an address proves the model followed the
 * asset that gave it the address. It does not prove the address is wrong: the
 * right address can time out once. So the harness itself opens a TCP
 * connection to every host:port the run attempted and records the result.
 * The judge treats a failed call as `corrected(wrong)` only when this probe
 * also failed to reach the address; when the probe reaches it, the model's
 * failure was environmental and the outcome is `needs_review`.
 *
 * The record says when it was taken and by whom (`source`). A probe taken at
 * run time can speak to the state at run time; one taken afterwards can only
 * say the address is persistently unreachable or reachable now, and the judge
 * carries that wording through.
 *
 * Usage:
 *   node probe-reachability.mjs --verdict=verdict.json --out=reachability.json [--source="harness probe at run time"] [--timeout-ms=5000]
 *   node probe-reachability.mjs --targets=10.244.7.19:8096,127.0.0.1:47318 --out=reachability.json
 */

import { readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";

/** TCP-connect once; resolves {ok, why, elapsed_ms}. Never rejects. */
export function probe(host, port, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    let done = false;
    const finish = (ok, why) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch { /* already closed */ }
      resolve({ ok, why, elapsed_ms: Date.now() - started });
    };
    const socket = connect({ host, port: Number(port) });
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true, "tcp connect ok"));
    socket.once("timeout", () => finish(false, "timed out"));
    socket.once("error", (err) => finish(false, err?.code === "ECONNREFUSED" ? "could not connect" : `error ${err?.code ?? err?.message ?? "unknown"}`));
  });
}

/** Distinct host:port targets from a verdict's attempts. */
export function targetsOf(verdictDoc) {
  const seen = new Set();
  for (const a of verdictDoc?.attempts ?? []) {
    if (a?.host && a?.port) seen.add(`${a.host}:${a.port}`);
  }
  return [...seen];
}

export async function probeAll(targets, { timeoutMs = 5000, source = "harness probe" } = {}) {
  const checkedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const out = {};
  for (const t of targets) {
    const i = t.lastIndexOf(":");
    const host = t.slice(0, i), port = t.slice(i + 1);
    const r = await probe(host, port, { timeoutMs });
    out[t] = { ...r, checked_at: checkedAt, source, timeout_ms: timeoutMs };
  }
  return { checked_at: checkedAt, source, timeout_ms: timeoutMs, targets: out };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const arg = (n) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
  const out = arg("out");
  if (!out || (!arg("verdict") && !arg("targets"))) {
    console.error("usage: node probe-reachability.mjs (--verdict=F | --targets=h:p,...) --out=F [--source=S] [--timeout-ms=N]");
    process.exit(2);
  }
  const targets = arg("targets") ? arg("targets").split(",").filter(Boolean) : targetsOf(JSON.parse(readFileSync(arg("verdict"), "utf8")));
  const record = await probeAll(targets, { timeoutMs: Number(arg("timeout-ms") ?? 5000), source: arg("source") ?? "harness probe" });
  writeFileSync(out, JSON.stringify(record, null, 2) + "\n");
  for (const [t, r] of Object.entries(record.targets)) console.log(`${t}: ${r.ok ? "reachable" : "unreachable"} (${r.why}, ${r.elapsed_ms} ms)`);
  if (targets.length === 0) console.log("no targets to probe");
}
