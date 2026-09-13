## Description | 描述

`skillRuntime.allowLlmWrite` is **false by default** — `DEFAULT_CONFIG` in
`MemoryProxy/src/config.ts`, and `config.example.yaml` documents it as such. Under that
default `skill-bridge` answers every write subpath with `40302` / HTTP 403, and
`SkillToolsInjector` correctly leaves `skill_patch` / `skill_create` out of the tool list
it renders for the model.

The `<available_skills>` header did not get the memo. `skill-injector.ts` rendered these
two sentences unconditionally:

```
If a skill has issues, fix it with the `skill_patch` skill-bridge tool.
After difficult/iterative tasks, offer to save the approach as a new skill
(`skill_create`). If a skill you loaded was missing steps, had wrong commands, or
needed pitfalls you discovered, update it before finishing.
```

So on a default deployment the model is told to use a tool it was never given, and the
call comes back 403. That costs a tool round-trip, and leaves the model holding an
instruction it cannot carry out. `allowLlmWrite` is not consulted anywhere in that file.

This splits the write sentences out of the header and renders them only when the switch
is on. With writes off the model is told what it can still do — report the problem in its
reply — and **no write tool is named**, so nothing in the read-only text invites a call
that would be rejected. Everything else in the block is untouched: the mandatory-load
directive, the curl reminder, the listing itself, and the footer.

The flag already existed one line away: `injection/index.ts` computed it for
`SkillToolsInjector`; it now passes the same value to `SkillInjector` as well.

**MemoryCore's copy of this header is deliberately not changed.** The file comment asks
that the two copies be kept in sync, so to be explicit about the divergence: the switch
is proxy-side and Core knows nothing about it, and Core's `SKILL_LISTING_HEADER` is
exported but never referenced by Core itself — `/v3/skill/listing` returns only the
`<available_skills>` lines — so on this path the header the model sees is the proxy's.
The comment now records this.

## Related Issue | 关联 Issue

None filed for this. Found while running the product end to end with the default
configuration.

## Change Type | 修改类型

- [x] Bug fix | Bug 修复
- [ ] New feature | 新功能
- [ ] Documentation update | 文档更新
- [ ] Code optimization | 代码优化

## Self-test Checklist | 自测清单

- [x] Verified locally | 本地验证通过

  New `MemoryProxy/src/injection/injectors/__tests__/skill-injector-readonly.test.ts` —
  9 tests, written before the fix (4 of them failing for the reason above), all passing
  after:

  - read-only renders no `skill_patch` / `skill_create` / "update it before finishing" /
    "fix it with";
  - read-only says what to do instead (report it), and says the session is read-only;
  - read-only keeps the rest of the block — the mandatory-load directive, `skill_view`,
    the listing verbatim, the footer;
  - write-enabled keeps both original sentences word for word;
  - the two renderings share the same opening and the same tail, so only that clause
    swaps;
  - omitting the flag falls back to read-only, matching the product default;
  - and three that drive the real injector through `prewarm()` with a stubbed core
    client, so the value is shown to travel config → injector → rendered block, off, on,
    and unset.

  ```
  cd MemoryProxy && npx vitest run src/injection/injectors/__tests__/skill-injector-readonly.test.ts
  Test Files  1 passed (1)
       Tests  9 passed (9)
  ```

- [x] No existing features affected | 无影响现有功能

  With `allowLlmWrite: true` the header is byte-for-byte what it was. The only other
  change is one argument at the registration site. `npx tsc --noEmit` reports the same
  **60** pre-existing errors on `feat/server_team` before and after. `BASE_REF=origin/feat/server_team
  bash MemoryCore/scripts/ci/check-skill-queue-isolation.sh` → PASS.

## Additional Notes | 其他说明

Scope, stated plainly:

- **Not** a change to what the bridge accepts or rejects. `WRITE_SUBPATHS` and the 40302
  branch are untouched; this only stops the prompt from asking for something that branch
  will refuse.
- **Not** a change to `SkillToolsInjector`, which was already correct.
- **Not** a claim about hosts that render the block themselves. The proxy path is what
  this fixes.
- An agent whose listing is empty never received these sentences to begin with — the
  injector returns no block when the listing is `(none)` — so this changes nothing for
  those sessions.

### The replacement wording is yours, not mine

One part of this is a product decision I had to make to open the PR, and it should be
yours: the sentence the read-only branch renders. What the model is told is prompt
surface, so treat that text as a placeholder — happy to take whatever phrasing you
prefer, or to drop the clause entirely and simply omit the write instructions with no
replacement. The gating is the part this PR is actually about.

The one thing I would keep for a non-taste reason: whatever replaces it, better not to
name a write tool. Something like "you cannot use `skill_patch` here" puts the tool name
back in front of the model, which is what invites the 403 in the first place.

### Overlap with #1281

[#1281](https://github.com/TencentCloud/TencentDB-Agent-Memory/pull/1281)
(`feat(proxy): add dynamic skill queue strategies`) touches the same two files, and one
of its hunks rewrites the exact line this PR rewrites — the `new SkillInjector({...})`
call in `injection/index.ts`. So whichever lands second will conflict there. The
resolution is to keep both fields:

```ts
new SkillInjector({
  coreSkill: config.coreSkill,
  queueStrategy: config.injection.skillQueueStrategy,   // #1281
  allowLlmWrite,                                        // this PR
}),
```

The two are otherwise independent: #1281 changes *where and when* the listing is
injected (`point` / `anchor` / `cacheStrategy` via a queue strategy) and its diff contains
no occurrence of `allowLlmWrite`, `skill_patch`, `SKILL_LISTING_HEADER`, or the write
sentences — it does not address this bug. Both PRs also add tests under
`injectors/__tests__/`, with different filenames, so there is no collision there.

`.github/workflows/pr-ci.yml` triggers on `pull_request: branches: [main]`, so it does not
run for a PR targeting `feat/server_team`; the checks above were run locally instead.

Size: +43/−8 in the two source files (most of it comments explaining the switch), plus
103 lines of test.
