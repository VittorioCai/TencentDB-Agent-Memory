import test from "node:test";
import assert from "node:assert/strict";
import { checkAssessment, quoteFound, resolveRecordId, verifyCitation, verifyFact, deriveCompetence, recordedOutcome } from "./check-citations.mjs";

const rec = (kind, text, meta = {}, evidence_class) => ({ kind, text, meta, evidence_class });
const pack = new Map([
  ["l1:m1", rec("l1", "The agent is probing both documented skill bridge endpoint addresses (10.244.7.19:8096 and 127.0.0.1:47318) with a reachability check", { provenance: "source_unavailable" }, "derived_memory")],
  ["l1:m2", rec("l1", "Team searched skills with curl before probing addresses", { provenance: "traceable", source_message_ids: ["msg1"] }, "derived_memory")],
  ["l0:msg1", rec("l0", "Both documented addresses probed. Results: 10.244.7.19:8096 timed out after 15 s; 127.0.0.1:47318 answered code 0", { role: "assistant" }, "assistant_report")],
  ["l0:msg2", rec("l0", "Deployment failed: the release script exited 1 on the migration step", { role: "assistant" }, "assistant_report")],
  ["persona:1:3", rec("persona", "Probe-all, trust-reachability: when ≥2 sources conflict on the same endpoint, probe each", { scope: "team+agent (L3)" }, "team_principles")],
  ["call:c1", rec("call", "2026-09-06 bridge_call search status=200 http://127.0.0.1:8096/skill-bridge/v3/skill/search", { kind: "bridge_call", upstream_status: 200 }, "proxy_observed")],
  ["call:c2", rec("call", "2026-09-06 bridge_call get-by-name status=404 http://127.0.0.1:8096/skill-bridge/v3/skill/get-by-name", { kind: "bridge_call", upstream_status: 404 }, "proxy_observed")],
  ["call:c3", rec("call", "2026-09-06 model_intent Bash curl http://10.244.7.19:8096/skill-bridge/v3/skill/search", { kind: "model_intent", upstream_status: 0 }, "proxy_observed")],
  ["outcome:o1", rec("outcome", "corrected(wrong) on asset skl-a v2 by usr-b (cross_user) at 2026-09-05; address 10.244.7.19:8096 timed out for the consumer", { state: "corrected", asset_id: "skl-a" }, "harness_verified")],
]);
const tokens = ["10.244.7.19:8096"];

test("a quote must be long enough and present after folding", () => {
  assert.equal(quoteFound("10.244.7.19:8096 TIMED OUT", pack.get("l0:msg1").text), true);
  assert.equal(quoteFound("timed", pack.get("l0:msg1").text), false);
  assert.equal(quoteFound("answered code 1", pack.get("l0:msg1").text), false);
});

test("a citation needs existing records and a quote found in one of them; a plain-text pack still works", () => {
  assert.equal(verifyCitation({ record_ids: ["l0:msg1"], quote: "127.0.0.1:47318 answered code 0" }, pack).ok, true);
  assert.match(verifyCitation({ record_ids: ["l0:nope"], quote: "answered code 0" }, pack).reason, /not in the pack/);
  assert.match(verifyCitation({ record_ids: [], quote: "answered code 0" }, pack).reason, /no record cited/);
  assert.match(verifyCitation({ record_ids: ["l1:m1"], quote: "answered code 0" }, pack).reason, /quote not found/);
  const plain = new Map([["l0:x", "plain text record here"]]);
  assert.equal(verifyCitation({ record_ids: ["l0:x"], quote: "text record here" }, plain).ok, true);
});

test("the reviewer's counter-example: 'deployed successfully' citing a report of failure yields no competence and no support", () => {
  const raw = {
    competence: "high",
    claims: [{ statement: "The author deployed successfully several times", type: "execution_result", outcome: "success", record_ids: ["l0:msg2"], quote: "Deployment failed: the release script exited 1", relation_to_asset: "supports" }],
    asset_claim_check: { verdict: "supports", record_ids: ["l0:msg2"], quote: "Deployment failed: the release script exited 1" },
  };
  const r = checkAssessment(raw, pack, { assetTokens: tokens });
  assert.equal(r.competence, "unknown");
  assert.equal(r.competence_as_said, "high");
  assert.equal(r.asset_claim_check.verdict, "silent");
  assert.equal(r.claims_kept.length, 0);
  assert.match(r.claims_dropped[0].reason, /needs a proxy-observed call or a harness-verified outcome; the quote is from assistant_report/);
});

test("an execution result must come from a call or an outcome, and agree with what it records", () => {
  assert.equal(verifyFact({ type: "execution_result", outcome: "success", quote: "status=200" }, pack, "call:c1").ok, true);
  assert.match(verifyFact({ type: "execution_result", outcome: "failure", quote: "status=200" }, pack, "call:c1").reason, /claimed failure but call:c1 records success/);
  assert.equal(verifyFact({ type: "execution_result", outcome: "failure", quote: "status=404" }, pack, "call:c2").ok, true);
  assert.match(verifyFact({ type: "execution_result", outcome: "success", quote: "model_intent" }, pack, "call:c3").reason, /records no result \(intent only\)/);
  assert.match(verifyFact({ type: "execution_result", outcome: "success", quote: "answered code 0" }, pack, "l0:msg1").reason, /assistant_report/);
  assert.match(verifyFact({ type: "execution_result", quote: "status=200" }, pack, "call:c1").reason, /must say success or failure/);
  assert.equal(recordedOutcome(pack.get("outcome:o1")), "failure");
});

test("an observed operation needs a message, a call, an outcome, or a traceable memory", () => {
  assert.equal(verifyFact({ type: "observed_operation", quote: "Both documented addresses probed" }, pack, "l0:msg1").ok, true);
  assert.equal(verifyFact({ type: "observed_operation", quote: "searched skills with curl" }, pack, "l1:m2").ok, true);
  assert.match(verifyFact({ type: "observed_operation", quote: "probing both documented" }, pack, "l1:m1").reason, /no traceable source/);
  assert.match(verifyFact({ type: "observed_operation", quote: "Probe-all, trust-reachability" }, pack, "persona:1:3").reason, /needs a message, a call or an outcome/);
  assert.equal(verifyFact({ type: "environment_applicability", quote: "Probe-all, trust-reachability" }, pack, "persona:1:3").ok, true);
});

test("supporting or contradicting the asset takes the asset's own token; inferences never do", () => {
  const ok = verifyFact({ type: "execution_result", outcome: "failure", quote: "10.244.7.19:8096 timed out for the consumer", relation_to_asset: "contradicts" }, pack, "outcome:o1", tokens);
  assert.deepEqual([ok.ok, ok.strength], [true, "strong"]);
  const weak = verifyFact({ type: "observed_operation", quote: "10.244.7.19:8096 timed out after 15 s", relation_to_asset: "contradicts" }, pack, "l0:msg1", tokens);
  assert.deepEqual([weak.ok, weak.strength], [true, "weak"]);
  assert.match(verifyFact({ type: "execution_result", outcome: "success", quote: "status=200", relation_to_asset: "supports" }, pack, "call:c1", tokens).reason, /names the asset's token/);
  assert.match(verifyFact({ type: "model_inference", quote: "Probe-all, trust-reachability", relation_to_asset: "contradicts" }, pack, "persona:1:3", tokens).reason, /cannot support or contradict/);
});

test("competence is derived from execution-grade claims only; failures beside successes are reported, not subtracted", () => {
  assert.equal(deriveCompetence([]).competence, "unknown");
  assert.equal(deriveCompetence([{ outcome: "failure" }]).competence, "low");
  assert.equal(deriveCompetence([{ outcome: "success" }, { outcome: "failure" }]).competence, "medium");
  assert.equal(deriveCompetence([{ outcome: "success" }, { outcome: "success" }, { outcome: "failure" }]).competence, "high");
  const raw = {
    competence: "low",
    claims: [
      { statement: "searched the bridge", type: "execution_result", outcome: "success", record_ids: ["call:c1"], quote: "search status=200" },
      { statement: "get-by-name refused", type: "execution_result", outcome: "failure", record_ids: ["call:c2"], quote: "get-by-name status=404" },
      { statement: "probed both", type: "observed_operation", record_ids: ["l0:msg1"], quote: "Both documented addresses probed" },
      { statement: "the team probes on conflict", type: "environment_applicability", record_ids: ["persona:1:3"], quote: "probe each" },
      { statement: "the records say nothing about Kubernetes", type: "coverage_unknown" },
    ],
    summary: "model prose",
  };
  const r = checkAssessment(raw, pack, { assetTokens: tokens });
  assert.equal(r.competence, "medium");
  assert.deepEqual(r.execution_claims, { success: 1, failure: 1 });
  assert.equal(r.competence_as_said, "low");
  assert.equal(r.counts.kept, 5);
  assert.equal(r.counts.citations, 4); // the coverage statement is not a citation
  assert.match(r.summary, /competence medium: 1 recorded success, 1 failure/);
  assert.equal(r.summary_as_said, "model prose");
});

test("the asset-claim verdict is rebuilt from accepted claims; the model's verdict is folded in as one claim and kept as said", () => {
  const raw = {
    competence: "medium",
    claims: [{ statement: "the consumer's use of the address failed", type: "execution_result", outcome: "failure", record_ids: ["outcome:o1"], quote: "10.244.7.19:8096 timed out for the consumer", relation_to_asset: "contradicts" }],
    asset_claim_check: { verdict: "supports", record_ids: ["persona:1:3"], quote: "Probe-all, trust-reachability" },
  };
  const r = checkAssessment(raw, pack, { assetTokens: tokens });
  assert.equal(r.asset_claim_check.verdict, "contradicts");
  assert.equal(r.asset_claim_check.strength, "strong");
  assert.equal(r.asset_claim_as_said, "supports");
  assert.equal(r.claims_dropped.length, 1); // the model's "supports" via persona: no asset token in it
  const silent = checkAssessment({ competence: "high", claims: [], asset_claim_check: { verdict: "silent" } }, pack, { assetTokens: tokens });
  assert.equal(silent.asset_claim_check.verdict, "silent");
  assert.equal(silent.competence, "unknown");
});

test("garbage in, unknown out", () => {
  const r = checkAssessment({ competence: "excellent", claims: "no" }, pack);
  assert.equal(r.competence, "unknown");
  assert.equal(r.counts.kept, 0);
  assert.equal(r.asset_claim_check.verdict, "silent");
});

test("labels are folded onto the vocabulary; evidence is not", () => {
  const raw = { competence: "Moderate", claims: [{ statement: "searched", type: "Execution-Result", outcome: "OK", record_ids: ["call:c1"], quote: "search status=200" }] };
  const r = checkAssessment(raw, pack);
  assert.equal(r.competence, "medium");
  assert.equal(r.competence_as_said, "medium");
  assert.equal(r.claims_kept[0].type, "execution_result");
  const bad = checkAssessment({ competence: "excellent", claims: [{ statement: "x", type: "hunch", record_ids: ["call:c1"], quote: "search status=200" }] }, pack);
  assert.match(bad.claims_dropped[0].reason, /not in the vocabulary/);
});

test("a cited id missing its kind prefix resolves when unambiguous; an unknown id does not", () => {
  assert.equal(resolveRecordId("msg1", pack), "l0:msg1");
  assert.equal(resolveRecordId("m1", pack), "l1:m1");
  assert.equal(resolveRecordId("nope", pack), null);
  const v = verifyCitation({ record_ids: ["msg1"], quote: "127.0.0.1:47318 answered code 0" }, pack);
  assert.equal(v.ok, true);
  assert.deepEqual(v.record_ids, ["l0:msg1"]);
});
