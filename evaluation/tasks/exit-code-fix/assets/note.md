---
name: eval-tool-result-exit-line
description: Team experience note — how CodeBuddy tool results spell the exit-status line, and the regression test to add when an acceptance parser misreads it.
category: failure_experience
source: batch-4 run records (2026-09-10, 329 tool results) and the acceptance code that reads them
---

# Reading the exit status of a CodeBuddy tool result

## What was found

CodeBuddy's Bash tool result ends with three labelled sections:

    Stdout: …
    Stderr: …
    Exit Code: 0

The label is `Exit Code:` — capital C. Every one of the 329 tool results in the
batch-4 records spells it that way; none spells it `Exit code:`.

The acceptance in `evaluation/tasks/bridge-addr/verify.mjs` reads the exit
status with a pattern that only accepts `Exit code:` (lower-case c). So the
exit status was never read from a real result: a curl that timed out with
stderr suppressed (`-s` without `-S`) has nothing but `Exit Code: 28` to show,
and it is recorded as "outcome not readable" instead of "timed out"; curl 52 /
56 (empty reply / connection reset) are recorded the same way instead of as
failures.

## The fix, and the test to add

Accept both spellings when reading the exit line (case-insensitive on the
label), keep everything else as it is, and add a regression test for the
capital spelling. Put it in a new file next to the acceptance:

    evaluation/tasks/bridge-addr/verify.exit-status.{{TRACE}}.test.mjs

and give the test case the marker `{{TRACE}}` in its title, so the team can
find it later. Cover `Exit Code: 28` with no other timeout text → "timed out",
`Exit Code: 52` → a failure, and the lower-case spelling still working.
