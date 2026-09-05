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

## Before the first run

Three things must be true, and two fail silently — the run finishes, the files
are written, and what they contain is empty or wrong:

1. **The probe must be running and the proxy must route through it.** The
   proxy's upstream points straight at the model by default, so nothing is
   captured. Where the probe sits matters too: between client and proxy it
   recorded a system prompt with zero asset blocks while the proxy's own log
   showed several injected on every turn. Both readings were honest — injection
   happens inside the proxy, so the probe goes above it.
2. **`debugForceIdentity` overrides the request headers.** Switching the API key
   is not enough: the injector lists skills for the *forced* agent, so an
   injector probe run as the author while the config still forces the consumer
   sees the consumer's empty block — and the result reads as "the injector path
   produced nothing" when it was never asked.
3. The candidate log and the scenario port must be on.

`prepare.sh` does all three:

```bash
bash evaluation/runner/prepare.sh --identity b   # mainline, consumer
bash evaluation/runner/prepare.sh --identity a   # injector probe, author
bash evaluation/runner/prepare.sh --status
bash evaluation/runner/prepare.sh --teardown     # probe off, upstream restored
```

Then run the task. Two ways:

- `run-once.sh --auto` launches the task itself in a brand-new single-prompt
  CodeBuddy process. Prefer this — the session is guaranteed fresh.
- Without `--auto`, run-once waits for you to run the task in a CodeBuddy session
  and press enter. That session **must be brand new**: `enable` and `prepare`
  recreate the proxy, and a session opened before that is rejected before the
  probe (which sits upstream of the proxy) sees anything — an empty capture that
  looks like the model did nothing. The skill listing also runs once at session
  init, so an already-open session records no candidates either.

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

## The capture is cleared per run

The probe appends. Without clearing, run N's capture contains runs 1..N, and
every count, cost figure and attribution in that run would be about a mixture of
sessions. `run-once.sh` truncates it before the session and keeps whatever was
there as `capture-before.jsonl` rather than deleting it.

An empty capture afterwards is a hard error, not an empty result: it means the
probe saw no traffic, which is a fact about the wiring and not about the run.
