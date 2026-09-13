# Trustworthy attribution for team assets

Tooling that answers one question with evidence the model cannot fabricate:
**was a team asset actually used, and by whom?**

The system injects team assets (skills, memories, knowledge bases) into an agent's
context, but the trail stops there. Nothing records whether the agent retrieved
the content, whether it influenced the change, or whether the result held up. The
task specification is explicit that retrieval and injection must not be reported
as effective use — and that is precisely the gap this tooling closes.

## Why the obvious approaches fail

**A model's own report is not evidence.** Asked whether it used an asset, a model
produces a plausible, well-formatted answer that is often correct — but its
correctness cannot be established from the answer itself. In the telemetry, an
intent row's `initiated_tool` is just `Bash`: what the model calls "using a team
asset" is, at the observable layer, a request to run a shell command. The asset's
identity only appears once a bridge actually forwards the call.

**Where you tap decides what you can see.** A probe placed between the client and
the proxy captured a system prompt of 15,523 characters with zero asset blocks,
while the proxy's own log showed several blocks injected on every turn. Both were
honest: injection happens *inside* the proxy. Moved between proxy and model, the
same prompt is 27,103 characters with every block present. The misplaced probe
yields data that looks clean and gives no hint that it is wrong.

**Regex over tool-result text gets fooled.** The first version reported all three
asset channels as used when not a single real fetch had occurred. Three distinct
causes, none of them "the pattern was too loose":

1. A tool result echoes the executed command before its output, so scanning the
   whole blob matches the *request*, not the response. A call that timed out after
   75 s with exit code 28 and empty stdout still contained the bridge name.
2. One asset's description happened to discuss the very endpoints being matched.
3. The model grepped this repository, and the result carried the checker's own
   pattern literal — the detector passed because the model searched for the detector.

All three share a shape: *looks related*. The fix is a different judgement
structure, not a stricter pattern.

## What is here

| Directory | Purpose |
|---|---|
| `contracts/` | Three frozen JSON Schemas plus a zero-dependency validator. Everything downstream is written against them. |
| `gate0/` | Observability probe and the two-tier capture verifier that decides whether an asset fetch can be seen at all. |
| `provenance/` | Asset pool snapshot, the join that puts producer and consumer on the same event, and the early lifecycle states. |
| `attribution/` | Discriminative token extraction, artifact collection, and the hard-evidence judge. |
| `tasks/` | The mainline scenario: two assets differing only in the bridge address, and its acceptance check. |
| `runner/` | One command per run, leaving a directory that can be reopened; and the aggregate, where ERROR stays in the denominator. |
| `gate/` | The admission gate: outcomes tied to calls, the three rules, the author signal, and the write into the product's asset `status` in Core (`candidate` / `approved` / `failed`) with read-back. An earlier version of this line said `visibility`; the gate stopped touching that field when it moved into Core. |
| `receipt/` | The receipt task four asks for: what a run used, from whom, in what state, with what evidence and what risk; JSON plus terminal rendering. |
| `calibration/` | Leave-one-out: hide an asset, see whether the run changes, and score the judge's `used` against that — precision and recall with n. |

Nothing under `evaluation/` pulls npm packages; everything runs on Node's standard
library and shell.

## Terms, as used here

Four distinctions this delivery keeps, because collapsing any of them would overstate
the result:

| | |
|---|---|
| **delivered** vs **used** vs **validated** vs **contributed** | delivered = the content reached the model's context; used = a service-side record ties it to a call; validated = a run whose written copy also passed independent acceptance; contributed = a new asset entered the registry. Delivery is not use, and use is not benefit. |
| **asset-outcome profile** vs **a person's ability** | the field is still named `competence` for compatibility with the signed summary in Core, but it is read as a profile of outcomes already recorded **on the asset under assessment**. It is not a verified measure of the author, and the gate uses it for review priority only — never for admit/reject. |
| **this version** vs **earlier batches** | every number names the asset version and the run set it came from. Batch 3 and batch 4 are not pooled, and a report generated before a calibration change is kept with a note saying so rather than edited. |
| **the product's own capability** vs **what this branch adds** | retrieval, injection and the skill bridge are the product's; this branch adds the outcome records, the admission decision in Core, the receipt, and the calibration. Nothing here re-implements retrieval. |

## Two-tier evidence

| Tier | Source | Why it is trusted |
|---|---|---|
| bridge | A `kind='bridge_call'` row written to `tool_call_logs` with a 2xx `upstream_status` | Written by the service itself, never passes through the model, cannot be talked into existence |
| wire | Reconstructed from the capture: results paired back to their calls by `tool_call_id`, the channel decided by the *issued URL*, the outcome read from exit code and stderr | Stronger than text matching, but still reconstructed from model-produced text |

When both are available they cross-check, and disagreement in **either** direction
fails the run: a wire-level success with no bridge row means the judge is wrong; a
bridge row the capture never saw means the tap has a hole.

Checks report `PASS`, `FAIL`, or `n/a`. A check with nothing to run against
reports `n/a`, never `PASS`, and `n/a` blocks progress exactly as firmly as
`FAIL`. **Not knowing is not the same as being fine** — an earlier version of the
verifier reported PASS and declared the schema ready to freeze while two of three
channels were false positives, which was more dangerous than reporting failure.

## The team dimension

Using an asset you wrote yourself is a personal note; a local file would do. What
distinguishes a *team* asset system is someone else's asset helping you, and the
injection cost is paid by every person on every turn. So the headline metric is
not the usage rate but the **cross-person reuse rate**, and every event records
the producer and the consumer together.

That edge cannot be backfilled: asset ownership changes and versions roll forward,
so a lookup after the fact returns a different row than the one that was used.

Two rules guard against quiet misreporting:

- When either identity is missing, `relation` is `unknown` — **never** a default of
  `self`, which would erase genuine cross-person use.
- When nothing is attributable, the summary says "not computable" rather than 0%.
  0% reads as *"we measured, and there was none"*; the truth is *"nothing was
  measured"*.

## Running it

```bash
# Observability: can each asset channel be seen at all?
node --test evaluation/gate0/verify-capture.test.mjs
SINCE="2 HOUR" bash evaluation/gate0/export-tool-call-logs.sh
node evaluation/gate0/verify-capture.mjs <capture.jsonl> <tool-call-logs.jsonl>

# Provenance: who wrote it, who used it
bash evaluation/provenance/snapshot-assets.sh
node evaluation/provenance/build-events.mjs <snapshot.json> <tool-call-logs.jsonl> <capture.jsonl>

# Contract conformance
node evaluation/contracts/validate.mjs \
  evaluation/contracts/provenance-event.schema.json \
  evaluation/provenance/artifacts/provenance-events.jsonl
```

Full suite: 745 tests (`node --test evaluation/**/*.test.mjs` from the repository root). The
acceptance compares this number with what the run actually reports, so it cannot go stale
quietly again — it had, twice.

Each directory has its own README with the details.

## Current status and its limits

Fetches on all three asset channels (skill, memory, knowledge) are decided by
service-side records rather than by anything the model wrote. Three classes of
false positive each have a regression test holding them shut.

What has been measured since Gate 0, and where the numbers live (each report is
generated by a script named at its top; `deliver-check.sh` regenerates them all
and diffs them against the committed copies):

- **Cross-person reuse, batch 4** (`runner/COMPARISON-2026-09-11-reparsed.md`,
  `attribution/CALIBRATION-batch4-reparsed-2026-09-11.md`): ten formal runs, a
  consumer user reading an author user's assets through the product's own
  paths; delivery and use judged against service-side records, calibrated
  against a hidden-asset arm. The gate lives in Core and decided those runs
  from trusted outcome rows.
- **The dev loop** (`tasks/exit-code-fix/REPORT.md`, `tasks/exit-line-collect/REPORT.md`):
  one real defect, one experience note, fresh consumers, an independent
  verifier, write-back through `/v3/skill/extract`, and the gate's rule
  admitting the note on cross-user validated outcomes. What the evidence
  supports, stated exactly: **the note's testing convention was adopted and the
  resulting code passed independent acceptance**. It does not separately show
  that the root-cause diagnosis came from the note, and it does not show the
  defect would have gone unfixed without it.
- **The dev loop, a different kind of work** (`tasks/resource-download/REPORT.md`):
  adding a tool rather than fixing one, judged by behaviour rather than by a
  marker — the reference test asserts zero bytes for an empty resource, the
  error envelope surfacing, and the request going to `files/download`, a
  subpath the injected tool list never names. On this branch's samples the
  no-note arm is 0/4, every run failing that one assertion, and the note arm
  4/4. Said with it, not after it: every use event is `needs_review`, because
  the consumers fetched the note by calling the skill bridge themselves rather
  than through the credited fetch; the working copy also carried this
  repository's own upstream PR write-up, which states in prose that
  `files/download` returns raw bytes — both arms had it, six of eight runs read
  it, two no-note runs read it and still failed; and the first no-note batch of
  sixteen was voided because the implementer had left the reference
  implementation on disk, which the runner now checks for and would refuse.
- **The author dimension** (`author/README.md`): a context-based assessment
  read from the author's own records, cited and machine-checked, used by the
  gate for review priority only.

Limitations, stated rather than buried:

- **The knowledge channel's pass depended on a human supplying the asset id in the
  prompt** (Gate 0). The `<knowledge_tools>` block never reached the system prompt,
  because the injector requires an asset bound in metadata and marked ready, while
  the test wiki was a draft. So the channel is proven *observable*, not
  *discoverable by the model*. Those are different claims.
- **Cross-person means two user ids, not two people.** Every evaluation identity
  is operated by the same person; `relation: cross_user` and the gate's
  `distinct_consumers` count identities. Independence is not established and no
  report claims it.
- Samples are small (5+5, 2+2), one scenario per batch, one model.

Since 2026-09-12 the delivery also carries, each with its own record:

- **six rounds of outside review**, every finding fixed in the implementation or the
  generator and the report regenerated rather than hand-edited (`STATE.md`, and one card
  per class in `REVIEW-GUIDE.md`);
- **four upstream pull requests** opened from defects hit while running the product, on
  branches independent of this one and all still pending review with no automated checks
  (`upstream/README.md` — it also records one reproduced defect deliberately **not**
  submitted, because that project's CONTRIBUTING routes such reports to private email);
- **a port of the gate onto today's upstream** (`gate/PORT-TO-UPSTREAM.md`; branch
  `gate-core-minimal`, commit `c372d80`, based on `feat/server_team@0468a2a`): this
  branch differs from upstream in 3675 files, and the gate is 21 of them; four conflicts,
  all of them import lists; a tree with no `evaluation/` in it that builds and passes
  132 tests; and `typecheck:metadata`, compared after normalising away line numbers and
  the absolute paths TypeScript embeds in some messages, adds nothing in `src/metadata`,
  where the gate lives (11 → 6), and two in the tree as a whole (123 → 118) — the same
  two undefined names upstream reports as TS2304, restated as TS2552 with a "did you
  mean" suggestion. Raw outputs and the comparison are in `gate/artifacts/port-*`, and
  the baseline is pinned at `0468a2a...c372d80` rather than a moving "latest upstream".
  The four merge conflicts were textual, all of them import lists; behaviour
  compatibility after deployment is **not** verified, so this supports "the port is
  feasible", not "ready to merge upstream or to run in production". It is the direct
  answer to "the gate has to live in Core": product code, not a harness.

A configuration note worth recording: the knowledge service ships its own
ClickHouse telemetry writing the *same* `tool_call_logs` table, tagged
`source_tag='knowledge'`. It is off by default and the deploy script did not
forward its settings, so early runs found no rows and nearly concluded none could
exist. **Bypassing the proxy's bridge is not the same as having no telemetry.**
