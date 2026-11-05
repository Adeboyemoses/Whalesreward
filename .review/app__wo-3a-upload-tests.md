---
branch: app/wo-3a-upload-tests
linear: WHR-60
tier: high
reviewed_head: bd8fee097efcefef94f7c0829d5ac21c0568b1dd
rounds: 1
builder: test-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 4
invariants: [I-22, I-25, I-26]
p1: []
tickets: []
plan:
  goal: Diagnose and stabilize the two upload-failure browser fixtures without weakening production recovery or assertions.
  files: tests/e2e/upload-sync.spec.ts; narrowly required test helpers; diagnostic verification notes.
  approach: Reproduce and distinguish navigation before durable failure and lease release from a product recovery defect; synchronize fixtures only if evidence supports a test cause.
  tests: Both cases repeated 20 times across both browser projects under CI-like concurrency with zero runner retries; full local gates and browser suite; two consecutive green CI runs.
  risks: Navigation may abandon a live durable lease; retained evidence and authoritative credit assertions must remain; no LEASE_MS changes, sleeps, runner retries, or shared record files.
---

Plan committed at 9db0fec before builder dispatch. Computed minimum low; WHR-60's high classification retained.
Independent code, security and integrity reviewers passed in round one with no findings.
The two fixtures now observe persisted photo_upload_failed and released lease for the original account/operation before navigation.
No production code, lease duration, runner configuration, sleeps, unrelated tests or shared records changed.
Local Linux baseline: nine passed, three failed; natural abandoned-lease browser recovery: two passed at approximately 60.2 seconds, exactly one credit each.
EM final reviewed-head typecheck, lint, unit (135 tests) and production build passed.
Repeat counts, full browser verification and consecutive CI links are recorded in the PR and WHR-60 READY comment.
