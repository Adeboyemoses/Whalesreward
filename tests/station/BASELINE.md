# WO-app-5 local acceptance baseline

Unchanged application runtime `376aeb1` (runtime from accepted admin navigation `465a9cd`); corrected test producer `aac94e3`. Local Linux Chromium/Node26, isolated fictional PostgreSQL database `whr_app5_test`, seven migrations and fixture seed. No staging, provider or cloud request. Traces, video and automatic screenshots disabled.

`pnpm test:e2e tests/e2e/attendant-station-access.spec.ts --project=desktop --workers=1 --retries=0`: **2 failed, 0 passed, zero retries**. Both cases provisioned a real attendant via the real admin endpoint and received the existing restricted attendant sign-in response, then failed because the “Change your first password” heading/form is absent. The first case also establishes the intended no-anchor/fresh-sign-in path; the second will exercise revoked restricted authority once that UI exists. These are pre-implementation acceptance failures, not backend failures.

A preparatory run failed earlier at attendant provisioning with401 because the new test fixture's overly broad URL predicate already matched `/admin/sign-in` and returned before login completed. The helper was corrected to await the real sign-in response and departure from the credential route. That preparatory failure is not product regression evidence.

New default-CI acceptance source lives in `tests/e2e/station-management.spec.ts` and `attendant-station-access.spec.ts`. P-21 cases explicitly use `tests/station/assignment-end-fake.ts` until WHR-80 merges: they assert the real database remains assigned, so transport simulation cannot be confused with server offboarding/revocation verification. Production code never imports this fake. Ordinary station and first-password cases use the real local stack. More than100 picker fixtures are inserted through local SQL to avoid mistaking write-rate preconditions for pagination bugs.

Final green results, implementation source and dedicated board comparisons will be recorded after the builders' commits are integrated.

## First combined implementation check

Phone source `565686f`, admin source `48b6bc6`, producer `6401612` plus the branch merge of admin `48b6bc6`. New focused desktop suite: **6 passed, 10 failed (3.3 minutes), zero retries**. Seven failures expose loss of frozen Review state after navigating to the price, reassignment and end-assignment confirmation suffixes. The page says to review again and cannot confirm; no mutation occurs. Three other failures stop in the test fixture when changing a newly created admin's role without incrementing its required version; those are fixture mistakes, excluded from product red evidence. The fixture now increments the version before sign-in.

The real phone-only source check separately passed **3/3 (11.0 seconds)**: restricted no-anchor/fresh sign-in, revoked restriction and A17 original queued photo/operation/assignment retention. P-21 actual server cases are prepared separately and are not run or claimed until WHR-80 merges.

Inherited browser expectations now distinguish definitive authentication revocation from ordinary24-hour expiry. Revocation must hide identity and show Sign in while retaining locked raw records/windows. The original expiry/clock bounds and2000ms readiness/network-pill budgets stay intact. The HTTP transport fake gains only the existing M2 configured-assignment read; production does not import it.
