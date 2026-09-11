# Runs

| label | started | pass | fail | unjudgeable | endpoint success rate |
|---|---|---|---|---|---|
| gate-off | 3 | 0 | 0 | 3 | 0% |
| gate-on | 5 | 5 | 0 | 0 | 100% |

PASS means the run's last acceptance attempt against the bridge returned code 0.
The task text counts an accurately reported failure as a completed task, so this
column is the **endpoint request success rate**, not a task completion rate;
a run that reports a timeout truthfully is FAIL here and complete by the task's own words.

The rate is over runs **started**. Unjudgeable runs stay in it:
  - gate-off: 3 of 3 could not be judged; over judged runs alone it would read —
      20260910T232424Z-gate-off
      20260910T232522Z-gate-off
      20260910T232730Z-gate-off
Reporting the second number without the first would let a harness that broke
four times out of six read as a clean result.

## Where the gate shows

The acceptance lets the last attempt decide, so a run that dials the wrong
address, times out, and then dials the right one still passes. The gate's
effect is in the columns below, not in the pass rate.

| label | rejected asset seen (skl-sZFb3KatWY6m) | first batch all ok | first batch had a failure | failed attempts | corrected | validated | mean wall s | mean prompt tok | mean total tok |
|---|---|---|---|---|---|---|---|---|---|
| gate-off | 3/3 | 0/3 | 2/3 | 2 | 2 | 0 | 46 | 160.9k | 164.3k |
| gate-on | 0/5 | 5/5 | 0/5 | 0 | 0 | 5 | 15 | 117.6k | 119.0k |

"First batch" is every target call issued in the earliest message that carried one. Supplementary metric, added after the first comparison was read; the primary verdict stays "last attempt decides". In the off arm the wrong and right calls were issued in the same model message, so a failure in the first batch means the model dialled the wrong address, not that it corrected itself after seeing a failure.
Tokens are the sum over a run's streamed responses of the usage the upstream reported (prompt includes cached tokens); "—" means no usage chunk was captured for any run in the group.

"seen" means the asset appears at any lifecycle stage of the run — recalled,
injected or fetched. A rejected asset that is never seen was hidden by the gate
before the model could reach it; that is the product filtering, not this report.

## What else was in context

Recorded per run from the captured system prompt and the service's rows
(`context-confounders.json`). The consumer agent's own injected L3 memory can
prescribe the behaviour a comparison would otherwise credit to the model, and a
skill outside the frozen pool is a source the pool did not account for. Neither
is excluded here; the columns say where they were.

| label | L3 memory block present | L3 carried a watched line | read a skill outside the pool |
|---|---|---|---|
| gate-off | 0/3 | — | 0/3 |
| gate-on | 0/5 | — | 0/5 |

A watched line is one the task's `confounders.watch` names — for bridge-addr,
"probe every documented candidate" and "never get-by-name (cross-agent 404)".
Where both arms carry it, the arms stay comparable with each other; what it takes
away is the reading "the model recovered on its own" for the off arm's second dial.

Baseline frozen 2026-09-10T23:20:45Z. Runs marked (evidence base) fed the baseline's
decisions; runs marked (pre-baseline) predate it. Neither is part of the comparison.
