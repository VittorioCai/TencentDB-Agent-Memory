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
| frozen at | `2026-09-05T10:14:40Z`, 2 assets |
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
