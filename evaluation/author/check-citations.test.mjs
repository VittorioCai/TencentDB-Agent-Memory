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
  ["outcome:o1", rec("outcome", "corrected(wrong) on asset skl-a v2 by usr-b (cross_user) at 2026-09-05; address 10.244.7.19:8096 timed out for the consumer", { state: "corrected", corrected_reason: "wrong", asset_id: "skl-a", asset_version: 2, consumer_user_id: "usr-b" }, "harness_verified")],
  ["outcome:o0", rec("outcome", "validated on asset skl-a v1 by usr-b (cross_user) at 2026-09-01", { state: "validated", asset_id: "skl-a", asset_version: 1, consumer_user_id: "usr-b" }, "harness_verified")],
  ["outcome:own", rec("outcome", "validated on asset skl-a v2 by usr-a (self) at 2026-09-04", { state: "validated", asset_id: "skl-a", asset_version: 2, consumer_user_id: "usr-a" }, "harness_verified")],
  ["call:i1", rec("call", "2026-09-06 model_intent Bash curl -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/search -d {\"query\":\"deploy\"} status=0", { kind: "model_intent", upstream_status: 0, session_key: "s1", paired_call: "call:r1", pairing: "paired" }, "proxy_observed")],
  ["call:r1", rec("call", "2026-09-06 bridge_call search status=200 {\"query\":\"deploy\"}", { kind: "bridge_call", upstream_status: 200, session_key: "s1", paired_intent: "call:i1", pairing: "paired" }, "proxy_observed")],
  ["call:i2", rec("call", "2026-09-06 model_intent Bash curl -X POST http://10.244.7.19:8096/skill-bridge/v3/skill/search status=0", { kind: "model_intent", upstream_status: 0, session_key: "s1", pairing: "no_result" }, "proxy_observed")],
  ["call:h", rec("call", "2026-09-06 bridge_call health status=200 {}", { kind: "bridge_call", upstream_status: 200, session_key: "s2", pairing: "unpaired" }, "proxy_observed")],
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
  assert.equal(r.execution_claims.calls, 0);
  // The sentence survives only as what the report can carry: an operation the assistant described.
  assert.equal(r.claims_kept.length, 1);
  assert.equal(r.claims_kept[0].type, "observed_operation");
  assert.equal(r.claims_kept[0].relation, "silent");
  assert.match(r.claims_kept[0].note, /needs a proxy-observed call or a harness-verified outcome; the quote is from assistant_report/);
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

test("tokens match exactly: a failure at 10.244.7.19:9999 says nothing about 10.244.7.19:8096, and a host alone names no port", () => {
  const p2 = new Map([...pack,
    ["outcome:o9", rec("outcome", "corrected(wrong) on asset skl-x v1 (tokens of v1: 10.244.7.19:9999) by usr-b", { state: "corrected", corrected_reason: "wrong", asset_id: "skl-x", asset_version: 1 }, "harness_verified")],
    ["outcome:o8", rec("outcome", "corrected(wrong) on asset skl-x v1 (tokens of v1: 10.244.7.19:8096) by usr-b", { state: "corrected", corrected_reason: "wrong", asset_id: "skl-x", asset_version: 1 }, "harness_verified")],
    ["outcome:o7", rec("outcome", "corrected(wrong) on asset skl-x v1 (asset tokens: 10.244.7.19) by usr-b", { state: "corrected", corrected_reason: "wrong", asset_id: "skl-x", asset_version: 1 }, "harness_verified")]]);
  const claim = { type: "execution_result", outcome: "failure", quote: "corrected(wrong) on asset skl-x", relation_to_asset: "contradicts" };
  assert.match(verifyFact(claim, p2, "outcome:o9", ["10.244.7.19:8096"], "skl-new").reason, /names the asset's token/);
  assert.deepEqual([verifyFact(claim, p2, "outcome:o8", ["10.244.7.19:8096"], "skl-new").ok, verifyFact(claim, p2, "outcome:o8", ["10.244.7.19:8096"], "skl-new").strength], [true, "strong"]);
  assert.match(verifyFact(claim, p2, "outcome:o7", ["10.244.7.19:8096"], "skl-new").reason, /names the asset's token/);
});

test("supporting or contradicting the asset takes the asset's own token; inferences never do", () => {
  const ok = verifyFact({ type: "execution_result", outcome: "failure", quote: "10.244.7.19:8096 timed out for the consumer", relation_to_asset: "contradicts" }, pack, "outcome:o1", tokens);
  assert.deepEqual([ok.ok, ok.strength], [true, "strong"]);
  const weak = verifyFact({ type: "observed_operation", quote: "10.244.7.19:8096 timed out after 15 s", relation_to_asset: "contradicts" }, pack, "l0:msg1", tokens);
  assert.deepEqual([weak.ok, weak.strength], [true, "weak"]);
  assert.match(verifyFact({ type: "execution_result", outcome: "success", quote: "status=200", relation_to_asset: "supports" }, pack, "call:c1", tokens).reason, /names the asset's token/);
  assert.match(verifyFact({ type: "model_inference", quote: "Probe-all, trust-reachability", relation_to_asset: "contradicts" }, pack, "persona:1:3", tokens).reason, /cannot support or contradict/);
});

test("a harness outcome on the assessed asset is about it by identity: its state is the relation, whatever the model labelled", () => {
  const r = verifyFact({ type: "execution_result", outcome: "failure", quote: "corrected(wrong) on asset skl-a" }, pack, "outcome:o1", [], "skl-a");
  assert.deepEqual([r.ok, r.relation, r.strength, r.by_identity], [true, "contradicts", "strong", true]);
  assert.match(verifyFact({ type: "execution_result", outcome: "failure", quote: "corrected(wrong) on asset skl-a", relation_to_asset: "supports" }, pack, "outcome:o1", [], "skl-a").reason, /is a corrected\(wrong\) outcome on this very asset, which contradicts it/);
  // Another asset's outcome is not about this one; the token rule applies as usual.
  assert.equal(verifyFact({ type: "execution_result", outcome: "failure", quote: "corrected(wrong) on asset skl-a" }, pack, "outcome:o1", ["10.244.7.19:8096"], "skl-other").relation, "silent");
  const whole = checkAssessment({ competence: "medium", claims: [{ statement: "the consumer's use was corrected", type: "execution_result", outcome: "failure", record_ids: ["outcome:o1"], quote: "corrected(wrong) on asset skl-a" }] }, pack, { assetId: "skl-a" });
  assert.equal(whole.asset_claim_check.verdict, "contradicts");
  assert.equal(whole.asset_claim_check.strength, "strong");
});

test("a claim citing the intent row and the call row stands on the row that can carry it", () => {
  const p2 = new Map([...pack, ["call:c4", rec("call", "2026-09-06 model_intent Bash curl -X POST http://127.0.0.1:8096/skill-bridge/v3/skill/search status=0", { kind: "model_intent", upstream_status: 0 }, "proxy_observed")],
    ["call:c5", rec("call", "2026-09-06 bridge_call search status=200 {\"query\":\"deploy\"}", { kind: "bridge_call", upstream_status: 200 }, "proxy_observed")]]);
  // Unpaired: the bridge_call cannot be borrowed for the intent's quote; the sentence is kept as intent.
  const r = checkAssessment({ competence: "medium", claims: [{ statement: "searched", type: "execution_result", outcome: "success", record_ids: ["call:c4", "call:c5"], quote: "http://127.0.0.1:8096/skill-bridge/v3/skill/search" }] }, p2);
  assert.equal(r.claims_kept.length, 1);
  assert.equal(r.claims_kept[0].type, "observed_operation");
  assert.equal(r.execution_claims.calls, 0);
  const only = checkAssessment({ competence: "medium", claims: [{ statement: "searched", type: "execution_result", outcome: "success", record_ids: ["call:c4"], quote: "http://127.0.0.1:8096/skill-bridge/v3/skill/search" }] }, p2);
  assert.equal(only.claims_kept[0].downgraded_from, "execution_result");
  assert.match(only.claims_kept[0].note, /intent only/);
  // Paired by the pack: the quote may sit in the intent row; the paired bridge_call carries the status.
  const p3 = new Map([...p2]);
  p3.set("call:c4", rec("call", p2.get("call:c4").text, { ...p2.get("call:c4").meta, paired_call: "call:c6", pairing: "paired" }, "proxy_observed"));
  p3.set("call:c6", rec("call", "2026-09-06 bridge_call search status=200 {\"query\":\"deploy\"}", { kind: "bridge_call", upstream_status: 200, paired_intent: "call:c4", pairing: "paired" }, "proxy_observed"));
  const split = checkAssessment({ competence: "medium", claims: [{ statement: "searched, answered 200", type: "execution_result", outcome: "success", record_ids: ["call:c4", "call:c6"], quote: "http://127.0.0.1:8096/skill-bridge/v3/skill/search" }] }, p3);
  assert.equal(split.claims_kept[0]?.found_in, "call:c6");
  assert.equal(split.claims_kept[0]?.type, "execution_result");
  // A paired call cited alone, without the intent among the cited ids, is not borrowed either.
  const notCited = checkAssessment({ competence: "medium", claims: [{ statement: "searched, answered 200", type: "execution_result", outcome: "success", record_ids: ["call:c4"], quote: "http://127.0.0.1:8096/skill-bridge/v3/skill/search" }] }, p3);
  assert.equal(notCited.claims_kept[0]?.type, "observed_operation");
  const wrong = checkAssessment({ competence: "medium", claims: [{ statement: "searched, answered 200", type: "execution_result", outcome: "failure", record_ids: ["call:c4", "call:c6"], quote: "http://127.0.0.1:8096/skill-bridge/v3/skill/search" }] }, p3);
  assert.equal(wrong.execution_claims.calls, 0); // claimed failure disagrees with the paired 200; kept as intent at most
});

test("competence rests on business-level results, by ledger; transport is reported; high is never derived", () => {
  assert.equal(deriveCompetence([]).competence, "unknown");
  assert.equal(deriveCompetence([{ outcome: "success", ledger: "own_transport" }, { outcome: "success", ledger: "own_transport" }]).competence, "unknown");
  assert.equal(deriveCompetence([{ outcome: "failure", ledger: "others_on_assets" }]).competence, "low");
  assert.equal(deriveCompetence([{ outcome: "success", ledger: "own_business" }, { outcome: "failure", ledger: "others_on_assets" }]).competence, "medium");
  const many = deriveCompetence([{ outcome: "success", ledger: "own_business" }, { outcome: "success", ledger: "others_on_assets" }, { outcome: "success", ledger: "others_on_assets" }]);
  assert.equal(many.competence, "medium");
  assert.match(many.basis, /high is not derived/);
  assert.deepEqual(many.ledgers.others_on_assets, { success: 2, failure: 0 });
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
  assert.equal(r.competence, "unknown"); // both results are transport-only
  assert.equal(r.execution_claims.success, 1);
  assert.equal(r.execution_claims.failure, 1);
  assert.deepEqual(r.execution_claims.ledgers.own_transport, { success: 1, failure: 1 });
  assert.equal(r.competence_as_said, "low");
  assert.equal(r.counts.kept, 5);
  assert.equal(r.counts.citations, 4); // the coverage statement is not a citation
  assert.match(r.summary, /competence unknown: no business-level result; transport: 1 answered 2xx, 1 not/);
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

test("two calls are not one success: an intent in one session and an unrelated 200 in another cannot be stitched", () => {
  const raw = { competence: "high", claims: [{ statement: "connected to the target address", type: "execution_result", outcome: "success", record_ids: ["call:i2", "call:h"], quote: "http://10.244.7.19:8096/skill-bridge/v3/skill/search", relation_to_asset: "supports" }] };
  const r = checkAssessment(raw, pack, { assetTokens: tokens, assetId: "skl-a", assetVersion: 2 });
  assert.equal(r.competence, "unknown");
  assert.equal(r.asset_claim_check.verdict, "silent");
  assert.equal(r.claims_kept.length, 1);
  assert.equal(r.claims_kept[0].type, "observed_operation");
  assert.equal(r.claims_kept[0].downgraded_from, "execution_result");
  assert.match(r.claims_kept[0].note, /kept as intent/);
});

test("a paired bridge_call answers its intent; the quote may be the command", () => {
  const raw = { competence: "medium", claims: [
    { statement: "searched the bridge", type: "execution_result", outcome: "success", record_ids: ["call:i1", "call:r1"], quote: "http://127.0.0.1:8096/skill-bridge/v3/skill/search" },
    { statement: "the same search, said again", type: "execution_result", outcome: "success", record_ids: ["call:r1"], quote: "bridge_call search status=200" },
  ] };
  const r = checkAssessment(raw, pack, { assetTokens: tokens });
  assert.equal(r.claims_kept.length, 2);
  assert.equal(r.claims_kept[0].found_in, "call:r1");
  assert.equal(r.execution_claims.calls, 1); // one call, one result, two sentences
  assert.deepEqual(r.execution_claims.ledgers.own_transport, { success: 1, failure: 0 });
  assert.equal(r.competence, "unknown"); // transport only
});

test("the business ledgers are read from the pack's harness records, cited or not; the asset's own text cannot vouch for itself", () => {
  // Nothing cited: the pack still carries usr-a's own validated (own_business) and usr-b's on skl-a (others).
  const none = checkAssessment({ competence: "unknown", claims: [] }, pack, { assetId: "skl-a", assetVersion: 2, authorId: "usr-a" });
  assert.deepEqual(none.execution_claims.ledgers.own_business, { success: 1, failure: 0 });
  assert.deepEqual(none.execution_claims.ledgers.others_on_assets, { success: 1, failure: 1 }); // o0 validated v1, o1 corrected v2
  assert.equal(none.competence, "medium");
  assert.equal(none.asset_claim_check.verdict, "silent"); // relations still need a cited claim
  const self = new Map([...pack, ["skill:skl-a@2", rec("skill", "name: a\nSend searches to http://10.244.7.19:8096/skill-bridge/v3/skill/search", { skill_id: "skl-a", version: 2 }, "authored_text")]]);
  const r = checkAssessment({ competence: "medium", claims: [{ statement: "the asset says so itself", type: "environment_applicability", record_ids: ["skill:skl-a@2"], quote: "10.244.7.19:8096/skill-bridge", relation_to_asset: "supports" }] }, self, { assetTokens: tokens, assetId: "skl-a", assetVersion: 2 });
  assert.match(r.claims_dropped[0].reason, /own text; it cannot support or contradict its own claim/);
});

test("one call contributes one result: repeating a success in other words does not raise competence", () => {
  const raw = { competence: "high", claims: [
    { statement: "others validated the asset", type: "execution_result", outcome: "success", record_ids: ["outcome:own"], quote: "validated on asset skl-a v2 by usr-a" },
    { statement: "the asset was validated (again, in other words)", type: "execution_result", outcome: "success", record_ids: ["outcome:own"], quote: "validated on asset skl-a v2" },
  ], asset_claim_check: { verdict: "supports", type: "execution_result", outcome: "success", record_ids: ["outcome:own"], quote: "validated on asset skl-a v2 by usr-a" } };
  const r = checkAssessment(raw, pack, { assetTokens: tokens, assetId: "skl-a", assetVersion: 2, authorId: "usr-a" });
  assert.equal(r.execution_claims.harness_records, 3); // own, o0, o1 — each once, however often cited
  assert.equal(r.execution_claims.cited_transport_calls, 0);
  assert.deepEqual(r.execution_claims.ledgers.own_business, { success: 1, failure: 0 });
  assert.equal(r.competence, "medium");
});

test("an outcome on an earlier version of the asset is a result, not a relation to the current text", () => {
  const raw = { competence: "medium", claims: [{ statement: "v1 was validated", type: "execution_result", outcome: "success", record_ids: ["outcome:o0"], quote: "validated on asset skl-a v1", relation_to_asset: "supports" }] };
  const r = checkAssessment(raw, pack, { assetTokens: tokens, assetId: "skl-a", assetVersion: 2 });
  assert.equal(r.claims_kept.length, 1);
  assert.equal(r.claims_kept[0].relation, "silent");
  assert.match(r.claims_kept[0].note, /about version 1 of this asset, not version 2/);
  assert.equal(r.asset_claim_check.verdict, "silent");
  const same = checkAssessment({ competence: "medium", claims: [{ statement: "v2 corrected", type: "execution_result", outcome: "failure", record_ids: ["outcome:o1"], quote: "corrected(wrong) on asset skl-a v2" }] }, pack, { assetId: "skl-a", assetVersion: 2 });
  assert.equal(same.asset_claim_check.verdict, "contradicts");
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
  assert.equal(r.competence, "unknown"); // a transport 2xx alone decides nothing
  assert.equal(r.competence_as_said, "medium");
  assert.equal(r.claims_kept[0].type, "execution_result");
  assert.equal(r.claims_kept[0].outcome, "success");
  assert.deepEqual(r.execution_claims.ledgers.own_transport, { success: 1, failure: 0 });
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
