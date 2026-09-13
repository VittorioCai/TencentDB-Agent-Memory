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

## The topic's own sample shape, in both languages

`render-cli.mjs --lang=zh` renders the frame the topic's sample uses:

```
本次应用 2 项团队资产
- Skill：eval-bridge-endpoint-a — its value 10.244.7.19 was used in tool call … and the call failed …
- Skill：eval-bridge-endpoint-b — its value 47318 was used in tool call …; the call succeeded …

效果状态
- 1 项已通过相关测试验证
- 1 项被证明错误——已采用，且它引出的调用因其内容而失败
```

The frame, labels, status words and risk names are Chinese; the evidence
strings (impact, proof details) are the recorded English text of the events,
left as recorded rather than paraphrased. The runner writes `receipt.txt`
(English) and `receipt.zh.txt` beside `receipt.json`.

Two fields exist for the sample's two questions:

- **`category`** — the topic's taxonomy (项目约定 / 历史方案 / 失败经验 /
  Skill / 代码知识 / 产品知识). Only what is declared: a skill record is
  `skill` by the taxonomy's own entry; a knowledge or memory record must carry
  a `category` on its pool row or it is `not_declared`. Reading "convention"
  in a description and filing it as a project convention would be the receipt
  inventing a fact.
- **`why_applicable`** — why the asset was offered, from the retrieval
  system's own record on the `recalled` event: the model's query, the asset's
  rank and score in the reply. Never a reason written after the fact; null
  when no retrieval call in the run offered it.

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

## contributed, conflict, stale — the approved definitions (2026-09-06)

- **contributed** (◆) — a cross-run claim about a *version*, looked up from
  `evaluation/calibration/contributed-events.jsonl`, never derived from one
  run. It upgrades a `validated` item only; a `corrected` item stays corrected
  whatever a batch says elsewhere. The event carries the contrast batch id,
  the run ids on both sides, raw values of every gain metric on both sides,
  and the commit the judging rules were frozen at. See
  `evaluation/calibration/contributed.mjs` for the three conditions.
- **conflict** — behavioural evidence only: two assets fed *different values*
  to the *same call slot* (the acceptance endpoint, from the verdict's
  attempts) in this run. Each is flagged naming the other. Description
  similarity and the model's own remark that "the two disagree" are never
  used. In the gate-off runs both mainline assets are flagged: they supplied
  10.244.7.19:8096 and 127.0.0.1:47318 to the same `skill:search` slot.
- **stale** — `updated_at` older than a threshold (default 90 days,
  `--stale-days`) produces a review prompt worded "review suggested, not
  judged expired". The threshold is a parameter of this evaluation with no
  empirical basis, and the wording says so. It never reaches the gate.

## 闭环展示(`chain-cli.mjs`)

按次回执回答的是"这次用了哪些资产、状态如何";它回答不了评委真正会追的那条线。
`chain-cli.mjs` 把一次真实运行按七环展开,每一环都能打开看证据文件与字段:

    原始经验 → 笔记与适用条件 → 检索与取回 → 实际新增的测试/代码 → 独立验收 → Core 判定 → 新候选

```bash
node evaluation/receipt/chain-cli.mjs                              # 主链条
node evaluation/receipt/chain-cli.mjs --expand                     # 逐环展开证据
node evaluation/receipt/chain-cli.mjs --case=delivered_not_adopted # 反例一
node evaluation/receipt/chain-cli.mjs --case=adopted_but_flagged   # 反例二
```

**硬规则:某一环没有证据就显示「未证明」并说明原因,绝不拿相邻证据顶替。**
主链条那次运行现在是**七环已证六环**——第 7 环(新候选)对**这一次运行**没有证据,
候选是后来开着提取的那次写回产生的,属于另一条流程。把它标成未证明,而不是从别处借一条,
正是这套东西要展示的态度:链条允许断,不允许糊。

三条链各自的资产来源也随案例走:反例一用的是 bridge-addr 那对只差地址的资产,不是退出码笔记
——早先版本把笔记硬编码给了所有案例,等于替那次运行编了一个它没有的来源,已修。

两个反例分别证明:

- **反例一(送达 5 次、采用 1 次)**:系统按"操作是否实际用了它"判定,不按"内容是否到过模型"判定。
- **反例二(参考采纳成立、判定器未产出 used)**:按现行校准记一次**假阴性且计入分母**,不是弃权;
  `needs_review` 说明的是它为什么保守拒判,不是把它移出分母的理由。

`deliver-check.sh` 每次复跑都会渲染这三条链并存档(`chain.txt`),渲染失败会让验收失败。
