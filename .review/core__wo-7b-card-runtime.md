---
branch: core/wo-7b-card-runtime
linear: WHR-97
tier: high
plan:
  goal: establish and fix the cause of platform failures during card generation and export preparation
  files: src/server/modules/cards/**, src/server/adapters/card-*, src/server/lib/db*, src/server/lib/transaction*, src/server/modules/admin-access/repo.ts, src/server/modules/auth/**, src/server/modules/sync/repo.ts, tests/**, scripts/**, docs/qa/**
  approach: prove hung storage lock contention; move storage outside transactions with fenced publication and live authorization rechecks; bound storage and database waits with shared safe transaction cleanup across request-pool consumers
  tests: hung storage red-green regression, responsive admin requests, retryable exports, bounded JSON errors, revocation and stale leases, production reproduction and all repository gates
  risks: process exhaustion, lock contention, slow storage, lease fencing and immutable reserved codes; cloud changes belong to Earl
---
Investigation pending; no reviewer verdicts yet. No STATUS, coverage or lane edits (WHR-63).
