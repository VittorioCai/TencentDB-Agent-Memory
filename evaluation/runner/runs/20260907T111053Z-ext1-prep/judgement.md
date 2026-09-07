# Hard-evidence judgement

  1 used, 2 needs_review, from 5 content-bearing fetch(es)

  used          deploy-lookup-note-a             v1  tool_call
       token skl-Bwuta6kNQ6wq; content of v1 entered the context at message 7, before this operation at message 9
       request(55f7909a-216e-4bdd-add6-086d22d41ceb):msg[9]:call_00_ptlWSY1E0y65kET62eFh2094:arguments
  needs_review  deploy-lookup-note-b             v?  tool_call
       token skl-MyrdnecjeYSb; the token was in a search listing (message 4) before this operation, inside another asset's entry as well (tdc-312fad), so its use cannot be attributed to this asset
       request(55f7909a-216e-4bdd-add6-086d22d41ceb):msg[9]:call_01_slThx757YkkLClXRyIX19255:arguments
  needs_review  deploy-lookup-note-b             v?  tool_call
       token skl-MyrdnecjeYSb; the token was in a search listing (message 4) before this operation, inside another asset's entry as well (tdc-312fad), so its use cannot be attributed to this asset
       request(f587b3c6-d1c5-4488-8d16-93e7b2c7e11d):msg[12]:call_00_kI3nq3IXlL8yj9IZ0Otr2300:arguments

3 asset revision(s) were fetched and left no trace in the work:
  - skill-bridge-http-access v3
  - deploy-lookup-note-b v1
  - tdc-312fad v1
They stay at `fetched`. Retrieval is not use, and an asset that was read and
ignored is a real outcome — arguably the one a team asset system most needs to
see — so it is reported rather than promoted.

Written to evaluation/attribution/artifacts/used-events.jsonl
