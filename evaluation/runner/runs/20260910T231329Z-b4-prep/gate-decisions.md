# Gate decisions

ADMIT    eval-bridge-endpoint-b (skl-oBaDO5CceKnr)
    - rule admit: cross_user validated >= 1 (1 record(s)) and no corrected
    - reported signals: 1 distinct task(s), 1 distinct consumer(s); neither is a threshold at this stage
    - author confidence 0.583 (1 validated, 0 corrected, prior 0.5: neutral 0.5: no other author has cross-person outcomes)
    signals: fetched 1, used 3 (+0 soft), validated 1 (cross_user 1), corrected 0; 1 consumer(s), 1 task(s)
    author:  usr-n68ea5ythq / agt-5e4hna56j9 → confidence 0.583
    evidence:
      validated  cross_user  evt-28866c7c84dc
      used       cross_user  evt-be64334e8496

PENDING  deploy-lookup-note-b (skl-eM1xP28pXiYA)
    - fetched 1 time(s) without any evidence of use
    - no corrected record, so reject did not trigger
    - reported signals: task ids not recorded on the events, so generalisation is not measurable here, 1 distinct consumer(s); neither is a threshold at this stage
    - author confidence not computable: usr-8ypylzex49 has no cross-person outcomes
    signals: fetched 1, used 0 (+0 soft), validated 0 (cross_user 0), corrected 0; 1 consumer(s), 0 task(s)
    author:  usr-8ypylzex49 → no cross-person validation yet
    evidence:
      fetched    cross_user  evt-aa259ade7864

PENDING  eval-bridge-endpoint-c (skl-ImeA29HL3Djj)
    - cold start: no usage evidence for this asset yet (nothing at fetched or beyond); pending by default
    - no corrected record, so reject did not trigger
    - author confidence 0.583 (1 validated, 0 corrected, after shrinkage); review priority: normal
    signals: fetched 0, used 0 (+0 soft), validated 0 (cross_user 0), corrected 0; 0 consumer(s), 0 task(s)
    author:  usr-n68ea5ythq → confidence 0.583
    evidence: none cited (pending on absence of evidence)

PENDING  deploy-lookup-note-a (skl-KPVMV2uB5rXM)
    - fetched 1 time(s) without any evidence of use
    - no corrected record, so reject did not trigger
    - reported signals: task ids not recorded on the events, so generalisation is not measurable here, 1 distinct consumer(s); neither is a threshold at this stage
    - author confidence not computable: usr-8ypylzex49 has no cross-person outcomes
    signals: fetched 1, used 0 (+0 soft), validated 0 (cross_user 0), corrected 0; 1 consumer(s), 0 task(s)
    author:  usr-8ypylzex49 → no cross-person validation yet
    evidence:
      fetched    cross_user  evt-32f22b56db6e

PENDING  tdc-312fad (skl-MyrdnecjeYSb)
    - fetched 1 time(s) without any evidence of use
    - no corrected record, so reject did not trigger
    - reported signals: task ids not recorded on the events, so generalisation is not measurable here, 1 distinct consumer(s); neither is a threshold at this stage
    - author confidence not computable: usr-8ypylzex49 has no cross-person outcomes
    signals: fetched 1, used 0 (+0 soft), validated 0 (cross_user 0), corrected 0; 1 consumer(s), 0 task(s)
    author:  usr-8ypylzex49 → no cross-person validation yet
    evidence:
      fetched    cross_user  evt-a1135229e814

PENDING  eval-bridge-endpoint-a (skl-sZFb3KatWY6m)
    - used with hard evidence 2 time(s) but no outcome tied to those calls yet
    - no corrected record, so reject did not trigger
    - reported signals: task ids not recorded on the events, so generalisation is not measurable here, 1 distinct consumer(s); neither is a threshold at this stage
    - author confidence 0.583 (1 validated, 0 corrected, prior 0.5: neutral 0.5: no other author has cross-person outcomes)
    signals: fetched 1, used 2 (+0 soft), validated 0 (cross_user 0), corrected 0; 1 consumer(s), 0 task(s)
    author:  usr-n68ea5ythq / agt-5e4hna56j9 → confidence 0.583
    evidence:
      fetched    cross_user  evt-d260a01c159c
      used       cross_user  evt-3aa2079212d6
      used       cross_user  evt-030b41d1c8fb
      needs_review cross_user  evt-7b97530f461e
      needs_review cross_user  evt-1836799cb9c8

admit 1, pending 5, reject 0

6 decision(s) → /private/tmp/topic4-runs/20260910T231329Z-b4-prep.GgsN/20260910T231329Z-b4-prep/gate-decisions.json
