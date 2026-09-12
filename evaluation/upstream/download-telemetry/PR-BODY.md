## Description | 描述

`bridge-telemetry.ts` states the contract as one `bridge_call` per completed upstream
request, and the main path keeps both halves of it: one emit once a response is in hand
(4xx and 5xx included), one emit when upstream never answers.

The `files/download` branch only has the second. Its own comment records why that one was
added:

```
埋点补齐: 与主路径 :822 对称, upstream 未响应也算一次调用。
之前这个 catch 分支静默 return, 导致 curl 视角"打了 N 次" CH 少一条。
```

The same hole was closed for the failure path and left open for the success path. So a
download that works produces no row at all, and the branch is silent exactly when it
succeeds.

Measured against the handler with a stubbed sink:

| path | `bridge_call` rows |
|---|---:|
| `files/read`, success | 1 |
| `files/download`, success | **0** |
| `files/download`, network error | 1 |

This emits once the response is in hand, mirroring the main path field for field, placed
before the three returns that follow it — status passthrough, unparseable envelope,
decoded bytes — so each of those counts as exactly one completed call and no path can
produce two. Response bodies, status codes and headers are untouched.

## Related Issue | 关联 Issue

None filed. Found while reading the bridge's telemetry paths against the contract in
`bridge-telemetry.ts`.

## Change Type | 修改类型

- [x] Bug fix | Bug 修复
- [ ] New feature | 新功能
- [ ] Documentation update | 文档更新
- [ ] Code optimization | 代码优化

## Self-test Checklist | 自测清单

- [x] Verified locally | 本地验证通过

  New `MemoryProxy/src/skill/__tests__/skill-bridge-download-telemetry.test.ts` — 6 tests,
  written before the fix. Three of them passed immediately (they pin behaviour that was
  already correct), three failed for the reason above and pass now:

  - success → exactly one row, `executedEndpoint: "files/download"`, `upstreamStatus: 200`;
  - upstream 4xx → exactly one row, real status recorded;
  - upstream responded but the envelope carries no usable content → still exactly one,
    neither zero nor two;
  - network error → the row that already existed is still there, `upstreamStatus: 0`;
  - the response itself is unchanged — the success path still returns the raw bytes and
    the skill's own content-type;
  - and a control: a `files/read` success on the main path emits exactly one row, which is
    the first line of the table above — measured, not inferred from reading that path.

  ```
  cd MemoryProxy && npx vitest run src/skill/__tests__/skill-bridge-download-telemetry.test.ts
  Test Files  1 passed (1)
       Tests  6 passed (6)
  ```

  The tests drive the real `createSkillBridgeHandler` with an injected fetcher and a
  seeded session, and capture emissions through a mocked telemetry module — no network,
  no ClickHouse.

- [x] No existing features affected | 无影响现有功能

  Emission only; no response body, status code or header changes, and no new failure mode
  — `emitBridgeToolCallTelemetry` already swallows sink errors so telemetry never blocks
  the request. `npx tsc --noEmit` reports the same **60** pre-existing errors on
  `feat/server_team` before and after. `BASE_REF=origin/feat/server_team bash
  MemoryCore/scripts/ci/check-skill-queue-isolation.sh` → PASS.

## Additional Notes | 其他说明

### Who reads these rows

Not a field nobody consumes: `MemoryCore/src/gateway/analytics/analytics-sql.ts` builds
its `bridge_calls` and `prev_bridge_calls` CTEs from `tool_call_logs` where
`kind = 'bridge_call'`, and uses them for call counts and per-session call rates. A
missing row on the path that succeeds biases exactly the metric that is supposed to show
the bridge being used. This reaches persisted statistics only where the ClickHouse
collection is configured; where it is not, the fix simply makes the two paths consistent.

### Scope

- **Not** a change to what the download branch returns, or when it returns it.
- **Not** a change to the schema of a `bridge_call` row — the same fields the main path
  already sends, with `executedEndpoint: "files/download"`.
- **Not** a change to the reject-telemetry path, which was already emitting on every
  early return.

### One thing I did not touch

The sibling comment above the catch-branch emit says `与主路径 :822 对称`, and that line
number no longer points at anything related — the main path's emits sit much further down.
My own comment deliberately refers to the main path by behaviour instead of by line, so it
cannot rot the same way. I left the existing `:822` alone to keep this diff to the bug;
say the word and I will fix it here or in a one-line follow-up.

### Overlap with #1305

[#1305](https://github.com/TencentCloud/TencentDB-Agent-Memory/pull/1305) also edits
`skill-bridge.ts`, but in a different region — an import near the top and one line inside
the *main* path's emit, adding `...extractResolvedSkillAccess(sub, resp.status, respText)`.
There is no hunk overlap with this change, which is ~300 lines earlier in the download
branch, and the two do not conflict. Worth noting for whoever reviews both: if #1305 lands,
the same spread would presumably belong on this new emit too, and I am happy to add it in
a follow-up or fold it in here — say which you prefer.

`.github/workflows/pr-ci.yml` triggers on `pull_request: branches: [main]`, so it does not
run for a PR targeting `feat/server_team`; the checks above were run locally instead.

Size: +19 in `skill-bridge.ts` (the emit plus the comment saying why it sits where it
does), plus 116 lines of test.
