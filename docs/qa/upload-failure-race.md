# Upload-failure browser race verification

WO-app-3a / WHR-60. Scope: the partial photo failure and expired signed PUT cases in `tests/e2e/upload-sync.spec.ts`.

Record root-cause evidence before fixing: request/failure persistence, lease ownership/release, navigation timing and recovery after an abandoned lease. Do not record signed URLs or credentials.

Acceptance checks:

1. Reproduce the original failure and identify the durable state before full navigation.
2. Confirm whether recovery occurs after the existing lease deadline; record the observed user-visible delay and retain the original sale/photo.
3. If fixture-only, wait for the actual durable failure and released lease before navigation. No fixed sleeps, production lease changes or added runner retries.
4. Run both cases in both projects for twenty repeats with two workers and zero retries: eighty successful test executions, zero failures/retries.
5. Run the complete browser suite and EM typecheck/lint/unit/build gates.
6. Record two consecutive green CI execution links on the unchanged reviewed feature head before merging.

Results are pending. WHR-5 and WHR-7 remain READY; this work does not claim physical-phone acceptance.
