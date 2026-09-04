# Data contracts

Three JSON Schemas. Everything downstream is written against them.

Freezing the contracts is what makes parallel work possible: before they are
fixed, independent tracks produce mutually incompatible structures, and the
rework costs more than the parallelism saves.

| Contract | Produced by | Consumed by |
|---|---|---|
| `provenance-event.schema.json` | attribution judges, the E2E runner | the admission gate, receipts, aggregation |
| `gate-decision.schema.json` | the admission gate | receipts, the decoy separation test |
| `receipt.schema.json` | receipt builder | CLI rendering, the final report |

Each contract ships a fixture under `fixtures/`, so a track can be developed
against sample data instead of waiting for a real run. The provenance fixture
deliberately contains at least one `cross_user`, `corrected`, `used_soft`,
`needs_review` and `excluded_by_snapshot` record — drop any one of them and some
branch of the gate becomes untestable.

## Validating

```bash
# any contract against any .json / .jsonl file
node evaluation/contracts/validate.mjs \
  evaluation/contracts/provenance-event.schema.json \
  evaluation/provenance/artifacts/provenance-events.jsonl

# unit tests, including "every fixture passes its own contract"
node --test evaluation/contracts/validate.test.mjs
```

The validator has no dependencies and implements only the JSON Schema subset the
three contracts use. **An unsupported keyword throws rather than being ignored** —
silently skipping it would make a contract look enforced while it is not.

## Two fields that are easy to confuse

A provenance event carries two fields that both look like "evidence level".
They answer different questions:

| Field | Question | Values |
|---|---|---|
| `observation` | How was the *fetch* witnessed? | `bridge+wire` / `bridge_only` / `wire_only` / `none` |
| `evidence_tier` | How strong is the *"it was used"* judgement? | `hard` / `soft` / `null` (null while state is `fetched`) |

Hard evidence means a discriminative token from the asset appears in the run's
artifacts. Soft evidence means a model judged an asset claim to be related to the
change — which can be fooled by things that merely *look* related, so **the two
are reported separately and never summed into one number**.

## Rules encoded in the schemas

- `relation` reports `unknown` when either side's identity is missing and **never
  defaults to `self`** — defaulting would quietly erase genuine cross-person use.
- `signals.author.confidence` is `null` when not computable, **not 0**.
- `evidence_refs` point at `event_id`s, so every gate decision can be traced back
  to concrete events and a human can review or overturn it.
- `related_tests` renders as "related test X passed", never "verified: test
  passed" — the latter reads as a causal claim the evidence does not support.
- Assets with `is_decoy: true` are excluded from headline statistics.

## Changing a contract

1. Change the schema and its fixture here, then run `validate.test.mjs`.
2. Record the change in the project's execution plan revision log.
3. Only then update the consuming code.

Not the other way round.
