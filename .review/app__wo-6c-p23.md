---
branch: app/wo-6c-p23
linear: WHR-94
tier: high
reviewed_head: ae9d3122e00d1fc72e09acf7fba7eca86631e137
rounds: 2
builder: offline-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 9
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
Round 1 code/security P1: cache fallback could replace mandatory current-card validation during handoff. Fixed with mandatory HTTP lookup and outage/reauthentication regressions. All reviewers PASS on the final code head in round 2; worktree and head remained unchanged after review.
EM final-head checks: typecheck, lint, 526 unit tests and production build pass. Full Docker Playwright suite: 236 passed, four existing environment-specific staging skips. Real P-23 s06+s08 passes on desktop and phone projects with real issuance, upload validation, credit and reload retention.
Native macOS browser launch was blocked by sandbox bootstrap permissions; Docker ran the full browser gate with traces off. Local test-only transport bridges HTTPS requests to real loopback MinIO without changing production validation.
Dispatch flag: nine total calls exceeds the high-tier flag of eight; two review rounds remain within the cap of three. STATUS, coverage-map and lane files are intentionally untouched per WHR-63 and Earl's session direction.
