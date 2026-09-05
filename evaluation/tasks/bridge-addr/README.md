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

## Status

Offline drafts. Not in any pool. Entering the pool requires, in order:

1. candidate-pool isolation verified (identity B cannot reach the old team's assets) — **done**
2. the bridge gate verified end to end (P3-3a) — **done**
3. each asset carries a discriminative token (P1-3) — **done**
4. pool entry and freeze (P4-1b)
