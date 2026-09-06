# Gate decisions

REJECT   eval-bridge-endpoint-a (skl-sZFb3KatWY6m)
    - rule reject: a corrected record exists (reason=wrong, 1 record(s)) — the call it fed dialled 10.244.7.19:8096 — the asset's own value (10.244.7.19) — and timed out; an independent probe also failed to reach it (timed out, harness probe after the run (backfill 2026-09-06), 2026-09-06T19:19:13Z), so the content explains the failure (timed out)
    - reported signals: task ids not recorded on the events, so generalisation is not measurable here, 1 distinct consumer(s); neither is a threshold at this stage
    - author confidence 0.417 (0 validated, 1 corrected, prior 0.5: neutral 0.5: no other author has cross-person outcomes)
    signals: fetched 1, used 1 (+0 soft), validated 0 (cross_user 0), corrected 1; 1 consumer(s), 0 task(s)
    author:  usr-n68ea5ythq / agt-5e4hna56j9 → confidence 0.417
    evidence:
      corrected  cross_user  evt-3efb63237b98
      used       cross_user  evt-b5cb47b6678a

PENDING  eval-bridge-endpoint-b (skl-oBaDO5CceKnr)
    - cold start: no usage evidence for this asset yet (nothing at fetched or beyond); pending by default
    - no corrected record, so reject did not trigger
    - author usr-n68ea5ythq has 1 asset(s) judged wrong within 30 days (skl-sZFb3KatWY6m); review priority: high
    signals: fetched 0, used 0 (+0 soft), validated 0 (cross_user 0), corrected 0; 0 consumer(s), 0 task(s)
    author:  usr-n68ea5ythq / agt-5e4hna56j9 → confidence 0.417
    evidence: none cited (pending on absence of evidence)

admit 0, pending 1, reject 1

2 decision(s) → evaluation/runner/runs/20260906T124058Z-loo-oBaDO5CceKnr/gate-decisions.json
