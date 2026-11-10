---
branch: app/wo-6c-p23
linear: WHR-94
tier: high
reviewed_head: 48df8fcc86b461dc7b4494775b5d9e44c9624d0a
rounds: 3
builder: offline-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 16
invariants: [I-02, I-03, I-06, I-22, I-23, I-26, I-28a, I-28b, I-49, I-50]
p1: [fixed mandatory current online lookup for registration and phone handoffs]
tickets: []
plan:
  goal: preserve P-23 lookup evidence from customer selection through immutable sale delivery
  files: src/client/**, src/app/(attendant)/attendant/**, tests/e2e/**, tests/fixtures/**, playwright.config.ts, docs/briefs/**, docs/qa/**
  approach: accept strict legacy and capable shapes; opt in after merged core; partition minimal cached evidence by account and context; freeze selected evidence before photo and atomic save; never refresh saved originals
  tests: offline cache and restart; account/context changes; registration replay; draft refresh race; legacy rows; quota rollback; lost-response retry; browser registration-to-sale
  risks: later evidence attached to earlier captures; cross-context reuse; mutated retries; PII persistence; transition decoding; receipt disclosure
---

Implementation follows M1 P-23, M2 registration amendment and docs/ops/lookup-receipts.md.
Core PR #94 is merged into staging before the capability header is enabled here.
No STATUS, coverage-map or lane-file changes (WHR-63); no receipt/key values in logs or external summaries.
The browser test harness generates ephemeral signing configuration in memory, like its existing session-secret fixture, so real P-23 credit verification also runs in CI without external configuration.
Round 1 code/security P1: cache fallback could replace mandatory current-card validation during handoff. Fixed with mandatory HTTP lookup and outage/reauthentication regressions. All reviewers passed P-23 in round 2 and the approved WHR-98 commit in round 3; worktree and head remained unchanged after review.
EM final-head checks: typecheck, lint, 526 unit tests and production build pass. Full Docker Playwright suite: 236 passed, four existing environment-specific staging skips. Real P-23 s06+s08 passes on desktop and phone projects with real issuance, upload validation, credit and reload retention.
Native macOS browser launch was blocked by sandbox bootstrap permissions; Docker ran the full browser gate with traces off. Local test-only transport bridges HTTPS requests to real loopback MinIO without changing production validation.
Dispatch flag: sixteen total calls exceeds the high-tier flag of eight; three review rounds stay within the cap of three. STATUS, coverage-map and lane files are intentionally untouched per WHR-63 and Earl's session direction.
WHR-98 approved addendum (Earl, 10 November 2026): diagnose and state the exact disabled Sign in state in PR #96 before changing tests/e2e/app-update.spec.ts; ship its fix as a separate test-only commit. Wait only for documented readiness with one shared deadline bounded by app-build.md's 5000 ms freeze-release fallback, and fail if Sign in remains disabled past it. No blanket retries, larger global timeouts or app-code changes. Stop and report any app bug. The same three reviewers check the commit in round 3 before merge and READY for WHR-94/WHR-98.
WHR-98 cause was stated in PR #96 before editing: replacement documents start with empty controlled fields/client initialization; the test's premature authenticated session mock could then correctly restore first-password access before any sign-in POST. Four constrained-CPU diagnostics reproduced two failures and two successes; every observed freeze ended in 1036–1138 ms. No app bug or unreleased freeze was observed.
Separate test-only fix 48df8fc waits for canonical, settled, non-inert worker readiness with one shared monotonic 5000 ms budget through credential entry, enabled assertion and click. It asserts one actual sign-in POST and installs the session mock only before explicit reload. No application code, global timeout or retry setting changed.
Final EM typecheck, lint, unit suite and production build pass. All eight app-update browser cases pass on desktop/mobile under one CPU with retries disabled. Builder also verified ten positive runs and an injected-disabled negative: failure at the configured five-second deadline, observed at 5008 ms including eight ms of scheduling overhead. The negative variant was temporary and never committed.
