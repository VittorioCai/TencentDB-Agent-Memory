# Receipt

What one run used, from whom, in what state, with what evidence and what
risk. Written against `contracts/receipt.schema.json`; produced by every run
as `receipt.json` and `receipt.txt`.

| File | Does |
|---|---|
| `build-receipt.mjs` | Events → receipt. One item per asset at the highest state its events reached. |
| `render-cli.mjs` | Terminal rendering with one mark per status. |

## One asset, one line, one mark

```
✗ eval-bridge-endpoint-a  v2  skill
    from       usr-n68ea5ythq / agt-5e4hna56j9  (cross_user)
    status     corrected — used, and the call it fed failed for a reason its content explains
    impact     its value 10.244.7.19 was used in tool call call_00_… (message 9) and the call failed: … timed out
    related test verify.mjs: dial 10.244.7.19:8096 (call_00_…) failed
    evidence   verify_result … / tool_arg … / bridge_row … / capture_line …
    gate reject · author confidence 0.5
    risk       gate_rejected: rule reject: a corrected record exists (reason=wrong)

✓ eval-bridge-endpoint-b  v2  skill
    …
    related test verify.mjs: dial 127.0.0.1:47318 (call_01_…) passed
    gate admit · author confidence 0.5
```

| mark | status | means |
|---|---|---|
| ✓ | validated | used, and the call it fed succeeded in a run that passed |
| ✗ | corrected | used, and the call it fed failed for a reason its content explains |
| ● | used | hard evidence; outcome not tied to a call |
| ◐ | used_soft | a model's judgement only — never rendered as a check |
| ○ | fetched | body retrieved; use not established (a disputed use lands here with a `needs_review` risk) |
| · | provided | listed or placed in context; never fetched |

`corrected` outranks `validated` on the same asset in the same run. A receipt
is where a risk has to surface, and one failed call is a risk regardless of a
later success.

## The fields task four asks for

- **Source** is the asset record's owner (`producer_user_id`, `producer_agent_id`)
  on the same row as the consumer's relation to it. It is read from the event,
  which recorded both at the time; it is not looked up afterwards, because
  ownership changes and versions roll forward.
- **Verification status** is the mark above, with the specific call it rests
  on. Wording is "related test X passed", never "verified: test passed" — the
  second reads as a causal claim the evidence does not make.
- **Low-confidence risk** is the author's confidence from the gate decision.
  Null renders as "no cross-person validation yet", never as 0; below 0.5 is
  flagged with the value.

Other risks: `gate_rejected` / `gate_pending` from the decision the run faced;
`not_head` when the version used is not the pool's head; `needs_review` when
a token matched but the use could not be tied to this asset's own content.
`stale` and `conflict` are in the contract and not produced yet — no source
for either in this evaluation.

## Which gate decision a receipt shows

The one the run actually faced. With `--gate on|off` the runner passes the
frozen baseline's decisions; otherwise the run's own `gate-decisions.json`.
What this run's evidence alone would decide stays in `gate-decisions.json`
either way.

## Running it

```bash
R=evaluation/runner/runs/<run>
node evaluation/receipt/build-receipt.mjs \
  --events=$R/events.jsonl,$R/early-events.jsonl,$R/used-events.jsonl,$R/outcome-events.jsonl \
  --snapshot=$R/asset-pool-snapshot.json --decisions=$R/gate_baseline.json --run=$R/run.json \
  --out=$R/receipt.json

node evaluation/receipt/render-cli.mjs $R/receipt.json
node --test evaluation/receipt/*.test.mjs
```
