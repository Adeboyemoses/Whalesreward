---
branch: core/WHR-26-settings
linear: WHR-26
tier: high
builder: backend-engineer
reviewed_head: 9ed4845df92b4735e0c330062b8bd56a46a795b9
rounds: 3
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 13
plan:
  goal: implement explicitly reviewed settings with immutable history and fail-closed timing
  files: prisma/**, src/server/modules/settings/**, src/server/modules/audit/**, src/server/lib/**, src/shared/contracts/**, src/app/api/admin/settings/**, tests/**
  approach: consistent reads and canonical review digests; security and station locks; whole-settings CAS; atomic immutable version, typed history, audit v2 and domain receipt; authorized replay before stale guards
  tests: real PostgreSQL unset values, side-effect-free review, digest binding, stale and concurrent confirms, replay conflicts, live permission revocation, rollback, immutable versions and audit validation; timing 409 and retention never deletes
  risks: settings affect future campaign qualification; WHR-55 stays unconfigured; no timing provisioning or deletion activation; no board defaults
invariants: [I-07, I-09, I-41, I-45, I-45a, I-51]
p1: ["fixed pre-upgrade campaign evidence projection compatibility"]
tickets: []
---

Plan committed before implementation at af6ed79. High risk; three review rounds.
Six endpoints implement reads/history, canonical side-effect-free review, locked
CAS confirmation, immutable full versions, typed history, audit v2 and receipts.
Timing stays unconfigured pending WHR-55. Retention records intent only;
deletionEnabled is always false and no deletion route or board defaults exist.
Independent PostgreSQL tests caught database audit-v2 admission, legacy campaign
pointer initialization and malformed-v2 safe projection issues before review.
Round 1 found retention versions contaminating timing history and withholding
valid sale credit. Shared timing lineage now excludes retention while detecting
missing station versions; actual sync and P-25 regressions cover both readers.
Round 2 found added snapshot fields invalidating pre-upgrade derived evidence.
Explicit historical projections retain source identity; metadata stays outside
persisted snapshots. Reuse and one-microsecond tamper regressions pass.
Round 3 code, security and integrity verdicts all PASS at reviewed_head.
Each review round left its head and worktree unchanged. No findings remain open.
Dispatch flag: 13 exceeds the high-tier flag of 8 because the independent tester,
two builder fix rounds and all three reviewers were retained through three rounds.
No STATUS, coverage-map or lane files changed, per WHR-63 and the session request.
