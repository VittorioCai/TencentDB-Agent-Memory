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
| `assets/right.md` | `127.0.0.1:8096` | reachable; the corrected version |

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

**Token uniqueness is not yet verified.** Constraint (c) requires that neither
address appears in any other asset in the candidate pool, and the current pool
contains both `127.0.0.1:8096` and `172.21.0.4`. Verification happens after the
evaluation team is created and frozen, against that pool — not against this one.

## Status

Offline drafts. Not in any pool. Entering the pool requires, in order:

1. candidate-pool isolation verified (identity B cannot reach the old team's assets)
2. the bridge gate verified end to end (P3-3a)
3. pool entry and freeze (P4-1b)
