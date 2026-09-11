# Gate decisions

REJECT   eval-bridge-endpoint-a (skl-sZFb3KatWY6m)
    - rule reject: a corrected record exists (reason=wrong, 1 record(s)) — the call it fed dialled 10.244.7.19:8096 — the asset's own value (bt-6r9pvuj8gf3) — and timed out; an independent probe also failed to reach it (timed out, harness probe at run time, 2026-09-10T23:22:59Z), so the content explains the failure (timed out)
    - reported signals: task ids not recorded on the events, so generalisation is not measurable here, 1 distinct consumer(s); neither is a threshold at this stage
    - author confidence 0.5 (1 validated, 1 corrected, prior 0.5: neutral 0.5: no other author has cross-person outcomes)
    signals: fetched 1, used 1 (+0 soft), validated 0 (cross_user 0), corrected 1; 1 consumer(s), 0 task(s)
    author:  usr-n68ea5ythq / agt-5e4hna56j9 → confidence 0.5
    evidence:
      corrected  cross_user  evt-573c82494809
      used       cross_user  evt-3b78260016fd

ADMIT    eval-bridge-endpoint-b (skl-oBaDO5CceKnr)
    - rule admit: cross_user validated >= 1 (1 record(s)) and no corrected
    - reported signals: 1 distinct task(s), 1 distinct consumer(s); neither is a threshold at this stage
    - author confidence 0.5 (1 validated, 1 corrected, prior 0.5: neutral 0.5: no other author has cross-person outcomes)
    signals: fetched 1, used 1 (+0 soft), validated 1 (cross_user 1), corrected 0; 1 consumer(s), 1 task(s)
    author:  usr-n68ea5ythq / agt-5e4hna56j9 → confidence 0.5
    evidence:
      validated  cross_user  evt-172a083fa6e6
      used       cross_user  evt-dc2f0f94bb08

PENDING  deploy-lookup-note-b (skl-eM1xP28pXiYA)
    - cold start: no usage evidence for this asset yet (nothing at fetched or beyond); pending by default
    - no corrected record, so reject did not trigger
    - author confidence not computable: usr-8ypylzex49 has no cross-person outcomes; review priority: normal
    signals: fetched 0, used 0 (+0 soft), validated 0 (cross_user 0), corrected 0; 0 consumer(s), 0 task(s)
    author:  usr-8ypylzex49 → no cross-person validation yet
    evidence: none cited (pending on absence of evidence)

PENDING  eval-bridge-endpoint-c (skl-ImeA29HL3Djj)
    - cold start: no usage evidence for this asset yet (nothing at fetched or beyond); pending by default
    - no corrected record, so reject did not trigger
    - author usr-n68ea5ythq has 1 asset(s) judged wrong within 30 days (skl-sZFb3KatWY6m); review priority: high
    signals: fetched 0, used 0 (+0 soft), validated 0 (cross_user 0), corrected 0; 0 consumer(s), 0 task(s)
    author:  usr-n68ea5ythq → confidence 0.5
    evidence: none cited (pending on absence of evidence)

PENDING  deploy-lookup-note-a (skl-KPVMV2uB5rXM)
    - cold start: no usage evidence for this asset yet (nothing at fetched or beyond); pending by default
    - no corrected record, so reject did not trigger
    - author confidence not computable: usr-8ypylzex49 has no cross-person outcomes; review priority: normal
    signals: fetched 0, used 0 (+0 soft), validated 0 (cross_user 0), corrected 0; 0 consumer(s), 0 task(s)
    author:  usr-8ypylzex49 → no cross-person validation yet
    evidence: none cited (pending on absence of evidence)

PENDING  tdc-312fad (skl-MyrdnecjeYSb)
    - cold start: no usage evidence for this asset yet (nothing at fetched or beyond); pending by default
    - no corrected record, so reject did not trigger
    - author confidence not computable: usr-8ypylzex49 has no cross-person outcomes; review priority: normal
    signals: fetched 0, used 0 (+0 soft), validated 0 (cross_user 0), corrected 0; 0 consumer(s), 0 task(s)
    author:  usr-8ypylzex49 → no cross-person validation yet
    evidence: none cited (pending on absence of evidence)

admit 1, pending 4, reject 1

6 decision(s) → /private/tmp/topic4-runs/20260910T232209Z-trial-gate-off.J4Za/20260910T232209Z-trial-gate-off/gate-decisions.json
