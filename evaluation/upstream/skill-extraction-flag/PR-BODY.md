## Description | 描述

`POST /v3/skill/extract`, `POST /v3/skill/conversation/add` and
`POST /v3/skill/conversation/force-archive` answer a success with `ok`/`status` and a
`task_id`. That answer is accurate: `SkillTriggerService.archive()` writes the archive,
appends the `SkillTaskEntry` and calls `enqueueAgent`, all three inside the tasks mutex.
It has never meant that a Skill was produced — and with `skill.extraction.enabled=false`
the accepted task cannot be executed in that configuration, while no field in the
response says so.

The caller therefore cannot distinguish "accepted, extraction under way" from "accepted,
extraction cannot run here": both are `code: 0` with a `task_id`. A client that waits for
a skill to appear waits forever, and a client polling `/v3/skill/list` cannot tell an
empty result caused by the switch from one caused by a session with nothing worth
keeping.

This adds one field, `extraction_enabled`, to the success responses of those three entry
points. It reports the configuration switch and nothing more:

- **not** worker readiness and **not** task completion — `true` only means the switch is on;
- `null`, never `false`, when the resolved skill config cannot be reached, so
  "cannot tell" stays distinguishable from "it is off".

The archive contract is unchanged: the slice is still archived, the task is still
registered and enqueued, and error responses keep their existing shape. Rejecting the
call instead would be worse — the archive and the task entry are already written by the
time the handler returns, so a failure response would invite a retry that duplicates
them.

## Related Issue | 关联 Issue

No existing issue — found while running the product end to end and hitting it. Related
but not overlapping: #1117 (see Additional Notes).

## Change Type | 修改类型

- [x] Bug fix | Bug 修复
- [ ] New feature | 新功能
- [x] Documentation update | 文档更新 — API doc and both SDKs declare the new field
- [ ] Code optimization | 代码优化

## Self-test Checklist | 自测清单

- [x] Verified locally | 本地验证通过

  `npx vitest run src/gateway/skill-archive-extraction-flag.test.ts` — 6 tests, all passing:

  1. extraction off — the slice is still archived, `archive` is still called once,
     `ok`/`task_id`/`archive_key` unchanged, and `extraction_enabled: false`;
  2. extraction on — response keys are exactly the previous four plus the new one, and
     nothing in it speaks about the outcome of extraction;
  3. config unreachable — `null` in both cases: the optional dep absent, and the dep
     present but returning `undefined` (skill not yet constructed). Never a fabricated
     `false`;
  4. `conversation/add` — reported both below the threshold (`status: "ok"`) and at it
     (`status: "archived"`, `archived` preserved);
  5. `force-archive` — reported on both the `empty` and the `archived` answer;
  6. a failed archive keeps its original error (`50001`, original message) and the new
     field is **not** injected into the error envelope.

  Also reproduced live against a running Core — evidence under Additional Notes.

- [x] No existing features affected | 无影响现有功能

  The field is additive on success envelopes only; no request schema, no status code and
  no existing field changes. `bash scripts/ci/check-skill-queue-isolation.sh` with
  `BASE_REF=origin/feat/server_team` → PASS. `tsc` on the touched file reports the same
  18 pre-existing diagnostics before and after (none added). `npm pack --dry-run` does
  not include the new test file (`!src/**/*.test.ts` in `files`), so the published
  package is unchanged in shape. MemoryProxy and MemoryPanel pass the response through
  and ignore unknown fields, so they keep working untouched.

## Additional Notes | 其他说明

### Reproduction

Live, on standalone + sqlite, with `skill.extraction.enabled: false`:

```bash
curl -sS -H "authorization: Bearer $KEY" -H "x-tdai-user-key: $KEY" \
  -H 'content-type: application/json' -H 'x-tdai-service-id: default' \
  -X POST http://localhost:8420/v3/skill/extract -d '{
    "user_id":"usr-…","team_id":"team-…","agent_id":"agt-repro-extraction-flag",
    "session_id":"repro-1",
    "messages":[{"role":"user","content":"…"},{"role":"assistant","content":"…"}]}'
```

① the response — no mention of the switch:

```json
{"code":0,"message":"ok","request_id":"req-6f8365f3512d416d",
 "data":{"ok":true,"task_id":"skill-extract-task-fe84b9ed",
         "archived_at_ms":1789235870833,"archive_key":"skill_buffer/…/data-….jsonl"}}
```

② the task really is registered and enqueued —
`…/agt-repro-extraction-flag/_tasks.json` after the call:

```json
{"tasks":[{"task_id":"skill-extract-task-fe84b9ed","enqueued_at_ms":1789235870833,
           "archive_key":"skill_buffer/…/data-1789235870833.jsonl", "…":"…"}]}
```

③ the worker pool starts and then cannot execute it — `docker logs`:

```
INFO  [skill-worker-pool] start pool_id=skill-pool-default-7 concurrency=60 …
ERROR [skill-worker-pool] skill-pool-default-7#0 consumeAgent error:
      [skill-worker-pool] standalone SkillExtractor unavailable (instance=default)
ERROR [skill-worker-pool] skill-pool-default-7#1 consumeAgent error: … (repeats)
```

An empty candidate pool is deliberately **not** offered as evidence: a real extraction
may also produce no candidates, so on its own it proves nothing.

### Scope — stated explicitly

- **Not** a claim that the task is never queued. It is queued; ① – ③ above show the task
  entry and the worker attempts.
- **Not** a claim that every storage mode honours the switch. The extractor is built per
  storage mode — service mode builds one per instance
  (`buildSkillExtractorForInstance`), standalone uses the process singleton
  (`TdaiCore.getSkillExtractor`) — and this reproduction covers the standalone path only.
  The field reports the process-level resolved configuration, which is what
  `getResolvedSkillConfig()` returns.
- **Not** a change to the retry policy for tasks already in the queue. The repeated
  `consumeAgent error` above is left exactly as it is.
- **Not** a readiness probe. With `extraction.enabled=true` but no LLMRunner the resolver
  records a degradation and keeps `enabled: true`; this field still reports `true`, and
  the doc says so. Surfacing degradations would be a different, larger change.

### Relationship to #1117

[#1117](https://github.com/TencentCloud/TencentDB-Agent-Memory/pull/1117)
(`fix(skill): expose extraction action outcomes`) reports what extraction *did* —
aggregate candidate outcomes in the worker's logs and task-completion metadata — and
touches `candidate-outcome.ts` and `extract-worker.ts`. That is the worker side, after
extraction runs. This PR is the synchronous HTTP response, before anything runs, and
touches `skill-handlers.ts`. No file and no field overlaps. The two are complementary:
#1117 tells you what came of a task that executed, this tells you whether one can
execute at all.

A search of this repository's full pull-request history (not only recent PRs) for
`extraction_enabled`, `skill.extraction.enabled`, the three route paths, `force-archive`,
and `skill-handlers` / `extract-worker` / `trigger-service` found no other PR touching
these response fields. #1216 also edits `skill-handlers.ts`, but only `handleGet` — no
hunk overlap.

### Size

26 lines in the implementation (`skill-handlers.ts`: one helper plus four call sites),
125 lines of test, and 61 lines of API-doc and SDK-type declaration —
`v3-api-memorycore-doc.md`, the three TypeScript response interfaces, and the three
Python client docstrings — because a response field nobody has documented is not
finished.

### CI

`.github/workflows/pr-ci.yml` triggers on `pull_request: branches: [main]`, so it does
not run for a PR targeting `feat/server_team`. The checks above were run locally instead;
happy to re-run anything you would like to see.
