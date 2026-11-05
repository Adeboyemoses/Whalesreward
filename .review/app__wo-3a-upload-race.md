---
branch: app/wo-3a-upload-race
linear: WHR-60
tier: high
reviewed_head: pending
rounds: 0
builder: test-engineer
reviewers:
  code-reviewer: pending
  security-reviewer: pending
  integrity-reviewer: pending
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: Diagnose and remove the two upload-failure browser races without weakening upload correctness checks.
  files: tests/e2e/upload-sync.spec.ts, tests/fixtures/**, docs/qa/upload-failure-race.md; src/client/offline/** only if diagnosis proves a product recovery defect.
  approach: Reproduce with durable-state and lease observations; verify abandoned-lease recovery; synchronize fixtures on observed failure completion if product recovery is sound.
  tests: Both cases on desktop and attendant with two workers, twenty repeats each and zero retries; full browser suite; standard EM gates; two consecutive green CI executions.
  risks: Hiding a real stuck lease, weakening evidence or exactly-once assertions, sleeping past races, shortening production leases or inflating retries; none are acceptable.
invariants: [I-03, I-06, I-22, I-23, I-25, I-26, I-28]
p1: []
tickets: []
---

Earl approved WHR-60 in the current session on 2026-11-05.
The existing work-order risk is high and is retained while diagnosis distinguishes fixture and product behavior.
Feature work excludes STATUS, coverage and lane files; records follow after the merge.
