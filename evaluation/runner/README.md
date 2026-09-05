# Runner

One command per run. What it produces is not a verdict but a **directory that
can be reopened**:

| File | What it is |
|---|---|
| `capture.jsonl` | the raw bytes between proxy and model |
| `tool-call-logs.jsonl` | the service's own records for the window |
| `candidate-log.jsonl` | the injector's candidate set, when enabled |
| `events.jsonl` | provenance events built from the above |
| `early-events.jsonl` | recalled / selected / injected |
| `run-artifacts.json` | the ordered operations, calls paired with results |
| `verdict.json` | the acceptance result and its reason |
| `used-events.jsonl` | the hard-evidence judgement |
| `cost.json` | turns, wall time, system prompt size, tokens |
| `run.json` | the manifest tying them together |

Raw inputs are kept from the **first** run, not once the pipeline looks
finished. A run whose capture was not saved cannot be re-judged when the judge
changes, and the judge is going to change — it has changed four times already.

```bash
bash evaluation/runner/run-once.sh --label gate-off
bash evaluation/runner/run-once.sh --label gate-on
node evaluation/runner/summarize-runs.mjs evaluation/runner/runs
```

Exit codes match `verify.mjs`: **0 PASS · 1 FAIL · 2 ERROR**.

## ERROR is not FAIL, and it stays in the denominator

A run where the task was never attempted, or where the outcome could not be
read, says something about the harness rather than about the asset. That is why
it is reported on its own line.

It is also why it stays in the total. Six runs, four broken, two passed, is
33% — reporting it as 100% over "judged runs" is how a collection failure turns
into a good-looking result. `summarize-runs.mjs` prints the rate over runs
**started**, names every unjudgeable run, and shows what the number *would* have
read over judged runs alone so the gap is visible rather than available.

## Two ordering choices

**Acceptance runs before attribution, and independently of it.** Whether the
task succeeded is a fact about the run; whether an asset helped is a judgement
about that fact. Letting the second decide the first is how a scenario starts
grading itself.

**Shared artifact paths are cleared first.** The stages write to fixed paths
under `artifacts/` and the run copies from there, so without clearing, a stage
that fails leaves the previous run's file in place and it gets copied in — a
step that could not run producing output that looks like it did, which is the
failure this whole tree exists to prevent.
