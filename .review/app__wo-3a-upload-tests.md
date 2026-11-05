---
branch: app/wo-3a-upload-tests
linear: WHR-60
tier: high
plan:
  goal: Diagnose and stabilize the two upload-failure browser fixtures without weakening production recovery or assertions.
  files: tests/e2e/upload-sync.spec.ts; narrowly required test helpers; diagnostic verification notes.
  approach: Reproduce and distinguish navigation before durable failure and lease release from a product recovery defect; synchronize fixtures only if evidence supports a test cause.
  tests: Both cases repeated 20 times across both browser projects under CI-like concurrency with zero runner retries; full local gates and browser suite; two consecutive green CI runs.
  risks: Navigation may abandon a live durable lease; retained evidence and authoritative credit assertions must remain; no LEASE_MS changes, sleeps, runner retries, or shared record files.
---

Plan committed before builder dispatch. Production changes require routing to the offline builder after diagnosis.
