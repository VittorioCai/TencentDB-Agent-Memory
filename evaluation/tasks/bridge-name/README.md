# Extension pair 1 — `bridge-name`: a failure-experience note, a service-error failure class

**Status (2026-09-07): scaffolding in place — `enter-pool.sh`, `verify.mjs` (+ tests), `confounders.watch`; the runner takes `--task evaluation/tasks/bridge-name`. Nothing is in the pool until `enter-pool.sh` is run. The `service_refused` rule below is still listed for approval; until it is approved, a wrong-note run's failed `get` is `needs_review`, not `corrected` — the frozen rule's stated limit, reported as such.**

The mainline pair (`bridge-addr`) is one asset type (skill as convention), one
token shape (an address), one failure class (reachability). This pair changes
all three, and the author.

| | mainline `bridge-addr` | this pair `bridge-name` |
|---|---|---|
| asset category (topic taxonomy) | Skill (team convention) | **failure experience** (`category: failure_experience` declared in frontmatter) |
| author | A (`usr-n68ea5ythq`) | **C** (`usr-8ypylzex49`, `agt-8ypy4vhft9`) — second author, so the author prior has real outcomes from another author |
| consumer | B | B |
| what the asset carries | the bridge's host:port | the **skill id** of a checklist skill |
| the model's call | `skill/search` at that address | `skill/get` with that id, `include_content: true` |
| failure class when wrong | connect timeout (reachability) | **service error**: the bridge answers 403 `not_visible` / core answers 40401 `SKILL_NOT_FOUND` — the request reached the service and was refused on its content |
| independent confirmation | TCP probe from the harness | **harness replays the `get` through core with the consumer's key**; not-found reproduces or it does not |

## Why the pointer is a skill id, not a name

The token screen (`extract-tokens.mjs`) treats every pool asset's **name**,
description and content as text the model may already have seen. A note that
says "the checklist is named `team-deploy-checklist`" carries a token that is
also the checklist's own name, and the screen rightly refuses it. A skill id
(`skl-…`) is opaque, appears in no asset's name or description, and is exactly
what the product's `get` endpoint takes. It is also what a real failure note
would record after a lookup by name went wrong.

## Why the checklist must not match the task's keywords

If the model's `skill/search` for "deploy checklist" returned the checklist
itself, the checklist's listing entry would carry its own id — and that entry
would reach the model before the note's body. The judge would then (rightly)
refuse to credit the note: the id was delivered first by *another asset's*
listing entry. So the checklist's name, description and body avoid the task's
words; it can only be reached by the id the notes carry. That is not a trick
against the model — it is the situation a failure note exists for.

## Assets (drafts in `assets/`, placeholders filled by `enter-pool.sh`)

1. **`tdc-{{SUFFIX}}`** — the checklist itself (author C, category not
   declared → the receipt will say `skill`). Opaque name, plain body with a
   marker line `checklist-marker: qz7-{{SUFFIX}}`. Its skill id is the value
   the notes point at; `enter-pool.sh` creates it first and substitutes the id
   into the notes.
2. **`deploy-lookup-note-a`** (author C, `category: failure_experience`) — the
   **wrong** note: records the lesson correctly ("lookup by keyword found
   nothing; fetch by id") but carries a fabricated id `skl-{{WRONG_ID}}` that
   no skill has.
3. **`deploy-lookup-note-b`** (author C, `category: failure_experience`) — the
   **right** note: same lesson, the checklist's real id.

Both notes are word-for-word identical except the id. Discriminative tokens:
the two ids. The task text names neither.

## Task (`task.md`)

> The team keeps a deploy checklist as a skill in the skill bridge, but it is
> not findable by keyword — a teammate left failure notes about that. Using
> the team's notes, fetch the checklist through the bridge (`skill/get` with
> `include_content: true`) and report the value on its `checklist-marker`
> line. Send the request with the task marker `team-checklist-lookup` in the
> `x-eval-task` header so the acceptance can tell it from discovery calls.

## Acceptance (`verify.mjs`, same shape as the mainline's)

- attempts = `skill/get` calls carrying the task marker; each attempt's
  **value** is the `skill_id` in its body (the analogue of host:port)
- an attempt succeeds when the envelope is code 0 **and** the content carries
  `checklist-marker: qz7-…`; it fails on 403 / 40401 / any non-zero code;
  timeouts and connection failures are environmental, not content
- verdict: last attempt decides, as in the mainline; first-batch reported as
  the supplementary metric with the same caveat

## Outcome judge, generalised (rule change — listed for approval)

`judge-outcome` currently knows one content-explained failure class
(reachability at the asset's address). This pair needs a second:

- **service_refused**: the call reached the service and was refused on the
  value the asset supplied (403 `not_visible`, 404xx not-found, 400 invalid
  parameter), **and** the asset's token is the refused value (the attempt's
  `value`), **and** the harness replays the same request through core with the
  consumer's key and gets the same refusal.

Everything else stays: another attempt with the same value succeeding in the
run contradicts it; no probe on record leaves it unconfirmed; a probe that
succeeds makes it environmental. The reachability class is unchanged.

The probe generalises from `probe-reachability.mjs` to `probe-attempts.mjs`:
per attempt, a strategy by endpoint — TCP connect for address attempts, a
core `skill/get` replay for id attempts — each recorded with time, source and
the exact request replayed.

## Runs (batch `ext1`, all under the rules frozen at the commit named in the baseline)

| step | runs | purpose |
|---|---|---|
| preparation | 2 | evidence base: outcomes for both notes, then freeze `gate_baseline` for this pair |
| gate off | 5 | both notes visible |
| gate on | 5 | wrong note hidden by the gate's decision |
| ablation | 4 | right note hidden — does the model still reach the checklist? (it should not) |

≈16 runs. Expected: off arm dials the wrong id in some runs (service refusal,
corrected), on arm never sees it; ablation fails 4/4. If the model finds the
checklist some other way with the right note hidden, that is a leak and the
pair is reported as such.

## What this pair does not do

It is still one operator, and the consumer is still B. It adds an asset
category, a failure class, an author and a second task id; it does not add a
human.
