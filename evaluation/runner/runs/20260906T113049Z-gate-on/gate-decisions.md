# Gate decisions

ADMIT    eval-bridge-endpoint-b (skl-oBaDO5CceKnr)
    - rule admit: cross_user validated >= 1 (1 record(s)) and no corrected
    - reported signals: 1 distinct task(s), 1 distinct consumer(s); neither is a threshold at this stage
    - author confidence 0.583 (1 validated, 0 corrected, prior 0.5: neutral 0.5: no other author has cross-person outcomes)
    signals: fetched 1, used 1 (+0 soft), validated 1 (cross_user 1), corrected 0; 1 consumer(s), 1 task(s)
    author:  usr-n68ea5ythq / agt-5e4hna56j9 → confidence 0.583
    evidence:
      validated  cross_user  evt-6187577e3213
      used       cross_user  evt-a859f64c3331

PENDING  eval-bridge-endpoint-a (skl-sZFb3KatWY6m)
    - cold start: no usage evidence for this asset yet (nothing at fetched or beyond); pending by default
    - no corrected record, so reject did not trigger
    - author confidence 0.583 (1 validated, 0 corrected, after shrinkage); review priority: normal
    signals: fetched 0, used 0 (+0 soft), validated 0 (cross_user 0), corrected 0; 0 consumer(s), 0 task(s)
    author:  usr-n68ea5ythq / agt-5e4hna56j9 → confidence 0.583
    evidence: none cited (pending on absence of evidence)

admit 1, pending 1, reject 0

2 decision(s) → evaluation/runner/runs/20260906T113049Z-gate-on/gate-decisions.json
