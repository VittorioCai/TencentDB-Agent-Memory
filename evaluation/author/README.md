# Author assessment from the author's own records

Review (2026-09-07) rejected the smoothed ratio `(V + α·μ) / (V + C + α)`:
two counts compressed into a number that says nothing about what the person
did. What replaces it is a reading of the author's history — the records
the product already keeps — with every claim cited and every citation
checked by a program. The gate reads the result; it never reads the model's
prose.

| File | Does |
|---|---|
| `build-evidence-pack.mjs` | The author's records as the product holds them, read with the author's own key, each with a stable id: `persona:<v>:<line>` (L3), `l1:<id>` (every L1 memory + domain search hits), `l0:<id>` (recent L0 messages + search hits), `skill:<id>@<v>` (skills they own, head of body), `outcome:<id>` (outcomes recorded on their assets), `call:<hash>` (optional: bridge calls, from `gate0/export-tool-call-logs.sh` with `USER_ID=`) |
| `assess.mjs` | Shows the pack to a model (persona, skills and outcomes always; L1/L0 ranked by keyword hits within a character budget; what was left out is listed) and asks for JSON: competence for the domain, cited claims with verbatim quotes, counter-evidence, and whether the author's own records support / contradict / are silent on one asset claim. `--dry-run` writes the prompt only; `--recheck=F` re-verifies a saved output after a checker change without another model call |
| `check-citations.mjs` | The verifier. A claim survives only if every cited record exists in the pack (a prefix-less id resolves when unambiguous) and its quote is found, verbatim after whitespace/case folding, in one of them. Competence is read off surviving claims — none survive and it is `unknown`, whatever the model said. Labels (`contradict` → `contradicts`, `Moderate` → `medium`) are folded; evidence is not. 7 tests |
| `write-assessment.sh` | Puts `summary_for_gate` onto the asset (`metadata_json.gate.author_assessment`) through the product's `asset/update` as the owner, reads it back, and runs `gate/evaluate` |
| `artifacts/` | Packs, prompts, assessments (`.json` with the raw model output beside the verified result; `.md` for reading), write records |

## What the gate does with it

`MemoryCore/src/metadata/service/asset-gate.ts` reads
`metadata_json.gate.author_assessment` — competence, domain, time, citation
count, and `asset_claim_check`. For a **pending** asset:

```
the author's own records contradict this asset's claim   → review priority high
the author has other assets judged wrong within 30 days  → high
competence low / unknown                                 → high
competence high                                          → low
otherwise                                                → normal
```

On an admitted or rejected asset the assessment is reported in `reasons`
and does not move the decision: the decision rests on outcomes.

## Live results (2026-09-07)

**Author A** (`usr-n68ea5ythq`), domain *reaching the team skill bridge over
HTTP from an agent session: which address answers*, asset claim = the wrong
asset's address. Pack: 55 records (persona 22, L1 4, L0 8, skills 2,
outcomes 19). Model output: 6 claims, all kept, 0 dropped.

- competence **medium** — A's own session probed both addresses and
  identified the answering one; the asset A wrote records the other.
- asset claim **contradicts** — `l0:msg-76898e301d59`: "Connection to
  `10.244.7.19:8096` failed after **75.0s**"; `outcome:472b3355…`
  corrected(wrong).
- Written onto `skl-sZFb3KatWY6m`; the gate's decision (reject, on
  outcomes) now reports it: *the author's own records contradict this
  asset's claim (reported, not used: the decision rests on outcomes)*.

**Author B** (`usr-4u07qc2kuj`), domain *reading team skills through the
skill bridge by name across agents*, asset claim = the v2 rule of B's own
auto-extracted skill ("get-by-name returns 40401 for another agent's
skill"). Pack: 392 records (L0 257, L1 116, persona 18, skill 1); 4 claims.
First check dropped 3 of them because the model cited `msg-…` without the
`l0:` prefix; the resolver was added and the saved output rechecked:
competence **high** (4 kept), asset claim **contradicts** — B's own head
version (v3) says the rule "is not true now".

Both runs: model `deepseek-v4-flash`, temperature 0, JSON output; about
7.6k prompt tokens for A.

## Limits, stated

- The checker verifies citations, not reasoning: a quote that is really in
  the record can still be cited for the wrong conclusion. What it removes
  is the fabricated record and the fabricated quote — the two failures a
  reader cannot catch without opening every record.
- Competence is a label the model chose among four; the check only refuses
  it when nothing supports it. Two assessors could label the same surviving
  evidence differently.
- Identity C has no records yet; an assessment of C reads `unknown` by
  construction until sessions are run as C.
- The author's records were themselves produced by the product's memory
  extraction from sessions the same person operated. The assessment reads
  what the product wrote about the author, not the author.

## Running it

```bash
node evaluation/author/build-evidence-pack.mjs --author=a \
  --domain="reaching the team skill bridge over HTTP from an agent session: which address answers" \
  --keywords="skill bridge address,10.244.7.19,127.0.0.1:47318,timed out" --asset=skl-sZFb3KatWY6m
node evaluation/author/assess.mjs --pack=evaluation/author/artifacts/evidence-pack-a.json \
  --domain="…" --asset-claim="the team skill bridge is reachable from an agent session at http://10.244.7.19:8096/…" \
  --asset=skl-sZFb3KatWY6m            # add --dry-run to see the prompt first
bash evaluation/author/write-assessment.sh evaluation/author/artifacts/assessment-a-skl-sZFb3KatWY6m.json \
  --as-of 2026-09-06T08:47:33Z --out evaluation/author/artifacts/assessment-write-a-skl-sZFb3KatWY6m.json
node --test evaluation/author/*.test.mjs
```
