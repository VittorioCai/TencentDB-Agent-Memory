import test from "node:test";
import assert from "node:assert/strict";
import { checkAssessment, quoteFound, resolveRecordId, verifyCitation } from "./check-citations.mjs";

const pack = new Map([
  ["l1:m1", "The agent is probing both documented skill bridge endpoint addresses (10.244.7.19:8096 and 127.0.0.1:47318) with a reachability check"],
  ["l0:msg1", "Both documented addresses probed. Results: 10.244.7.19:8096 timed out after 15 s; 127.0.0.1:47318 answered code 0"],
  ["persona:1:3", "Probe-all, trust-reachability: when ≥2 sources conflict on the same endpoint, probe each"],
]);

test("a quote must be long enough and present after folding", () => {
  assert.equal(quoteFound("10.244.7.19:8096 TIMED OUT", pack.get("l0:msg1")), true);
  assert.equal(quoteFound("timed", pack.get("l0:msg1")), false);
  assert.equal(quoteFound("answered code 1", pack.get("l0:msg1")), false);
});

test("a citation needs existing records and a quote found in one of them", () => {
  assert.equal(verifyCitation({ record_ids: ["l0:msg1"], quote: "127.0.0.1:47318 answered code 0" }, pack).ok, true);
  assert.match(verifyCitation({ record_ids: ["l0:nope"], quote: "answered code 0" }, pack).reason, /not in the pack/);
  assert.match(verifyCitation({ record_ids: [], quote: "answered code 0" }, pack).reason, /no record cited/);
  assert.match(verifyCitation({ record_ids: ["l1:m1"], quote: "answered code 0" }, pack).reason, /quote not found/);
});

test("competence rests on surviving claims; unsupported claims are dropped and named", () => {
  const raw = {
    competence: "high",
    claims: [
      { statement: "The author has reached the bridge from an agent session", record_ids: ["l0:msg1"], quote: "127.0.0.1:47318 answered code 0" },
      { statement: "The author runs Kubernetes clusters", record_ids: ["persona:1:3"], quote: "manages the production cluster" },
    ],
    counter_evidence: [{ statement: "The author's own probe saw 10.244 fail", record_ids: ["l0:msg1"], quote: "10.244.7.19:8096 timed out" }],
    asset_claim_check: { verdict: "contradicts", record_ids: ["l0:msg1"], quote: "10.244.7.19:8096 timed out after 15 s" },
    summary: "s",
  };
  const r = checkAssessment(raw, pack);
  assert.equal(r.competence, "high");
  assert.equal(r.counts.kept, 2);
  assert.equal(r.claims_dropped.length, 1);
  assert.match(r.claims_dropped[0].reason, /quote not found/);
  assert.equal(r.asset_claim_check.verdict, "contradicts");
  assert.equal(r.counts.citations, 1);
});

test("no surviving claim → unknown, whatever the model said; a bad asset-claim citation → silent", () => {
  const raw = {
    competence: "high",
    claims: [{ statement: "x", record_ids: ["l1:m1"], quote: "not in there at all, really" }],
    asset_claim_check: { verdict: "supports", record_ids: ["l1:m1"], quote: "also not in there" },
  };
  const r = checkAssessment(raw, pack);
  assert.equal(r.competence, "unknown");
  assert.equal(r.competence_downgraded, true);
  assert.equal(r.asset_claim_check.verdict, "silent");
  assert.match(r.asset_claim_check.reason, /downgraded/);
});

test("garbage in, unknown out", () => {
  const r = checkAssessment({ competence: "excellent", claims: "no" }, pack);
  assert.equal(r.competence, "unknown");
  assert.equal(r.counts.kept, 0);
  assert.equal(r.asset_claim_check.verdict, "silent");
});

test("labels are folded onto the vocabulary; evidence is not", () => {
  const raw = {
    competence: "Moderate",
    claims: [{ statement: "probed both", record_ids: ["l1:m1"], quote: "probing both documented skill bridge endpoint addresses" }],
    asset_claim_check: { verdict: "contradict", record_ids: ["l0:msg1"], quote: "10.244.7.19:8096 timed out" },
  };
  const r = checkAssessment(raw, pack);
  assert.equal(r.competence, "medium");
  assert.equal(r.asset_claim_check.verdict, "contradicts");
  const bad = checkAssessment({ competence: "excellent", claims: raw.claims, asset_claim_check: { verdict: "maybe", record_ids: ["l0:msg1"], quote: "10.244.7.19:8096 timed out" } }, pack);
  assert.equal(bad.competence, "unknown");
  assert.match(bad.asset_claim_check.reason, /not in the vocabulary/);
});

test("a cited id missing its kind prefix resolves when unambiguous; an unknown id does not", () => {
  assert.equal(resolveRecordId("msg1", pack), "l0:msg1");
  assert.equal(resolveRecordId("m1", pack), "l1:m1");
  assert.equal(resolveRecordId("nope", pack), null);
  const v = verifyCitation({ record_ids: ["msg1"], quote: "127.0.0.1:47318 answered code 0" }, pack);
  assert.equal(v.ok, true);
  assert.deepEqual(v.record_ids, ["l0:msg1"]);
});
