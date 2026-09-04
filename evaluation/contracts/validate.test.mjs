import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadSchema, validate, validateFile } from "./validate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const schema = (name) => loadSchema(join(HERE, name));
const fixture = (name) => join(HERE, "fixtures", name);
const readText = (path) => readFileSync(path, "utf8");
const readJson = (path) => JSON.parse(readText(path));

test("every fixture passes its own contract", () => {
  for (const [s, f] of [
    ["provenance-event.schema.json", "provenance-events.jsonl"],
    ["gate-decision.schema.json", "gate-decision.json"],
    ["receipt.schema.json", "receipt.json"],
  ]) {
    const r = validateFile(schema(s), fixture(f));
    assert.equal(r.failed, 0, `${f}:\n  ${r.errors.join("\n  ")}`);
    assert.ok(r.total > 0, `${f} is empty`);
  }
});

test("the provenance fixture covers every path downstream tracks need", () => {
  // Without a cross_user row the gate's admit path is untestable; without a
  // corrected row its reject path is. Both must be present in the fixture.
  const text = readText(fixture("provenance-events.jsonl"));
  assert.match(text, /"relation":"cross_user"/);
  assert.match(text, /"state":"corrected"/);
  assert.match(text, /"state":"used_soft"/);
  assert.match(text, /"state":"needs_review"/);
  assert.match(text, /"excluded_by_snapshot":true/);
});

test("unknown fields are rejected, so contracts stay closed", () => {
  const s = schema("gate-decision.schema.json");
  const good = readJson(fixture("gate-decision.json"))[0];
  assert.deepEqual(validate(s, good), []);
  assert.match(validate(s, { ...good, score: 0.9 }).join("\n"), /field "score" is not allowed/);
});

test("author confidence is null when not computable, never 0", () => {
  // 0 reads as "we measured it and the author is unreliable"; the truth is
  // "there is no data yet". Those must not collapse into the same value.
  const s = schema("gate-decision.schema.json");
  const pending = readJson(fixture("gate-decision.json"))[1];
  assert.equal(pending.signals.author.confidence, null);
  assert.equal(pending.signals.author.computable, false);
  assert.deepEqual(validate(s, pending), []);
});

test("observation and evidence_tier are separate concepts", () => {
  // observation: how the fetch was witnessed. evidence_tier: how strong the
  // "it was used" judgement is. Values from one must not validate in the other.
  const s = schema("provenance-event.schema.json");
  const first = JSON.parse(readText(fixture("provenance-events.jsonl")).split("\n")[0]);
  assert.equal(first.observation, "bridge+wire");
  assert.equal(first.evidence_tier, null);
  assert.match(validate(s, { ...first, evidence_tier: "bridge+wire" }).join("\n"), /\.evidence_tier/);
});

test("an unsupported keyword throws instead of silently passing", () => {
  // Silently ignoring it would make the contract look enforced while it is not.
  assert.throws(() => validate({ type: "object", oneOf: [] }, {}), /unsupported schema keyword "oneOf"/);
});

test("type arrays admit null, and null inside enum still matches", () => {
  const s = { type: ["string", "null"], enum: ["a", null] };
  assert.deepEqual(validate(s, null), []);
  assert.deepEqual(validate(s, "a"), []);
  assert.match(validate(s, "b").join(), /must be one of/);
  assert.match(validate(s, 1).join(), /type must be/);
});

test("errors carry a path that points at the nested field", () => {
  const s = schema("receipt.schema.json");
  const r = readJson(fixture("receipt.json"));
  r.items[1].status = "verified";
  const errs = validate(s, r);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /^\$\.items\[1\]\.status/);
});
