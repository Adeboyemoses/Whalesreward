---
branch: app/wo-3-uploads
linear: WHR-7
tier: high
reviewed_head: f13ad2f6afe0632707a76fa5f7e54a15ad1d7694
rounds: 4
builder: offline-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 19
escalation: Earl approved one extra documentation-only review round on 2026-11-05 for 1205c45 and 0e899b1 against a7fc353; any application-code, test or dependency change voids approval.
plan:
  goal: Upload queued sales safely and display credit only from validated authoritative server status.
  files: src/client/**, src/app/(attendant)/**, src/ui/**, src/styles/**, tests/fixtures/**, tests/e2e/**, tests/design-parity/**, docs/briefs/**, docs/qa/**, docs/engineering/coverage-map.md, docs/agentic/lanes/app.md, STATUS.md
  approach: Extend typed M1 adapter and account-scoped durable sync state machine; reconcile unknown outcomes, preserve immutable finalize requests, lease retries, and render receipts from server status.
  tests: Lost submit/finalize responses, restart, expired permissions, Retry-After, account handover, expiry, concurrent leases, partial uploads, invalid photos, mixed holds, gas receipt, independent fidelity and Playwright.
  risks: Cross-account upload, duplicate credit, false Synced, evidence loss, stale retries, permission leakage; real endpoints and physical phone acceptance remain external dependencies.
invariants: [I-03, I-06, I-22, I-23, I-25, I-26, I-27, I-28, I-31, I-33, I-34, I-35, I-48, I-49, I-50]
p1:
  - fixed storage PUT 403 no longer locks a valid app session
  - fixed unchanged reconciliation preserves exponential backoff
  - fixed Stay signed in and navigation cancel delayed logout intent
  - fixed cancelled rows show their authoritative reason
  - fixed nonterminal receipt refresh preserves permanent photo rejection
tickets: [WHR-45, WHR-60]
---

Offline, frontend and test-engineer builders worked in isolated worktrees.
Initial plan was committed in 41e3aa3 before builder dispatch; its block is unchanged.
All three independent reviewers passed a7fc353 in round 3 with zero open findings.
The worktree stayed clean and its head unchanged during each review.
No P0, SEC-HIGH or INTEGRITY-P1 was reported in any round; five P1s were fixed.
Unit regressions proved storage403, retry growth and permanent-error refresh failures before fixes.
Browser regressions cover interrupted/replayed uploads, held states, handover and cancelled logout intent.
EM typecheck/lint/build and 107 unit tests pass; time suites pass 3 UTC and 3 America/New_York.
Full browser result is recorded in docs/qa/smoke-2026-11-05-upload-sync.md and on WHR-7.
Independent fidelity report covers five boards at 390/360 px; ten screenshots, no new blockers.
WHR-45 is the existing accepted quantity trailing-zero presentation follow-up.
WHR-60 tracks a P2 browser fixture race: full navigation can precede failed PUT lease release.
Final-head full runs had 66 passes/2 timing failures/4 skips (partial PUT and expired PUT).
Both last-failed cases passed unchanged on their first targeted rerun attempt.
M1 fake responses remain test-only; real upload endpoints and Android acceptance remain pending.
No schema migration, automatic evidence deletion, cloud operation, history or correction work.

Earl reaffirmed original-session ownership and the bounded extra review in this session.
Approval is also recorded on WHR-7, comment 0cea0f42-8e20-4fc3-b9ae-fcb7247833c9.
WHR-60 is nonblocking per Earl; diagnose before M5 and cover both flows in M1 phone smoke.
Round 4 code/security/integrity reviewers all PASS f13ad2f; no findings, no app/test/dependency delta.
Their prior application review carries forward; the plan block is unchanged.
New PR #36 at staging 2404344 conflicts in STATUS and coverage, outside this approved review.
Those conflicts are unresolved; no merge or READY is claimed and final green CI remains required.
