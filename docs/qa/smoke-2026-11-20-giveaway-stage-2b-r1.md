# Giveaway Stage 2b R1 verification: stopped

Unchanged WHR-208 recovery regressions passed2/2 on efb8b7c against compiled local Next/PostgreSQL16. After frontend fix ad92be8, selected14 cases returned10 passed/4 failed. No complete R1 pass or fresh fidelity capture is claimed.

Focused follow-up established a server-contract blocker: GET `/api/admin/giveaway/:campaignId/reconciliation/exclusions/:exclusionId` returned HTTP200, state `superseded`, UUIDv4 auditEventId `0554031d-10ff-4902-a90e-e0afe85c0ea8`. M1 requires canonical UUIDv7 for Id; M4 types this field as Id. Strict schema rejected only `auditEventId`/`invalid_format`. Regression:0 passed/1 failed. Testing stopped after assertion and fixture cleanup, with no further mutation/capture/retry.

Reproduce on disposable local stack: configure fictional verified manager, save complete census, propose phone-only unavailability with `partialSources=[]`, replace census, read retained superseded detail. Run `pnpm exec playwright test tests/e2e/giveaway-checklist-r1.spec.ts --project=desktop --workers=1 -g 'superseded unavailable history'` with explicitly local test database/matching browser. Never relax UUID contract to accept this response.

EM has sanitized evidence for T1. Local report `/tmp/whr23-r1-fix-acceptance.md`, exact evidence `/tmp/whr23-r1-superseded-contract.log`. Three checker fixture/locator corrections, final responsive captures, gates, full supported CI and remaining reviewer rounds are pending. No READY or merge claim.
