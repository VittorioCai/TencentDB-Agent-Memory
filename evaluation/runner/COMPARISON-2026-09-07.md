# Gate on / off comparison, batch 2 — 2026-09-07

Same task, same consumer (B, `usr-4u07qc2kuj` / `agt-5e0y4l8a7a`), same
frozen evidence base (`gate_baseline.json`, frozen 2026-09-06T08:47:33Z).
Five runs with the gate off, five with it on, all `run-once.sh --auto`, all
launched in one sequence (off runs first, then on runs) between 09:44 and
09:53 UTC. Rendered table: `summary-2026-09-07.md`.

What changed since the 2026-09-06 batch, and why this batch exists:

1. **The gate is the product's.** Core holds the outcomes
   (`meta_asset_outcomes`), decides (`gate/evaluate`, rules
   `gate-rules-2026-09-07`), and writes the asset's `status`. "Off" means
   every baseline asset `approved`; "on" means Core evaluated **at `as_of` =
   the frozen baseline time**, so the decision cites exactly the two
   evidence-base runs and none of this batch's own outcomes (those are
   recorded with evaluate=false and sit on file). The bridge's whitelist —
   `list-accessible`, which drops `failed` — did the hiding. No script
   flipped `visibility`.
2. **The proxy's write switch** (cd2f9b0): under `allowLlmWrite=false` the
   prompt no longer orders the model to patch/create skills, no longer
   offers `skill_extract`, and the bridge refuses `extract`. The system
   prompt of every run in this batch carries "Skill writes are disabled in
   this session" and no `skill_patch`.
3. **The consumer's auto-extracted skill is at v3** (5958b9d): the outdated
   "get-by-name is owner-only" rule and the default probe-everything rule are
   gone from the head version; v2 is kept in the version history.
4. **Confounders are recorded per run** (`context-confounders.json`).

Because (2) and (3) change the model's context, the 2026-09-06 numbers and
these are two batches, not one sample. Both are reported; neither is
adjusted.

## Endpoint success rate: identical, as before

| arm | started | pass | endpoint success rate |
|---|---|---|---|
| gate-off-core | 5 | 5 | 100% |
| gate-on-core | 5 | 5 | 100% |

The acceptance lets the last attempt decide; `task.md` counts an accurately
reported failure as a completed task. Every off run dialled the wrong address
first, timed out, then dialled the right one and passed. The number is the
endpoint request success rate, not a task completion rate.

## Where the gate shows

| arm | wrong asset seen at any stage | first batch had a failure | failed attempts | corrected | validated | mean wall s | mean prompt tokens | mean total tokens |
|---|---|---|---|---|---|---|---|---|
| gate-off-core | **5/5** | **5/5** | 5 | 5 | 5 | 64 | 123.3k | 128.4k |
| gate-on-core | **0/5** | **0/5** | 0 | 0 | 5 | 28 | 119.6k | 122.2k |

Per run:

| run | arm | status at start (a = wrong, b = right) | first dial | attempts | outcomes | wall s | prompt tok |
|---|---|---|---|---|---|---|---|
| 09:44:29Z | off | a approved, b approved | 10.244.7.19:8096 timed out | 2 | a corrected, b validated | 57 | 120.7k |
| 09:45:58Z | off | a approved, b approved | timed out | 2 | a corrected, b validated | 61 | 122.7k |
| 09:47:00Z | off | a approved, b approved | timed out | 2 | a corrected, b validated | 83 | 127.6k |
| 09:48:23Z | off | a approved, b approved | timed out | 2 | a corrected, b validated | 67 | 126.4k |
| 09:49:30Z | off | a approved, b approved | timed out | 2 | a corrected, b validated | 51 | 119.3k |
| 09:50:21Z | on | **a failed**, b approved | 127.0.0.1:47318 code 0 | 1 | b validated | 29 | 116.6k |
| 09:50:50Z | on | a failed, b approved | code 0 | 1 | b validated | 31 | 123.0k |
| 09:51:22Z | on | a failed, b approved | code 0 | 1 | b validated | 24 | 117.3k |
| 09:51:46Z | on | a failed, b approved | code 0 | 1 | b validated | 21 | 115.3k |
| 09:52:07Z | on | a failed, b approved | code 0 | 1 | b validated | 35 | 125.7k |

Status at start is read back from Core after the write (`gate-apply.json`,
`all_verified: true` in every run) and copied into `run.json.gate`. With the
gate on, the wrong asset appears at no lifecycle stage — not recalled by the
bridge search, not injected, not fetched — because the product's own
`list-accessible` no longer returns a `failed` asset to the consumer.

The token gap is smaller than in batch 1 (≈3% here, ≈10% there). Both arms'
prompts are shorter than before — the write directive is gone from the
`<available_skills>` header — and the off arm's extra turn now costs less
relative to the whole. The saving is still one turn: the failed dial and its
recovery.

## What else was in context

| arm | L3 memory block present | L3 carried a watched line | read a skill outside the pool |
|---|---|---|---|
| gate-off-core | 5/5 | 5/5 | 2/5 |
| gate-on-core | 5/5 | 5/5 | 2/5 |

The consumer's own L3 memory (its SOP: "probe every documented candidate")
was in every run of both arms, unchanged by this batch. So the off arm's
second dial is prescribed behaviour, as in batch 1, and the arms remain
comparable with each other. The consumer read its own auto-extracted skill
(`skill-bridge-http-access`, now v3) in 2 of 5 runs per arm; its body carries
neither discriminative token.

## Calibration, now on independent runs

The revised attribution rule (same-asset listing entry is not another
source) was frozen at commit 44c3ca2 before this batch. Leave-one-out over
all 25 runs (`calibration/loo-2026-09-07.md`):

| asset | present | acted | judged used | hidden | acted while hidden | precision | recall |
|---|---|---|---|---|---|---|---|
| eval-bridge-endpoint-a (wrong) | 12 | 12 | 12 | 8 | 0 | 100% (n=12) | 100% (n=12) |
| eval-bridge-endpoint-b (right) | 16 | 16 | 16 | 4 | 0 | 100% (n=16) | 100% (n=16) |

The 15 new (run, asset) pairs from this batch — 5 for the wrong asset, 10
for the right — were all acted on and all judged `used`, and the wrong asset
was never acted on while hidden across 5 more hidden runs. This is the
independent check the 2026-09-06 note asked for: the 100% after the rule
revision is no longer a recomputation on the data that prompted it.

`contributed` recomputed over all runs: the right asset v2 stays
`contributed` (endpoint success 1.0 vs 0.0 over 16 present / 4 absent runs;
0.5 vs 1 failed attempts; 44 s vs 50 s; 125k vs 145k prompt tokens); the
wrong asset does not (no validated outcome).

## Receipts

Each run's receipt carries the product's decision: `闸门(Core) 准入 ·
证据置信度 1 · 规则 gate-rules-2026-09-07` for the right asset, `拒绝 ·
证据置信度 0` for the wrong one, marked `未应用（本次闸门关闭）` in the off
runs. No author confidence appears — that number no longer exists.

## What this batch does and does not establish

Established, n = 5 per arm, under the in-Core gate:

- A rejected asset is not retrievable by the consumer through the real client
  path, and the hiding is the product's own status semantics.
- With the gate off the same asset is retrieved and acted on in every run,
  at one failed dial and roughly 35 s per run.
- The endpoint success rate does not move; the gate shows in the process.

Not established:

- Anything beyond one wrong asset with one reachability-class failure. The
  second scenario (`tasks/bridge-name`) is the planned extension.
- Ecological validity: one person operates every identity; the consumer's L3
  memory was learned from that same person's earlier runs.
- Any improvement attributable to the write switch or the v3 skill: their
  effect was not isolated (no arm ran without them).

## Provenance

- Gate: `evaluation/eval-core.sh` mounted `MemoryCore/src/metadata` at commit
  98cbe25 (as_of added in b1bae63 and applied afterwards:
  `gate/artifacts/core-apply-asof-2026-09-07.json`). Seed record:
  `gate/artifacts/core-seed-2026-09-07.json`.
- Proxy: `evaluation/eval-proxy.sh` mounted skill-injector, skill-bridge,
  skill-tools-injector and injection/index at commit cd2f9b0.
- Each run: `run.json` (gate.mechanism = core-status, status_at_start,
  core_outcomes), `gate-apply.json`, `core-outcomes.json`,
  `core-gate-state.json`, `context-confounders.json`, `verdict.json`,
  `cost.json`, receipts.
- Auto-extraction off in every run; the pool-drift check reported the
  consumer's own skill (outside the frozen snapshot) in every run, as it
  should.
- One defect found and fixed mid-batch: the export-time task-id extraction
  used `\b` in BSD sed and matched nothing (ca1fcf8). Two runs' events were
  restamped from the proxy log afterwards; no other artifact was touched.
