# Attribution

Deciding whether an asset was *used*, as opposed to offered, retrieved, or
merely present.

## Discriminative tokens

`extract-tokens.mjs` finds the strings in an asset whose appearance in the work
has no explanation other than that asset. Two filters, and the order matters
because only the second one holds.

**Derivability** is a prior on the token's shape. `127.0.0.1` is the address
every developer types from memory; `10.244.7.19` is not. Ports below 1024 are
assigned and guessable; `47318` is not. A hyphenated string made entirely of
common words (`built-in`, `read-only`) is prose; `eval-bridge-endpoint-a` is a
name. These heuristics can only reject, never promote, and the word list behind
the last one is necessarily incomplete.

**Screening** asks whether the token is already somewhere the model can see:

| Corpus | Why it matters |
|---|---|
| other assets in the candidate pool | constraint (c) — a shared token cannot say which asset was read |
| the task description | a task that names the answer makes every later judgement circular |
| files as they stood before the change | the token may have been in the repository already |
| **the injected system prompt** | the one that is easy to forget, and it decided the scenario |
| the asset's own name and description | listed to the model without the body ever being fetched |

The last two deserve their own note.

The system prompt matters because the injected `<skill_tools>` block on this
deployment contains the literal string
`http://127.0.0.1:8096/skill-bridge/v3/skill/search`. An asset documenting that
endpoint has nothing to distinguish it — the answer is in every session already.
Screening against the pool alone would have called that token unique, and the
mainline scenario's "the model used the right asset" claim would have rested on
it. It was caught here and the scenario was changed.

The asset's own name matters because the name is what `<available_skills>` and a
`skill/search` response show. A model that writes the skill name has
demonstrated **recall**, not use, and a name must never be able to promote an
event to `used`.

A token surviving both filters is *discriminative*, and only those may support a
`used` judgement.

## Recomputing from a clean clone (2026-09-12)

The reports are recomputed from the committed records (`evaluation/runner/runs/`, batch 4 and both dev-loop
tasks) by `bash evaluation/deliver-check.sh`. The analysis needs each discriminative value in plaintext, and the
design keeps plaintext only in Core (`resolve-tokens.mjs`, pinned by version, content hash and sha256). A clean
clone has no author key and no Core, so `resolve-tokens.mjs` has an **offline route** for values that are already
**burned** — their plaintext is in the committed records (the captures, verdicts and receipts of the runs that
used them), and the rule retires such a value for good.

`burned-tokens.json` is that registry; `build-burned-registry.mjs` writes it from Core and refuses any value it
cannot find in the committed tree with `git grep`.

**What it adds, stated plainly.** Not new plaintext: every value in it is already in the committed tree. What it
adds is the **value → asset version** mapping. `tokens.json` carries only sha256, so a reader who greps the
records gets a pile of strings without knowing which asset version each one belongs to; that mapping exists
nowhere else. It is opened only for burned values, which are retired by rule and never reused — but it is a real
addition, not nothing.

**Retention.** The registry holds the delivered batch's entries only. Before a new batch, entries the delivery no
longer references are archived out (`--archive=<file outside the repo>`); the builder refuses to write while
stale entries are present, so the file cannot grow into a catalogue of every historical value. Rule and origin:
`CLAUDE.md` §16.

Offline, a value is accepted only when its version equals the pinned one and its sha256 set equals the frozen
`token_sha256`; the content hash is stated as not verified. With a key present the registry is never consulted.
`TOKENS_OFFLINE=1` forces the route; a missing key file selects it. What each delivery step needs — nothing, the
registry, or the live stack — is listed in `evaluation/REVIEW-GUIDE.md`.

## Usage

```bash
node evaluation/attribution/extract-tokens.mjs <asset.md> [asset2.md ...] \
  [--pool=<snapshot.json>] [--capture=<capture.jsonl>] \
  [--context=<file>] [--task=<file>] [--contains=<file>] [--json]
```

Every asset given on the command line screens against every other one, because
constraint (c) is about the pool as it will be, not as it was.

Exit status is 1 when an asset has no discriminative token, or when a
`--contains` file carries one. Both are conditions under which the scenario
cannot support an attribution claim, so they fail rather than warn.

## Artifacts: where a token could land

`collect-artifacts.mjs` turns a capture into an ordered list of **operations** —
the places a token could appear. A token found "somewhere in the run" cannot
support a claim; a token found in *this tool call, at this point, with this
result* can. So every operation carries three things:

| | |
|---|---|
| `seq` + `occurred_at` | where it sits in the run. Ordering is what separates influence from coincidence: the content has to have arrived *before* the operation, not merely in the same session. |
| `call_id` | which result belongs to which call. The command says what was asked for, the output says what came back; they answer different questions and must stay attached. |
| `locus` | where to look to see it again — `request(id):msg[n]:call_id:arguments`, or `diff:file:start-end`. Evidence that cannot be reopened is an assertion. |

Messages accumulate across turns, so a call is recorded once, at the turn it
first appeared. `occurred_at` is that turn's timestamp.

A diff hunk is marked `ordering: "end_of_run"` with a null time. A diff is what
a run left behind, not an event inside it, and claiming a timestamp it does not
have would be precision the artifact cannot support.

## The judgement

`judge-hard.mjs` makes one narrow claim:

> this asset, **at this version**, had its **content** pulled into the session at
> time T, and a token that could only have come from it appears in an operation
> the model performed **after** T.

Every clause does work.

**At this version.** A fetch of v2 says nothing about v3. Matching on asset id
alone attributes a run to whichever revision happens to be current.

**Content, not offer — and delivery is a property of the response, not of the
endpoint.** `<available_skills>` and a `skill/search` response carry names and
descriptions; the body arrives only through a call that asked for it. But an
endpoint allow-list is not enough either: `get` with `include_content:false`
returns id, name and version, and `update` returns a metadata summary. Both name
the asset, neither is an enumeration, and neither delivers a line of content.

So the response itself is inspected, and the event records `content_delivered`
— true when a non-empty body came back, false when it was inspected and did
not, **null when the response was never captured**. Null is unknown, and unknown
promotes nothing. The version is read from the same place for the same reason:
the response states which revision it returned, and the pool snapshot is not
entitled to say.

The judge still does not trust the `fetched` label — it re-checks the endpoint,
the delivery flag and the entry position itself. A stage that trusts a label
inherits every mistake made above it.

**After T, strictly — and measured by position, not by clock.** A model can emit
several tool calls in one assistant message. They share a timestamp, and the
second was written before the first one's result existed, so comparing times
reads *"content arrived 10:01, call stamped 10:01"* as influence when the model
had seen nothing. Ordering compares the index of the message carrying the
**response** against the index of the message carrying the **call**. Both calls
sit at the same index, so neither is after the other. The recorded session has
exactly this shape: its first two operations are both at `msg[2]`.

A diff hunk has no position, so it can never promote on its own. "After
everything in the run" does not show the asset was read first — a run that
edited the file and then read the asset leaves exactly the same diff. The edit
operation carries a position; that is what gets judged.

**An operation the model performed.** Matching runs against what the model
*wrote* — tool call arguments, diff hunks, test commands — and never against
what came back. This is also what closes the command-echo false positive
structurally rather than by pattern: the echo lives in the result, and the
result is not searched.

| Outcome | When |
|---|---|
| `used` (`evidence_tier: hard`) | token matched, and a delivery **of the revision the token came from** preceded it in message order |
| `needs_review` | token matched, but nothing establishes the content arrived first |
| *(no event)* | a fetch with no token hit stays `fetched` |

That last row matters. An asset that was read and ignored is a real outcome —
arguably the one a team asset system most needs to see — so it is reported in
the summary rather than promoted or dropped.

Three specific guards, one per false positive the earlier verifier fell for:
the result is never searched (command echo); a token in returned content is not
a token in an argument (an asset discussing the endpoints); and a token inside a
`grep` / `rg` / `find` command is downgraded to `needs_review`, because writing
a token into a search is looking for it, not using it.

Constraints (a) and (b) are re-checked per run: the task description and the
files as they stood are properties of the run, not of the asset, so screening
them at extraction time is not enough.

## The chain

```bash
node evaluation/attribution/extract-tokens.mjs <assets…> \
  --pool=<snapshot.json> --capture=<capture.jsonl> \
  --out=evaluation/attribution/artifacts/tokens.json

node evaluation/attribution/collect-artifacts.mjs <capture.jsonl…> \
  --task=<task.md> [--diff=<f>] [--pre=<path>=<file>]

node evaluation/attribution/judge-hard.mjs \
  evaluation/provenance/artifacts/provenance-events.jsonl \
  evaluation/attribution/artifacts/run-artifacts.json \
  evaluation/attribution/artifacts/tokens.json
```

## Tokens carry their revision

`--out` writes `{ assetId: { version, tokens[] } }`, and the judge will only
credit a delivery of that same revision.

Without it the judge falls back to the most recent fetch, and a run that reads
v1, then reads v2, then uses a token that exists only in v1 gets attributed to
v2. The flat `{ assetId: [tokens] }` shape is still accepted and treated as
version-less — which means it can never reach `used`, because there is no
revision to match. That is the intended outcome rather than a limitation: an
unattributable token should stay unattributed.

The chain the version travels down is: **response → `fetched` → the token set of
that revision → the `used` event's parent.** Any break in it leaves the event at
`needs_review` rather than guessing.

## One response, one event

Provenance events are emitted per **response**, not summarised per asset per
session. Version, delivery, entry position and the evidence reference all come
from the same response, and an asset read twice produces two events.

Summarising was how a record got assembled from three different calls: a first
`get` with `include_content:false` supplying the version, a second `get` of a
different revision supplying the delivery flag and the entry position, and the
first call id supplying the reference. Each field passed its own check. The
record as a whole described a retrieval nobody had made, and it validated
against the contract — **a schema constrains fields, not their provenance**.

Each response is paired with the service-side row for its own request, matched
on the request payload rather than on arrival order. Order only holds when
nothing was dropped, and a dropped row is exactly the case where the pairing
matters.

`chain.test.mjs` runs captured bytes through `buildEvents → collectArtifacts →
judge` and asserts on the final verdict. The unit tests either side of it feed
the judge events built by hand, so they check its rules but never the events it
will actually receive — and that gap is precisely where this defect lived.

## Offered is not fetched: the snippet screen

A `skill_search` result carries a `snippet` — an FTS window cut from the asset's
`content` column. So a discriminative token can reach the model **without any
full-text fetch**, as part of a search result it was offered.

The first real run proved this is not hypothetical, and proved it asymmetrically:
across one B session, `47318` (the right asset's port) came back in **13**
search snippets, while `10.244.7.19` (the wrong asset's address) came back in
**none**. Nothing about the design guarantees which tokens a snippet window will
include.

So the judge screens each token against the search snippets that reached the
model **before** the operation. If the token was in one, the use cannot be told
apart from having read the snippet, and the event stops at `needs_review` — a
full fetch may also have happened, but the token no longer isolates it. This is
the same principle as screening against the system prompt, applied to content
the run itself surfaced.

`collect-artifacts.mjs` records `offered_content` (every search/list result body
with the message index it arrived at) so the judge can screen only what
preceded each operation.

One consequence worth stating plainly: because `47318` leaks into snippets, the
mainline right-asset `used` case is provable **only** in runs where no snippet
carried it. Making that token snippet-safe would need another pool re-freeze and
is left as a scenario decision rather than done silently.

## The earliest delivery decides

The snippet screen above was the first form of a more general rule, and the
second real run showed why the general form is needed. The consumer read its
**own auto-extracted skill** at message 4 — the system had distilled one from a
previous session and left it in the evaluation pool — and only then read the
credited assets at messages 20 and 21. That skill happened not to carry the
discriminative tokens. Nothing guarantees the next one will not.

So `collect-artifacts.mjs` now records `delivered_content`: **every** tool
result's output with the message index it arrived at and the command that
produced it. The judge finds the earliest delivery of the token before the
operation and credits the fetch only if that fetch *is* the earliest delivery.
Anything earlier — a search snippet, another asset's body, a file read, the
model's own skill — stops the event at `needs_review` and names the source.

Equal is not earlier: the credited fetch's own response is in
`delivered_content` at its `context_entry_index`, and that is the case that
passes.
