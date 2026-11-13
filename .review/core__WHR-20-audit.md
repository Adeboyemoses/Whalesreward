---
branch: core/WHR-20-audit
linear: WHR-20
tier: high
reviewed_head: 607fa03b5a0270fddb1f6e0d3ae2d29907b52546
rounds: 3
builder: backend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 20
plan:
  goal: Implement amended M3 audit search and detail and AU-01 through AU-10 without rewriting historical rows.
  files: src/shared/contracts/audit.ts, src/server/modules/audit/**, src/app/api/admin/audit/**, prisma/**, existing domain audit writers, scripts/ops/review-evidence.mjs, tests/**
  approach: Strict typed action-specific persistence with immutable snapshots, independent safe historical projection, live scoped authorization, bounded keyset search, append-only database guards and atomic domain events.
  tests: Real PostgreSQL authorization, Lagos bounds, cursor binding, snapshots, append-only guards, writer replay and rollback, operator and export fencing, and seeded privacy canaries across storage responses and logs.
  risks: Preserve credit and evidence resolver semantics, exact committed boundaries, historical rows and protected provenance; never expose credentials or unrestricted notes.
invariants: [I-07, I-09, I-18, I-22, I-26, I-31, I-35, I-39, I-40, I-41]
p1:
  - fixed privacy canaries through shared persistence and independent historical projection checks
  - fixed historical station proof using retained immutable relationships without rewriting rows
  - fixed numeric operational reasons and bounded password lifecycle narratives
  - fixed registration audit station from authenticated capture context
tickets: []
---
Implements amended M3 search/detail and AU-01 through AU-10 existing writers with typed AuditChange values.
Canonical writes share domain transactions; legacy rows remain byte-for-byte unchanged.
Round 1 found privacy gaps, incomplete legacy station proofs, operational reason rejection and registration context loss.
The builder fixed these and inherited-property action/target handling; all three reviewers passed round 2.
Full gates then exposed a valid password lifecycle narrative rejected by the privacy check.
A bounded grammar fix and negative regression tests preserve both that narrative and sensitive-value rejection.
The 102-sale duplicate stress test retains every assertion with a bounded 120-second allowance for 5,151 audited pairs.
All three independent reviewers returned PASS on the final reviewed head in round 3; no open findings remain.
EM verified clean worktree and unchanged reviewed head after reviews.
Final gates: typecheck, lint, build and 834 unit tests passed; PostgreSQL 1,017 tests across 46 files passed.
Timezone verification passed all five tests in both UTC and America/New_York.
Browser verification: 302 passed, four existing conditional skips, in Linux Playwright with Node 26.12.0.
Native Chromium was blocked by macOS MachPort permissions; the Docker browser run used identical production/browser sources.
Only the integration stress-test timeout/comment changed after the browser run began.
Named audit verification: tests/integration/audit-verification.md; actual handlers capture canaries across storage, responses and process logs.
No STATUS, coverage-map or lane edits; queue-recovery writers remain with their unbuilt implementation dependency.
Dispatch flag: 20 exceeds the high-tier threshold of eight due to resumed builders, independent tests and three review rounds.
Session metric: dispatches=20 prs=1 rounds_max=3 escalations=0 model=unavailable
