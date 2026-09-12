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
| `build-evidence-pack.mjs` | The author's records, read with the author's own key on the management path, each with a stable id and an **evidence class**: `call:<id>` proxy_observed (one row, one id — the same request from two sessions is two calls; calls the proxy itself logged, with the upstream HTTP status — from `gate0/export-tool-call-logs.sh` with `USER_ID=`), `outcome:<id>` harness_verified (**the rows Core says the gate may read**: every row comes back from `asset/outcome/list` stamped with `gate_validity` — usable / trusted / retracted / bound — computed by the same function the decision uses, and the pack keeps or drops by that stamp instead of re-deriving the rule; untrusted and retracted rows are counted and left out, and the pack records whether the stamp came from Core or from the local fallback. The record carries the version, the **content hash**, `bound` and the recorded time beside the event time, and names the tokens of the outcome's own asset **at that version**), `l0:<id>` user_instruction / assistant_report (L0 keeps user and assistant messages only; tool results are not stored, so an assistant's account of a command is a narration), `l1:<id>` derived_memory (provenance `source_unavailable` — the query API returns no source message ids), `persona:<v>:<line>` team_principles (L3, stored per team + agent: the team's working principles, not the person's record), `skill:<id>@<v>` authored_text (the version that existed at the cutoff, not the head; the writer of each version is unknown). **Pairing**: each bridge_call is tied to the model_intent it answered (same session, within 30 s, endpoint named in the command, a body value present in the command) — and the match must be unique **from both sides**: exactly one candidate command *and* no other result claiming that command → paired; anything else → ambiguous (the result is real, but which command it answered is not known); none → unpaired. Checking one side only (until 2026-09-08d) let two results claim one command — a duplicated service record, a retry, or the other result's own command missing from the export — and the second silently overwrote the first, so both were counted as paired. **Cutoff**: a record is dated by its last modification (`updated_at` for a memory), so a memory changed after the cutoff is excluded and counted — the earlier text is not kept anywhere; undated records and a persona updated after the cutoff are excluded too. For the asset under assessment: version, content hash, exact tokens from its body, and a chain *version → producer → source sessions → operations → results* with every break named |
| `assess.mjs` | Shows the pack to a model (persona, skills, outcomes and calls always; L1/L0 ranked by keyword hits within a budget; what was left out is listed) and asks for **typed** claims — `execution_result` (with `outcome` success/failure), `observed_operation`, `environment_applicability`, `model_inference`, `coverage_unknown` — each cited with a verbatim quote and a `relation_to_asset`. `--dry-run` writes the prompt; `--recheck=F` re-verifies a saved output after a checker change without another model call |
| `check-citations.mjs` | The verifier, in two parts (and see the scope note below: it checks structure, not the meaning of free text). **Citation**: every cited record exists (a prefix-less id resolves when unambiguous) and the quote is found verbatim (whitespace/case folded) in a cited record. **Fact**: the cited record can carry the claim's type — an execution result needs a status from a record that answered the quoted command (the quoted record itself, or the bridge_call the pack **paired** with the quoted intent; a call that answered some other command cannot be borrowed, and with no such record the sentence is kept as an observed operation, never as a result); an observed operation needs a message, a call, an outcome or a memory with a traceable source; supports/contradicts must quote the asset's own token **exactly** (a host alone names no port; `:9999` failing says nothing about `:8096`), the asset's own text cannot vouch for itself, a result a later result for the same call superseded carries no conclusion about **any** asset (Core stamps `final`), and a harness outcome on the assessed asset **that Core stamped `bound: current`** is about it by identity — its state *is* the relation (an outcome on another version, on other content, or carrying neither is a result, not a relation). **Strength follows the evidence class**: only a harness-verified business result is `strong`; a proxy 2xx says the endpoint answered and nothing about whether the read succeeded or the task was done, so transport evidence supports or contradicts at most `weak`. **Conclusions are derived**, never taken from the model. Results are counted per call, not per sentence, and a call counts as what it **finally** came to — a call recorded `used`, then `validated`, then `corrected` is one corrected call, not a success beside a failure. **Which row that is comes from Core** (`gate_validity.final`), the same answer the gate uses; a superseded row may be quoted but carries no conclusion, so the ledger and the supports/contradicts check can no longer disagree about one call. Three ledgers: the author's own business results (harness outcomes where the author is the consumer), others' results on the author's assets, and the author's transport-only calls (a proxy 2xx). The two business ledgers are read from the pack's harness records themselves, cited or not; competence rests on them alone — none → unknown, failures only → low, any success → medium; **`high` is never derived** (nothing here is calibrated to say it), so a derived assessment can never lower a candidate's review priority. The asset-claim verdict comes from accepted claims (strong when execution-grade); the summary from the counts. The model's competence, verdict and prose are kept as *said*. 24 tests, and 6 more on the pack builder |
| `write-assessment.sh` | Puts `summary_for_gate` onto the asset through `/v3/meta/asset/gate/assessment` with the **admin key**: Core admits only a team admin or reviewer (never the author), checks the binding — author, asset version, content hash, `evidence_cutoff` — signs it (`written_by`, `written_at`) and re-decides. An assessment merged into `metadata_json` through `asset/update` is dropped by the audit-field guard; an unsigned one on file is ignored by the gate |
| `demo-cold-start.sh` | A new skill by A → candidate → pack (calls exported, cutoff now) → assessment → written through the route → the gate's priority reflects it |
| `artifacts/` | Packs, prompts, assessments (`.json` with the raw model output beside the verified result; `.md` for reading), write records |

## 归档件里的旧字段(读的时候要知道)

`artifacts/` 下 8 个历史件仍带 `chain_complete`(写入记录、冷启动演示、重算记录):那是 2026-09-12
复核之前的字段形状,当时把"三个集合各自非空"叫作来源链完整。它们是**当时写出去的东西的快照**,
按"旧记录不改"留着原样,只在每份里加了一行 `schema_note_2026_09_12` 说明这是旧形状。当前口径是
`chain_production_link`(恒为 unproven)等字段。`runner/runs/*/gate-apply.json` 里也有同名字段,那是
Core 当时返回的原始运行记录,更不修改。写进 Core 的那份摘要同样还带这个 null 字段,要换成新字段
需要再写一次评估(管理员密钥)。

## 程序核到哪一步(2026-09-12 第三轮复核后收紧)

程序核对的是:**引用真实性**(记录存在、引文在记录里)、**结构化结果一致性**(声明的类型与结果
和记录里的 state / upstream_status 一致)、**资产关联**(同资产同版本同内容按身份,或引文里出现
该资产的判别值)。**自由文本结论的语义与适用范围不因此得到验证**——复核构造过一条反例:引文、
状态、绑定全真,声明却是"作者不具备部署能力,而且这个地址在任何环境都不能工作",程序照样接受。

所以每条被保留的声明现在带两样东西:`fact_sentence` 是程序**从记录字段造的句子**(只说资产、
版本、state、消费者、call、时间这些有的字段),`model_statement` 是模型原话,按**推断**读。
检查结果里的 `scope_note` 把这条边界写在输出里,不只写在文档里。给人看的 Markdown 也是这个形状(2026-09-12 第四轮复核:JSON 分开了、Markdown 还在标题写 `Competence: medium` 并直接铺模型原话):标题是**本资产结果概况**并写明定级只用被评估资产上的结果,每条声明先「记录事实(程序生成)」、再「模型表述(语义未核验)」,`scope_note` 也印在那一份里。

## 这个等级说的是什么:资产结果概况,不是人的能力(2026-09-12,两轮复核后)

**先把名字说对(第三轮复核)**:字段仍叫 `competence`(与 Core 的签名摘要兼容),但它衡量的是
**这条资产上已有结果的概况**,不是经过验证的人的能力。别人用作者的这条资产失败,支持的是
"这条资产在该条件下表现不佳";别人用成功,也不能证明作者本人做过这件事。所以正确的读法是:

> 本资产已有结果:2 次纠错、0 次验证通过。作者在相关领域的能力尚未据此确定。

它继续作为**复核优先级**的输入(low/unknown → high,high → low),但任何地方都不应把它读成
"这个人能力低/中"。Core 的闸门理由串已同步改为 `asset-outcome profile … on this asset`。

等级只由**被评估资产上**的业务结果得出。作者在别的资产上的历史结果照常统计、照常显示,但
不参与定级——评价范围不同:39 条 bridge 地址结果说明不了"读退出状态行"这件事。被评估资产
上没有业务结果时,等级是 `unknown`,不是 medium;`high` 仍然永不推出。
检查器的输出里,`execution_claims.domain_counts` 是定级用的那部分,`cross_asset_history` 是
另算的历史,`scoped_to` 是被评估的资产 id。

同一条规则也管相关性:资产没有判别值时,**别的资产**上的结果不能被算作支持或反驳——引文
可能属实,但两件事无关,一律记 `silent`(`relevance unverifiable`)。同资产、同版本、同内容
的结果仍按身份关联,这条没变。

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

## Live results (2026-09-08d, evidence cutoff = the frozen baseline 2026-09-06T08:47:33Z)

**Author A** (`usr-n68ea5ythq`), domain *reaching the team skill bridge
over HTTP from an agent session: which address answers*, asset
`skl-sZFb3KatWY6m` v2, content `163c539025…` (claims 10.244.7.19:8096).
Pack: 49 records — proxy_observed 9 (3 bridge_calls paired with their
commands, 1 ambiguous: two probes with the same query, only one of which
reached the proxy; 2 commands ambiguous on their side), harness_verified 4
(of the 8 rows in the window; 4 untrusted, 0 retracted left out — the counts
describe the window, not all history, because the cutoff now goes to Core
with the query), assistant_report 4,
user_instruction 4, derived_memory 4 (all source_unavailable),
team_principles 22, authored_text 2 (the versions that existed at the
cutoff; 1 skill created later excluded). Related evidence: results 2
(corrected outcomes on the asset); gaps: 4 L0 messages name the address but
carry no session id; production link unproven.

- competence **low** (2026-09-12, after the second review scoped competence to
  the asset under assessment) — on *this* asset the author's ledger holds 2
  corrected and 0 validated; the 2 validations of A's *other* asset are now
  reported as cross-asset history and do not set the level. Before the fix it
  read medium, because every business result of the author counted whatever
  asset it was about. (The still earlier "high — 2 successes" had
  search 200s as if they were two successful executions by A; they are
  kept apart now.)
- asset claim **contradicts (strong)** — by identity, version and content:
  `outcome:ba8e0c6e…`, `outcome:c91cdca6…` are corrected(wrong) outcomes on
  this very asset at v2, both carrying content hash `163c539025…` — the
  text under assessment. Neither is retracted.
- Written and signed; at `as_of` = the frozen time the gate accepts it and
  reports it on the reject.

**Author B** (`usr-4u07qc2kuj`), domain *reading team skills through the
skill bridge by name across agents*, asset `skl-lUWmwEYqsZDZ` (head v3; v2
at the cutoff). Pack: 299 records at the cutoff (754 later ones excluded;
persona excluded — updated after the cutoff) — proxy_observed 178 (19
paired, 34 ambiguous, 68 unpaired, 20 commands with no observed result, 18
commands ambiguous on their side; the earlier count read 35 paired / 18
ambiguous, because a command claimed by two results was still reported as
paired — 16 pairs moved once the match had to be unique from both sides;
27 rows the earlier body-hash id had overwritten are back),
user_instruction 45, assistant_report 44, derived_memory 31; no trusted
outcome on the asset.

- competence **unknown** — no business-level result; transport 1 answered
  2xx (reported, not decisive); model said unknown.
- asset claim **silent** — the model's "supports" quoted B's own skill
  text, which cannot vouch for itself.
- Written and signed at v3. The write first came back
  `permission_denied (visibility_restricted)`: B's request for review named
  v1 and the skill is at v3, so the version-bound expiry had taken the
  reviewers' access to the private candidate with it. B re-submitted v3 and
  the write went through — the phase-2 rule behaving as specified. The
  candidate's review priority is **high** (unknown), no longer low.

**A's cold-start candidate** (`skl-ImeA29HL3Djj`, claims the same
address): competence **unknown** (2026-09-12: no business result on this
candidate itself; the author's results on other assets are history, not
capability here — it read medium before the scoping fix); asset claim
contradicts (strong) through the
exact token `10.244.7.19:8096` carried by the v2 body of the asset the
corrected outcomes are on; priority high with the outcome ids in the
reason.

All runs: `deepseek-v4-flash`, temperature 0, JSON output.

## Limits, stated

- A proxy-observed "success" is an HTTP 2xx from upstream: the endpoint
  answered. An application-level refusal carried inside a 200 body (a
  40401 envelope) is not visible in the proxy log; such calls go to the
  transport ledger, which is reported and never decides competence.
- Competence is uncalibrated: the ledgers say what happened, the label
  says only "none / failures only / some success". `high` is not produced
  by this pipeline; a human review is the only way to lower a candidate's
  priority on the author's account.
- Pairing is heuristic (session, time window, endpoint, a body value in
  the command), and the match must be unique from both sides. An ambiguous
  pair — two commands with the same query, one answered; or one command and
  two results — is kept as intent on both sides.
- The source chain used to break at two places for everyone, and both were
  ours, not the product's (2026-09-08g). The skill store keeps **one row per
  version with the writer's `user_id` on it**, returned by
  `/v3/skill/versions` as `owner_user_id` — a misleading name, which is why
  it was read as "the operator is unknown" for weeks; the chain now names
  who wrote the version under assessment. And `/v3/conversation/query` does
  return `session_id`: what dropped it was the pack itself, because
  `/v3/conversation/search` returns only content/id/role/score/timestamp,
  and a search hit overwrote the query's richer copy of the same message.
  Records are merged now instead of overwritten. **What the pack can and
  cannot say (corrected 2026-09-12 after a second review):** it collects the
  evidence *around* a version — sessions naming the asset or its tokens, calls
  carrying them, outcomes on that asset id — and it names the writer of the
  version from the version row. It does **not** verify that adjacent records
  are linked, so it cannot show the version was produced by those sessions:
  `production_link` is always `unproven`, and the earlier "A's chain is
  complete — version → writer → session → operations → results, no breaks"
  claimed more than the code checks (three non-empty sets). Empty sets are
  still listed as gaps, and a gap is a fact about the evidence rather than a
  hole in the tooling: no trusted outcome exists on some of those assets at or
  before the cutoff.
- That `conversation/search` and `conversation/query` return different
  fields for the same message is a product inconsistency. It is worked
  around here (join by message id), not fixed.
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
