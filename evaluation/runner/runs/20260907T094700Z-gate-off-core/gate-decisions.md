# Gate decisions

REJECT   eval-bridge-endpoint-a (skl-sZFb3KatWY6m)
    - rule reject: a corrected record exists (reason=wrong, 1 record(s)) — the call it fed dialled 10.244.7.19:8096 — the asset's own value (10.244.7.19) — and timed out; an independent probe also failed to reach it (timed out, harness probe at run time, 2026-09-07T09:48:17Z), so the content explains the failure (timed out)
    - reported signals: task ids not recorded on the events, so generalisation is not measurable here, 1 distinct consumer(s); neither is a threshold at this stage
    - author confidence 0.5 (1 validated, 1 corrected, prior 0.5: neutral 0.5: no other author has cross-person outcomes)
    signals: fetched 1, used 1 (+0 soft), validated 0 (cross_user 0), corrected 1; 1 consumer(s), 0 task(s)
    author:  usr-n68ea5ythq / agt-5e4hna56j9 → confidence 0.5
    evidence:
      corrected  cross_user  evt-ce8ddee19095
      used       cross_user  evt-999498e336ac

ADMIT    eval-bridge-endpoint-b (skl-oBaDO5CceKnr)
    - rule admit: cross_user validated >= 1 (1 record(s)) and no corrected
    - reported signals: 1 distinct task(s), 1 distinct consumer(s); neither is a threshold at this stage
    - author confidence 0.5 (1 validated, 1 corrected, prior 0.5: neutral 0.5: no other author has cross-person outcomes)
    signals: fetched 1, used 1 (+0 soft), validated 1 (cross_user 1), corrected 0; 1 consumer(s), 1 task(s)
    author:  usr-n68ea5ythq / agt-5e4hna56j9 → confidence 0.5
    evidence:
      validated  cross_user  evt-dbd5b7013b72
      used       cross_user  evt-f93aca67eab1

admit 1, pending 0, reject 1

2 decision(s) → /Users/vittoriocai/Desktop/Tecent_agentmemory-project4/.claude/worktrees/topic4-gate0/evaluation/runner/runs/20260907T094700Z-gate-off-core/gate-decisions.json
