# Author assessment from the author's own records

Review (2026-09-07) rejected the smoothed ratio `(V + α·μ) / (V + C + α)`:
two counts compressed into a number that says nothing about what the person
did. What replaced it is a reading of the author's history — the records
the product already keeps — with every claim cited and every citation
checked by a program. The follow-up review (2026-09-08) found the first
version checked the citation but not the fact: a quote that really is in
the record could still carry the wrong conclusion. **v2** checks both, and
derives the conclusions itself.

| File | Does |
|---|---|
| `build-evidence-pack.mjs` | The author's records, read with the author's own key on the management path, each with a stable id and an **evidence class**: `call:<hash>` proxy_observed (calls the proxy itself logged, with the upstream HTTP status — from `gate0/export-tool-call-logs.sh` with `USER_ID=`), `outcome:<id>` harness_verified (trusted outcomes only; untrusted rows counted and left out), `l0:<id>` user_instruction / assistant_report (L0 keeps user and assistant messages only; tool results are not stored, so an assistant's account of a command is a narration), `l1:<id>` derived_memory (provenance `source_unavailable` — the query API returns no source message ids), `persona:<v>:<line>` team_principles (L3, stored per team + agent: the team's working principles, not the person's record), `skill:<id>@<v>` authored_text (the writer of each version is unknown: the store records the owning agent). `--cutoff` keeps only records dated at or before it; undated records and a persona updated after it are excluded and counted. For the asset under assessment: version, content hash, discriminative tokens, and a chain *version → producer → source sessions → operations → results* with every break named |
| `assess.mjs` | Shows the pack to a model (persona, skills, outcomes and calls always; L1/L0 ranked by keyword hits within a budget; what was left out is listed) and asks for **typed** claims — `execution_result` (with `outcome` success/failure), `observed_operation`, `environment_applicability`, `model_inference`, `coverage_unknown` — each cited with a verbatim quote and a `relation_to_asset`. `--dry-run` writes the prompt; `--recheck=F` re-verifies a saved output after a checker change without another model call |
| `check-citations.mjs` | The verifier, in two parts. **Citation**: every cited record exists (a prefix-less id resolves when unambiguous) and the quote is found verbatim (whitespace/case folded) in a cited record. **Fact**: the cited record can carry the claim's type — an execution result needs a proxy-observed call or a harness-verified outcome and must agree with the status that record carries (an intent row with no status, or an assistant's narration, cannot carry it); an observed operation needs a message, a call, an outcome or a memory with a traceable source; supports/contradicts must quote the asset's own token, and a harness outcome recorded on the assessed asset is about it by identity — its state *is* the relation. **Conclusions are derived**, never taken from the model: competence from execution-grade claims only (none → unknown; failures only → low; one success → medium; two or more → high; failures beside successes reported, not subtracted — a probe that timed out is an operation, not a lack of skill); the asset-claim verdict from accepted claims (strong when execution-grade); the summary from the counts. The model's competence, verdict and prose are kept as *said*. 13 tests |
| `write-assessment.sh` | Puts `summary_for_gate` onto the asset through `/v3/meta/asset/gate/assessment` with the **admin key**: Core admits only a team admin or reviewer (never the author), checks the binding — author, asset version, content hash, `evidence_cutoff` — signs it (`written_by`, `written_at`) and re-decides. An assessment merged into `metadata_json` through `asset/update` is dropped by the audit-field guard; an unsigned one on file is ignored by the gate |
| `demo-cold-start.sh` | A new skill by A → candidate → pack (calls exported, cutoff now) → assessment → written through the route → the gate's priority reflects it |
| `artifacts/` | Packs, prompts, assessments (`.json` with the raw model output beside the verified result; `.md` for reading), write records |

## What the gate does with it

`MemoryCore/src/metadata/service/asset-gate.ts` reads
`metadata_json.gate.author_assessment` only when it is signed and bound to
this author, this version and this content, and — when evaluating at
`as_of` — used no evidence past that time; otherwise the decision says why
(`signals.author.assessment_ignored`). For a **pending** asset:

```
the author's own records contradict this asset's claim   → review priority high
the author has other assets judged wrong within 30 days  → high
competence low / unknown                                 → high
competence high                                          → low
otherwise                                                → normal
```

On an admitted or rejected asset the assessment is reported in `reasons`
and does not move the decision: the decision rests on outcomes.

## Live results (2026-09-08, evidence cutoff = the frozen baseline 2026-09-06T08:47:33Z)

**Author A** (`usr-n68ea5ythq`), domain *reaching the team skill bridge
over HTTP from an agent session: which address answers*, asset
`skl-sZFb3KatWY6m` (claims 10.244.7.19). Pack: 49 records — proxy_observed
9, harness_verified 4 (19 untrusted rows left out), assistant_report 4,
user_instruction 4, derived_memory 4 (all source_unavailable),
team_principles 22, authored_text 2; 1 record after the cutoff excluded.
Chain: operations 3 (proxy-observed calls naming the address), results 2
(corrected outcomes on the asset); breaks: the version's operator is
unknown; 4 L0 messages name the address but carry no session id.

- competence **high** — 2 recorded successes (bridge calls answered 200), 2
  failures beside them; model said high.
- asset claim **contradicts (strong)** — by identity: `outcome:ba8e0c6e…`,
  `outcome:c91cdca6…` are corrected(wrong) outcomes on this very asset.
  The model had put its contradiction in a `model_inference` claim, which
  the checker drops for that purpose; the verdict rests on the outcome
  records the model also cited as execution results.
- Written and signed; at `as_of` = the frozen time the gate accepts it and
  reports it on the reject.

**Author B** (`usr-4u07qc2kuj`), domain *reading team skills through the
skill bridge by name across agents*, asset `skl-lUWmwEYqsZDZ` v3. Pack: 271
records at the cutoff (755 later ones excluded; persona excluded — updated
after the cutoff) — proxy_observed 151, user_instruction 45,
assistant_report 44, derived_memory 31; no trusted outcome on the asset.

- competence **high** — 3 recorded successes (search / get / files-read
  answered 200); model said medium.
- asset claim **supports (strong)** on the bridge calls that ran the
  asset's own recommended operations.
- Written and signed; the candidate's review priority is low.

Both runs: `deepseek-v4-flash`, temperature 0, JSON output.

## Limits, stated

- A proxy-observed "success" is an HTTP 2xx from upstream: the endpoint
  answered. An application-level refusal carried inside a 200 body (a
  40401 envelope) is not visible in the proxy log and is not claimed
  either way; B's coverage_unknown claim says exactly that.
- The source chain breaks at the same two places for everyone: the skill
  store does not record who wrote a version, and the conversation query
  returns no session id — so "the author's own session produced this" is
  read from the author's key scope, not from a link the product stores.
- Between two runs at temperature 0 the model chose different records to
  cite; the checker kept what was verifiable each time (B: high → unknown →
  high as the checker learned to read the bridge_call row beside the
  intent row). The assessment is only as complete as the citations the
  model happened to write; `coverage_unknown` claims mark what it did not
  cover, and the pack lists what it was not shown.
- Identity C has no records yet; an assessment of C reads `unknown` by
  construction until sessions are run as C.
- The author's records were produced by the product's memory extraction
  from sessions the same person operated. The assessment reads what the
  product wrote about the author, not the author.

## Running it

```bash
USER_ID=usr-n68ea5ythq SINCE="30 DAY" OUT=/tmp/calls-a.jsonl bash evaluation/gate0/export-tool-call-logs.sh
node evaluation/author/build-evidence-pack.mjs --author=a \
  --domain="reaching the team skill bridge over HTTP from an agent session: which address answers" \
  --keywords="skill bridge address,10.244.7.19,127.0.0.1:47318,timed out" --asset=skl-sZFb3KatWY6m \
  --cutoff=2026-09-06T08:47:33Z --calls=/tmp/calls-a.jsonl
node evaluation/author/assess.mjs --pack=evaluation/author/artifacts/evidence-pack-a.json \
  --domain="…" --asset-claim="the team skill bridge is reachable from an agent session at http://10.244.7.19:8096/…" \
  --asset=skl-sZFb3KatWY6m            # add --dry-run to see the prompt first
bash evaluation/author/write-assessment.sh evaluation/author/artifacts/assessment-a-skl-sZFb3KatWY6m.json \
  --as-of 2026-09-06T08:47:33Z --out evaluation/author/artifacts/assessment-write-a-skl-sZFb3KatWY6m.json
node --test evaluation/author/*.test.mjs
```
