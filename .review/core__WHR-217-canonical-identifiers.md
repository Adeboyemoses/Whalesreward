---
branch: core/WHR-217-canonical-identifiers
linear: WHR-217
tier: high
reviewed_head: 5ff40e0
rounds: 0
builder: backend-engineer
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: restore canonical UUIDv7 generation throughout persisted and public identifier paths
  files: prisma/migrations/**, src/server/**, scripts/**, tests/**, .github/workflows/ci.yml, package.json, docs/engineering/**
  approach: additive SQL generator and supersession repair; explicit legacy preservation; repo-wide generator sweep and narrow non-ID allowlist guard
  tests: unchanged T2 strict regression, real HTTP supersede/detail/list, UUID version and variant, historical link preservation, guard adversarial self-tests, full required gates
  risks: immutable audit links and migration history must stay intact; legacy v4 values require explicit handling without contract relaxation
invariants: [I-07, I-41, I-46, I-48]
p1: []
tickets: []
---

Commissioned by Earl on 20 Nov 2026, five numbered items on WHR-217.
Base: latest origin/staging 5ff40e0. Feature excludes STATUS, coverage-map and lanes.
Builders reproduce before fixing, preserve published contracts and historical migrations,
and report every generator, including fixture and non-ID uses.
