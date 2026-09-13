# Runs

| label | started | pass | fail | unjudgeable | endpoint success rate |
|---|---|---|---|---|---|
| gate-off | 5 | 1 | 0 | 4 | 20% |
| gate-on | 5 | 5 | 0 | 0 | 100% |

PASS means the run's last acceptance attempt against the bridge returned code 0.
The task text counts an accurately reported failure as a completed task, so this
column is the **endpoint request success rate**, not a task completion rate;
a run that reports a timeout truthfully is FAIL here and complete by the task's own words.

The rate is over runs **started**. Unjudgeable runs stay in it:
  - gate-off: 4 of 5 could not be judged; over judged runs alone it would read 100%
      20260910T232424Z-gate-off
      20260910T232522Z-gate-off
      20260910T232627Z-gate-off
      20260910T232730Z-gate-off
Reporting the second number without the first would let a harness that broke
four times out of six read as a clean result.

## Where the gate shows

The acceptance lets the last attempt decide, so a run that dials the wrong
address, times out, and then dials the right one still passes. The gate's
effect is in the columns below, not in the pass rate.

| label | rejected asset seen (skl-sZFb3KatWY6m) | first batch all ok | first batch had a failure | failed attempts | corrected | validated | mean wall s | mean prompt tok | mean total tok |
|---|---|---|---|---|---|---|---|---|---|
| gate-off | 5/5 | 1/5 | 2/5 | 2 | 2 | 1 | 47 | 218.5k | 223.3k |
| gate-on | 0/5 | 5/5 | 0/5 | 0 | 0 | 5 | 15 | 117.6k | 119.0k |

"First batch" is every target call issued in the earliest message that carried one. Supplementary metric, added after the first comparison was read; the primary verdict stays "last attempt decides". In the off arm the wrong and right calls were issued in the same model message, so a failure in the first batch means the model dialled the wrong address, not that it corrected itself after seeing a failure.
Tokens are the sum over a run's streamed responses of the usage the upstream reported (prompt includes cached tokens); "—" means no usage chunk was captured for any run in the group.

"seen" means the asset appears at any lifecycle stage of the run — recalled,
injected or fetched. A rejected asset that is never seen was hidden by the gate
before the model could reach it; that is the product filtering, not this report.

## Cost, as measured

| label | runs with usage | mean model calls | mean wall s | mean prompt tok | mean total tok | mean cached tok |
|---|---|---|---|---|---|---|
| gate-off | 5/5 | 6.4 | 47.2 | 218.5k | 223.3k | 185.1k |
| gate-on | 5/5 | 4.2 | 15.4 | 117.6k | 119.0k | 91.4k |

What each run actually spent, as captured (cost.json: the usage chunk of every streamed response, and the wall clock
of the session). Model calls = responses with usage. Tool-call counts are not in cost.json and are not measured here.
This compares the actual spend of the two arms' runs; it is **not** a cost model of the gate mechanism — no run
isolates the gate's own overhead. 这是两组运行的实际开销对比,不是闸门机制的成本模型。

## What else was in context

Recorded per run from the captured system prompt and the service's rows
(`context-confounders.json`). The consumer agent's own injected L3 memory can
prescribe the behaviour a comparison would otherwise credit to the model, and a
skill outside the frozen pool is a source the pool did not account for. Neither
is excluded here; the columns say where they were.

| label | L3 memory block present | L3 carried a watched line | read a skill outside the pool |
|---|---|---|---|
| gate-off | 0/5 | — | 0/5 |
| gate-on | 0/5 | — | 0/5 |

A watched line is one the task's `confounders.watch` names — for bridge-addr,
"probe every documented candidate" and "never get-by-name (cross-agent 404)".
Where both arms carry it, the arms stay comparable with each other; what it takes
away is the reading "the model recovered on its own" for the off arm's second dial.

Baseline frozen 2026-09-10T23:20:45Z. Runs marked (evidence base) fed the baseline's
decisions; runs marked (pre-baseline) predate it. Neither is part of the comparison.
