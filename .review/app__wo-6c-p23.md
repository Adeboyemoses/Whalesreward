---
branch: app/wo-6c-p23
linear: WHR-94
tier: high
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
