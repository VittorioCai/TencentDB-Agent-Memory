# Gate decisions

ADMIT    eval-bridge-endpoint-b (skl-oBaDO5CceKnr)
    - rule admit: cross_user validated >= 1 (1 record(s)) and no corrected
    - reported signals: 1 distinct task(s), 1 distinct consumer(s); neither is a threshold at this stage
    - author confidence 0.583 (1 validated, 0 corrected, prior 0.5: neutral 0.5: no other author has cross-person outcomes)
    signals: fetched 1, used 1 (+0 soft), validated 1 (cross_user 1), corrected 0; 1 consumer(s), 1 task(s)
    author:  usr-n68ea5ythq / agt-5e4hna56j9 → confidence 0.583
    evidence:
      validated  cross_user  evt-46e08aa04e5e
      used       cross_user  evt-d0a8e1f89a3b

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
    - author confidence 0.583 (1 validated, 0 corrected, after shrinkage); review priority: normal
    signals: fetched 0, used 0 (+0 soft), validated 0 (cross_user 0), corrected 0; 0 consumer(s), 0 task(s)
    author:  usr-n68ea5ythq → confidence 0.583
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

PENDING  eval-bridge-endpoint-a (skl-sZFb3KatWY6m)
    - used with hard evidence 1 time(s) but no outcome tied to those calls yet
    - no corrected record, so reject did not trigger
    - reported signals: task ids not recorded on the events, so generalisation is not measurable here, 1 distinct consumer(s); neither is a threshold at this stage
    - author confidence 0.583 (1 validated, 0 corrected, prior 0.5: neutral 0.5: no other author has cross-person outcomes)
    signals: fetched 1, used 1 (+0 soft), validated 0 (cross_user 0), corrected 0; 1 consumer(s), 0 task(s)
    author:  usr-n68ea5ythq / agt-5e4hna56j9 → confidence 0.583
    evidence:
      fetched    cross_user  evt-0904b9451af1
      used       cross_user  evt-e516f04f6a4d
      needs_review cross_user  evt-9a1ea631f5a9

admit 1, pending 5, reject 0

6 decision(s) → /private/tmp/topic4-runs/20260910T232730Z-gate-off.clR6/20260910T232730Z-gate-off/gate-decisions.json
