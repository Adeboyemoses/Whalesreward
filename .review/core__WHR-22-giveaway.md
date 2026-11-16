---
branch: core/WHR-22-giveaway
linear: WHR-22
tier: high
reviewed_head: 2f6748bf6ae7ac10d05406a15fb03508f9b0c0d6
rounds: 2
builder: backend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 17
plan:
  goal: Exact leaderboards and immutable audited giveaway finalization under P-30
  files: prisma/**, src/server/**, src/shared/**, src/app/api/**, tests/**
  approach: Shared exact contribution evaluator and generation locks across all writers; versioned phone census and two-person exclusions; immutable previews and numbered snapshots
  tests: M4 downstream PostgreSQL verification including SR-06 initial revision unchanged reconciliation and concurrent writer races; full repository gates
  risks: Phantom intake and lineage changes must invalidate previews; phone exclusions must not suppress other blockers; no policy activation or seeded campaign values
invariants: [I-11, I-14, I-40, I-41, I-42, I-43, I-44, I-45, I-45a, I-46]
p1:
  - fixed partial exclusions preserve campaign timing eligibility
  - fixed exact database deadline comparison
  - fixed filtered frozen sources and cursor scope
  - fixed designation single version increment and manager eligibility
  - fixed phone audit before-values
tickets: []
---
Implementation plan follows the approved M4 contract through WO-spec-4c.
No STATUS, coverage-map or lane changes belong in this feature PR.

Round 1 found one INTEGRITY-P1 and five P1 findings; all fixed with regression tests.
Round 2 code, security and integrity PASS at reviewed_head; worktree unchanged.
Code and integrity each independently ran 24 PostgreSQL regression tests.
EM final-head typecheck, lint (two existing image warnings), 963 unit tests and build PASS.
EM real PostgreSQL integration: 74 files, 1399 tests PASS; disposable local database only.
EM time tests: 5 PASS under UTC and 5 PASS under America/New_York.
Local browser execution blocked by macOS MachPortRendezvous bootstrap permission; browser CI must pass before merge.
Named acceptance matrix: docs/qa/smoke-2026-11-16-giveaway.md.
SR-06 real approve/reject/ordinary-supersede services exercise initial/revision/unchanged reconciliation and frozen predecessors.
No station policy binding activated, campaign values seeded, real database or cloud touched.
Feature excludes STATUS, coverage-map and lanes. Dispatch count exceeds the high-tier flag due to schema/receipt/phone/snapshot/test work and fix continuations; review rounds remain within cap 3.
