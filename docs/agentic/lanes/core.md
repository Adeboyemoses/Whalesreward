# lane:core
WHR-181 original verified-date read projection: READY since 2026-11-18

## In flight
- [Feature PR #166](https://github.com/Adeboyemoses/Whalesreward/pull/166) merged into staging at `784cf67e6b6baa82a4be484276f604619ab2d944` with all five checks green. PR head `81f5a3207164cb7532579b603813531ef7c35626`; reviewed source `8f691b0`.
- Code/security/integrity PASS, round 1 of cap 3, no findings. Evidence `.review/core__WHR-181-original-date.md` validates. Feature PR excludes shared records; this docs-only PR records READY.
- Shared original Values now reads the original revision date, including non-null original dates. Sale detail/list/search, review comparison and sync audit fallback inherit the repair. Release preparation, reports, audit queries and corrections were audited; full dispositions in `docs/qa/verification-2026-11-18-original-date.md`.
- EM typecheck/lint/build, 981 unit, 1,453 PostgreSQL 16, timezone 5+5, real Next/PostgreSQL/MinIO HTTP 2, gate self-tests 53 and guard 94 PASS. CI adds browser 426 passed/two retry passes/four existing skips, storage 1 and release 3 PASS. No schema, endpoint-shape or production immutable-revision writes changed.

## Next
- Stop at READY. WHR-171 can rebase on the staging fix; WHR-178 resumes only in a new session. No WHR-178 work performed here.

## Earl's gos
- 17 Nov 2026: “Fix WHR-181.” “Then stop: WHR-178 resumes in a new session.”

## Risks
- Existing operator cleanup timeout WHR-174 required one unchanged CI integration rerun; final 1,453 assertions and both timezone runs passed. Browser retry cases remain WHR-177 and WHR-83; evidence added to existing issues with `found-in:WHR-181`.
- Local Chromium launch is sandbox-blocked; full native CI browser verification passed. Initial local PostgreSQL 15/fixture-role/name mismatches were replaced by an isolated PostgreSQL 16 disposable test database; clean full EM run passed without skips.
- Runtime model ID unavailable. No cloud resources, deployed data or main promotion touched.

dispatches=5 prs=2 rounds_max=1 escalations=0 model=unavailable
