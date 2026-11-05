# lane:app
WO-app-3a (WHR-60) Upload-failure browser tests: READY since 2026-11-05
WO-app-3 (WHR-7) and WO-app-2 (WHR-5): READY; Earl's phone smoke pending

## In flight
- [Feature PR #45](https://github.com/Adeboyemoses/Whalesreward/pull/45) merged into staging at e7999cc after two consecutive full green CI runs. The two fixtures wait for the original account/operation's durable photo failure and released lease before navigation.
- Root cause: fixture navigation interrupted failure bookkeeping. Unchanged production lease recovery passed on both browser profiles at about 60.2 seconds, retaining the sale/photo and crediting once.
- Verification: 80/80 local repeats (two cases × two profiles × 20, two workers, zero retries); EM full browser 68 passed/4 existing skips, unit135, typecheck/lint/build PASS. Independent code/security/integrity PASS, round1; evidence validates.
- CI: [first pass](https://github.com/Adeboyemoses/Whalesreward/actions/runs/42054766711/attempts/1), [second pass](https://github.com/Adeboyemoses/Whalesreward/actions/runs/42054766711/attempts/2). Both browser suites68 passed plus storage1, no flaky cases.
- This separate records PR updates only STATUS, coverage and the app lane after the feature merge.

## Next
- STOP at READY. Earl reads docs/qa/upload-failure-browser-diagnosis.md and WHR-60 verification; no next work order starts here.
- Existing M1 phone/Spaces smoke remains docs/qa/smoke-2026-11-05-upload-sync.md. WHR-5 and WHR-7 are not accepted by this test-only work.

## Earl's gos
- 2026-11-05: “Work order: WO-app-3a (WHR-60), stabilize the upload-failure browser tests. Determine test vs product cause first; never shorten LEASE_MS or add sleeps or runner retries. Take it to READY, then stop.”

## Risks
- No production code, lease duration, runner retries or sleeps changed. Physical Android and deployed Spaces acceptance remain pending; WHR-45 stays separate.
- Local macOS Chromium startup is sandbox-blocked; browser evidence came from an isolated local Linux container and GitHub CI.

dispatches=5 prs=2 rounds_max=1 escalations=0 model=unknown
