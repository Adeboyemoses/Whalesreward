---
branch: core/wo-2-schema
linear: WHR-3
tier: high
reviewed_head: deb5d0d36c77d2575ea52fdaff8ba910f7a00918
rounds: 2
builder: backend-engineer
reviewers:
  code-reviewer: PASS (round 2)
  security-reviewer: PASS (round 2)
  integrity-reviewer: PASS (round 2)
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 10
plan:
  goal: implement merged data model plus exact arithmetic and trusted time foundations
  files: prisma/**, src/shared/{money,quantity}*, src/server/lib/**, tests/**, package.json, pnpm-lock.yaml, vitest.config.ts
  approach: Prisma entity mapping with reviewed SQL constraints and immutable guards; exact bigint arithmetic; explicit Lagos instants; fictional idempotent seed
  tests: PostgreSQL constraints and concurrency; money quantity properties; midnight under UTC and America/New_York; logger redaction; UUIDv7; full gates
  risks: circular references and deferred guards; arithmetic overflow and rounding; auth shapes provisional with no auth wiring; open capture and campaign policies never grant credit
invariants: [I-29, I-37, I-44]
p1: [fixed exact SQL amount-mode rounding at BIGINT boundaries]
tickets: []
---
Schema foundations and exact helpers implement WHR-3 without endpoints, auth wiring or UI.
Round 1 found SQL numeric division rounded before the quantity rounding step.
Round 2 verified exact scaled quotient/remainder checks for purchases and revisions.
Regression evidence: prior migration 4 failed / 34 passed; fixed guard suite 38 passed.
All three independent reviewers PASS at reviewed_head; no open findings.
EM fresh migrations, seed twice, typecheck, lint, unit 14, time 3 per timezone,
build and integration 48 passed. Full application services remain for later work orders.
Dispatch flag: 10 exceeds the high-tier flag of 8 (three builders, six reviews, one fix).
