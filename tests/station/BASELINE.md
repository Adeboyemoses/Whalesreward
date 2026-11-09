# WO-app-5 local acceptance baseline

Unchanged application runtime `376aeb1` (runtime from accepted admin navigation `465a9cd`); corrected test producer `aac94e3`. Local Linux Chromium/Node26, isolated fictional PostgreSQL database `whr_app5_test`, seven migrations and fixture seed. No staging, provider or cloud request. Traces, video and automatic screenshots disabled.

`pnpm test:e2e tests/e2e/attendant-station-access.spec.ts --project=desktop --workers=1 --retries=0`: **2 failed, 0 passed, zero retries**. Both cases provisioned a real attendant via the real admin endpoint and received the existing restricted attendant sign-in response, then failed because the “Change your first password” heading/form is absent. The first case also establishes the intended no-anchor/fresh-sign-in path; the second will exercise revoked restricted authority once that UI exists. These are pre-implementation acceptance failures, not backend failures.

A preparatory run failed earlier at attendant provisioning with401 because the new test fixture's overly broad URL predicate already matched `/admin/sign-in` and returned before login completed. The helper was corrected to await the real sign-in response and departure from the credential route. That preparatory failure is not product regression evidence.

New default-CI acceptance source lives in `tests/e2e/station-management.spec.ts` and `attendant-station-access.spec.ts`. P-21 cases explicitly use `tests/station/assignment-end-fake.ts` until WHR-80 merges: they assert the real database remains assigned, so transport simulation cannot be confused with server offboarding/revocation verification. Production code never imports this fake. Ordinary station and first-password cases use the real local stack. More than100 picker fixtures are inserted through local SQL to avoid mistaking write-rate preconditions for pagination bugs.

Final green results, implementation source and dedicated board comparisons will be recorded after the builders' commits are integrated.
