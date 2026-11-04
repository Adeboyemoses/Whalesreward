---
branch: core/wo-2-schema
linear: WHR-3
tier: high
reviewed_head: 0000000
rounds: 0
builder: backend-engineer
reviewers:
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: implement merged data model plus exact arithmetic and trusted time foundations
  files: prisma/**, src/shared/{money,quantity}*, src/server/lib/**, tests/**, package.json, pnpm-lock.yaml, vitest.config.ts
  approach: Prisma entity mapping with reviewed SQL constraints and immutable guards; exact bigint arithmetic; explicit Lagos instants; fictional idempotent seed
  tests: PostgreSQL constraints and concurrency; money quantity properties; midnight under UTC and America/New_York; logger redaction; UUIDv7; full gates
  risks: circular references and deferred guards; arithmetic overflow and rounding; auth shapes provisional with no auth wiring; open capture and campaign policies never grant credit
invariants: [I-29, I-37, I-44]
p1: []
tickets: []
---
