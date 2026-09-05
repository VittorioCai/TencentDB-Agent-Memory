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
