---
branch: core/wo-14b-campaign-timing
linear: WHR-150
tier: high
reviewed_head: 9780c30ca45f2c712999efe8d9b34cbf8b9b382d
rounds: 3
builder: backend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 13
plan:
  goal: Implement approved P-28 Owner campaign creation and pre-start timing through existing Settings endpoints.
  files: prisma/**, src/shared/contracts/{settings,audit}*, src/server/modules/{settings,health,audit,sync,reviews}/**, station bootstrap, tests/**
  approach: Immutable registered campaign-timing-v1 with station binding; security then reporting then campaign locks; receipt-first replay; locked fresh clock; atomic settings/history/audit/generation.
  tests: Every named core acceptance item in m4 follow-up notes, non-superuser registry constraints, lineage regressions, full gates and time suite.
  risks: Owner revocation and replay, absent campaign races, start crossed waiting on locks, legacy incomplete history, retention pins, policy mismatch, public health redaction.
invariants: [I-07, I-08, I-09, I-11, I-22, I-28, I-41, I-45, I-45a, I-46, I-51]
p1:
  - fixed named IANA validation in Settings and audit with review/confirm regressions
  - fixed precision and representation aliases before receipt comparison with exact UTC boundary regressions
tickets: []
---

Normative design and acceptance checklist: docs/engineering/contracts/m4.md,
Owner setup through Follow-up impact notes; operations.md and data-model.md P-28.
Use the existing Settings review/confirm protocol rather than a new provisioning route.
No campaign values, cloud operations, real databases, screens or feature-PR status records.

All three independent reviewers PASS at reviewed_head in round 3; no open findings.
Round 1 fixed numeric-offset timezone acceptance and submicrosecond replay aliases.
Round 2 fixed unsupported PostgreSQL input and UTC year-boundary handling.
New invalid requests fail with timing_invalid; changed retained keys conflict without
aborting or replaying a different request. Supported microsecond offset retries match.
Disposable fixture resets drain in-flight entry transactions before suspending their
local guards; actual PostgreSQL deadlock regressions preserve production guards.
Named acceptance mapping is tests/integration/p28-acceptance.md.
EM final-head typecheck, lint, build, Prisma validation, unit 871, PostgreSQL 1154
and timezone 5+5 PASS. Local integration uses one worker with unchanged timeouts.
Linux Playwright 360 PASS, four existing skips, two workers and zero retries.
