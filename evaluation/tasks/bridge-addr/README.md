# Scenario: which bridge address did the model actually follow?

Two skills that differ in exactly one thing — the host in the bridge URL. One is
unreachable from where the model runs; the other works. Whichever address shows
up in the model's own curl argument tells you which asset it followed, and the
call's outcome tells you whether that asset helped or hurt.

Drawn from a real incident in this project: the injected bridge address pointed
at a container-internal IP the host could not reach, every call hung for 75
seconds, and three people rediscovered it independently over ten days while the
system produced no signal at all.

## The two assets

| File | Address | Role |
|---|---|---|
| `assets/wrong.md` | `10.244.7.19:8096` | unreachable; stands in for the polluted asset |
| `assets/right.md` | `127.0.0.1:47318` | reachable; the corrected version |

They are byte-identical apart from the `name` field and that one address. That
is deliberate: if they differed in wording, length or structure, a hit could be
explained by something other than the address, and the attribution would have a
second reading.

## Three choices worth recording

**The wrong address is not the historical `172.21.0.4`.** Existing assets in the
current pool already discuss that value — one of them explains which address is
correct — so reusing it would both break token uniqueness and leak the answer.
`10.244.7.19` is in private space, is not routable from the host, and appears
nowhere in the pool.

**Neither file names the product or the incident.** The description reads as an
ordinary team convention. An asset that announced itself as a test would change
how the model treats it.

**The right address is not `127.0.0.1:8096`, and that was a correction.** The
first draft used it, and the token extractor rejected it: the literal string
`http://127.0.0.1:8096/skill-bridge/v3/skill/search` appears in the
`<skill_tools>` block injected into **every** session, twelve occurrences of
`127.0.0.1` in one captured system prompt. A model would write that address
having read nothing at all.

The consequence was one-directional attribution. `10.244.7.19` in the work
proves the wrong asset was followed; `127.0.0.1` proves nothing — so "the gate
worked and the model used the right asset" was exactly the claim that could not
be made, and it is the claim the on/off comparison rests on.

The fix is an arbitrary port. `47318` appears nowhere in the pool, nowhere in
the system prompt, and is not a value anyone writes by convention. It reaches
the same bridge because `evaluation/eval-proxy.sh` publishes it as a second
port on the proxy container — verified beforehand that the proxy does not route
on the `Host` header, so no application change was needed. Both addresses now
carry exactly one discriminative token each:

```
wrong.md   10.244.7.19   ipv4
right.md   47318         port
```

Uniqueness against the *evaluation* pool is still checked after that pool is
created and frozen; this establishes uniqueness against the system prompt and
against each other, which is what the earlier draft got wrong.

## Checking them

```bash
node evaluation/attribution/extract-tokens.mjs \
  evaluation/tasks/bridge-addr/assets/wrong.md \
  evaluation/tasks/bridge-addr/assets/right.md \
  --capture=evaluation/gate0/artifacts/gate0-threechannel-capture.jsonl \
  --pool=evaluation/provenance/artifacts/asset-pool-snapshot.json \
  --contains=evaluation/tasks/bridge-addr/task.md
```

Exit status is 1 if either asset has no discriminative token, or if the task
description leaks one.

## Status: in the pool, frozen

| | |
|---|---|
| team | `team-5ezfoladb5` — created for this, holding these two assets and nothing else |
| author | `agt-5e4hna56j9` / `usr-n68ea5ythq` |
| consumer | `agt-5e0y4l8a7a` / `usr-4u07qc2kuj` |
| frozen at | `2026-09-05T15:07:26Z`, 2 assets at v2 |
| ids | `pair.json` |

All four prerequisites cleared: candidate-pool isolation, the bridge gate
(P3-3a), a discriminative token per asset (P1-3), and pool entry itself.

### Two silent failures the entry script now checks for

**Both assets landed `private`.** `/v3/skill/*` authenticates on the Bearer
token and `/v3/meta/*` on `x-tdai-user-key`; sending only the first got a 401
on the visibility call, which the first version of the script reported as a
warning and carried on. A consumer cannot see a private asset, so the scenario
would have produced a clean, confident, empty result. Reading the visibility
back is now a hard failure, not a warning.

**The skill row said the author was `default`.** `user_id` is optional on
`/v3/skill/create`, and omitting it stores `default` on the skill row while the
asset row records the real owner. Nothing in the output looks wrong — and
`default` still compares as different from the consumer, so the run would still
have reported `cross_user`. It would just have been about nobody. The script
now passes `user_id`, resolves it from the agent record rather than a constant,
and fails if the snapshot and the asset record disagree about who wrote it.

Both are the same shape: a check that cannot run reports success.

## Acceptance

```bash
node evaluation/tasks/bridge-addr/verify.mjs <capture.jsonl…>
# exit 0 PASS · 1 FAIL · 2 ERROR
```

**The last attempt at the target decides, and no attempt at all is not a
verdict.** Four outcomes, each because an obvious rule gets it wrong:

| Situation | Verdict | The rule that fails |
|---|---|---|
| prerequisite read succeeded, target timed out | FAIL | *"some call returned 200"* — the 200 was the model fetching the asset that told it the address |
| target succeeded early, failed at the end | FAIL | *"it succeeded at some point"* |
| target failed first, succeeded last | PASS | *"it never failed"* — retrying after an error is ordinary behaviour, and punishing it measures neatness |
| never attempted, or the outcome is unreadable | ERROR, exit 2 | *"no success, so it failed"* — a run that never tried is not a run that tried and failed, and collapsing them turns a broken harness into evidence about the asset |

### What counts as the task's request

The target is a search **carrying the task marker** `team-bridge-reachability`,
not any `skill/search`. Two things forced that:

Reading the asset that documents the address is itself a bridge call, so
matching on the URL alone makes *"the model read the instructions"*
indistinguishable from *"the model followed them"*.

And the task's **first step is a search** — for the asset. Matching on the
action alone therefore scores discovery as execution: the search succeeds,
reading the guidance asset fails, the address is never used, and the run passes.

Both assets specify the same marker, so it says *this is the task request*
without saying which asset was followed — the host and port say that. It is in
neither the task description nor the system prompt, so a run that read no asset
cannot produce it, and that run has not done the task.

### Attempts come from the calls, not the results

An attempt whose result was never captured is invisible if you walk results. A
run that succeeded once and then fired at the wrong address, with that last
result missing, scored a clean PASS on the earlier success. The list is built
from the tool calls and results are attached by `call_id`; an attempt with no
result is `ok: null`, and if it is the last one the verdict is ERROR.

A missing result **in the middle** is a collection gap, not a failure — only the
last attempt decides.

Within one attempt three signals are read separately, because they disagree
often enough to matter: the exit code, the HTTP status, and the envelope's own
`code`. A 200 carrying `{"code":40101}` is a refusal that curl calls success.
And an unreadable outcome is neither pass nor fail — it is reported as unreadable.

## v3 (2026-09-09/10): the discriminative token is a trace header, and batch 4's conditions are frozen

The address stopped being the discriminative token. It is a property of the
deployment — in the proxy config, listened on, findable from a shell — so a
model writing `47318` had not necessarily read anything. Each asset now also
records an `x-team-trace` value and says it must be sent verbatim; following
the asset therefore leaves that value in the command, which is the guarantee
"used ⇒ this token appears" needs and no string property can give.

| asset | role | v3 trace value |
|---|---|---|
| `skl-sZFb3KatWY6m` | wrong | `bt-7c4wgsmdac` |
| `skl-oBaDO5CceKnr` | right | `bt-yf39kfehc5` |

Both values were checked against every source before being written in: the
task directory, the memory baseline, CodeBuddy's project cache, every captured
run — 283 sources, no hit, no unscanned gap. `tokens.json` here declares
`adoption_fields: ["value"]`; `verify.mjs` records the value on each attempt
and **does not** use it for PASS/FAIL.

The version bump was itself a measurement: after `/v3/skill/update` both
assets returned to `candidate` / `pending` with confidence cleared — the gate
does not inherit a decision across versions.

**Batch 4 runs under a frozen condition list**, produced and checked by the
same code:

```bash
node evaluation/runner/batch-conditions.mjs --freeze --batch=4 --consumer=agt-eiwlwrb0me
node evaluation/runner/batch-conditions.mjs --check  --conditions=evaluation/gate/artifacts/batch4-conditions.json
```

The list is everything the two arms must share — assets, versions, content
hashes, tokens, consumer, proxy identity and config hash, memory baseline
(consumer-scoped), analysis file hashes, rules version — and the only variable
allowed to differ (`gate`). It also records the session policy: each run now
starts in a fresh empty directory, never in the repository, because earlier
sessions ran with the repository as their working directory and CodeBuddy
caches tool results per working directory. Trial checkpoints are listed in the
file; PASS/FAIL is not one of them.

The consumer for this batch is `agt-eiwlwrb0me`, a second agent of the same
user, created with no memory profile so the baseline is empty by construction
rather than by cleaning.

### Trial checkpoints and report grouping (2026-09-10)

Before the real batch, a trial pair (one off, one on) must clear the checkpoints
— and PASS/FAIL of the task is not one of them:

```bash
node evaluation/runner/batch-conditions.mjs --trial <run dir> --conditions=evaluation/gate/artifacts/batch4-conditions.json
```

Eleven checks in four groups: condition consistency (tokens, rules, arm,
start status), isolation (consumer identity, start baseline, rollback by the
post-restore hash, session cwd not the repo), capture completeness
(`verifyCoverage`), and actual adoption (target attempts exist, every attempt
carries a trace value, adoption is decidable for each asset).

The calibration report groups by `(rules_version, experiment)` with older
batches on their own rows, so batch 4 never merges into batch 3's numbers under
the shared rules version. `cumulative` spans rule sets and experiments and
verifies nothing on its own.
