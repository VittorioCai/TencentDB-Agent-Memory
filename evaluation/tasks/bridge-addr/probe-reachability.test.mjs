import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { probe, probeAll, targetsOf } from "./probe-reachability.mjs";

function listen() {
  return new Promise((resolve) => {
    const server = createServer((s) => s.end());
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

test("a listening port is reachable; a closed port is 'could not connect'", async () => {
  const { server, port } = await listen();
  try {
    const ok = await probe("127.0.0.1", port, { timeoutMs: 2000 });
    assert.equal(ok.ok, true);
    assert.equal(ok.why, "tcp connect ok");
  } finally {
    server.close();
  }
  const closed = await probe("127.0.0.1", port, { timeoutMs: 2000 });
  assert.equal(closed.ok, false);
  assert.equal(closed.why, "could not connect");
});

test("a non-routable address times out within the budget", async () => {
  const r = await probe("10.255.255.1", 9, { timeoutMs: 800 });
  assert.equal(r.ok, false);
  assert.ok(["timed out", "could not connect"].includes(r.why) || r.why.startsWith("error "), r.why);
  assert.ok(r.elapsed_ms < 5000);
});

test("targetsOf dedupes host:port pairs from the verdict's attempts", () => {
  const v = { attempts: [{ host: "a", port: "1" }, { host: "a", port: "1" }, { host: "b", port: "2" }, { host: null, port: "3" }] };
  assert.deepEqual(targetsOf(v), ["a:1", "b:2"]);
});

test("probeAll records source and time per target", async () => {
  const { server, port } = await listen();
  try {
    const rec = await probeAll([`127.0.0.1:${port}`], { timeoutMs: 2000, source: "unit test" });
    const t = rec.targets[`127.0.0.1:${port}`];
    assert.equal(t.ok, true);
    assert.equal(t.source, "unit test");
    assert.match(t.checked_at, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    server.close();
  }
});
