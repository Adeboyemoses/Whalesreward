---
branch: core/WHR-217-canonical-identifiers
linear: WHR-217
tier: high
reviewed_head: 4c283e3f7e28b35a7cabe31595d2da99b939b613
rounds: 2
builder: backend-engineer
reviewers:
  code-reviewer: PASS (round 2)
  security-reviewer: PASS (round 2)
  integrity-reviewer: PASS (round 2)
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 9
plan:
  goal: restore canonical UUIDv7 generation throughout persisted and public identifier paths
  files: prisma/migrations/**, src/server/**, scripts/**, tests/**, .github/workflows/ci.yml, package.json, docs/engineering/**, .codex/agents/platform-engineer.toml
  approach: additive SQL generator and supersession repair; explicit legacy preservation; repo-wide generator sweep and narrow non-ID allowlist guard
  tests: unchanged T2 strict regression, real HTTP supersede/detail/list, UUID version and variant, historical link preservation, guard adversarial self-tests, full required gates
  risks: immutable audit links and migration history must stay intact; legacy v4 values require explicit handling without contract relaxation
invariants: [I-07, I-41, I-46, I-48]
p1: ["fixed SQL line-comment guard bypass with adversarial tests", "fixed schema-local rollback assertion against migrated public"]
tickets: [WHR-218]
---

Commissioned by Earl on 20 Nov 2026, five numbered items on WHR-217.
Base: latest origin/staging 5ff40e0. Feature excludes STATUS, coverage-map and lanes.
Backend builder supplied migration and HTTP/integration regressions; platform builder
supplied the guard, allowlist, fixture sweep and mandatory escape gotcha.
Round 1 found the SQL line-comment guard gap and public-schema test lookup defect;
both were reproduced and fixed. Plan paths now name the mandatory agent gotcha.
Code, security and integrity independently passed round 2 at reviewed_head.
No production contract or TypeScript API projection changed.
Legacy supersession/backfill v4 rows explicitly block migration with counts inside
one transaction; original IDs, audit links, exclusions and snapshots are preserved.
The sweep and every retained non-ID exception are documented under docs/engineering.
Unchanged T2 regression: canonical audit-ID assertion passes, schema issues empty;
a later parked-app exact-text mismatch is tracked separately as WHR-218. Whole-test
green is not claimed. Test and app files remain unchanged in the core feature.
Dispatch count exceeds the high-tier flag (9 > 8): two builders, one guard fix
follow-up, and two rounds of three independent reviewers; round cap stays 3.
EM verification: typecheck, lint and production build PASS; 997 unit PASS;
1546 integration PASS in a clean full run against disposable PG16 whr_test;
26 guard self-tests PASS; 814 tracked sources scanned with 12 exact exceptions;
review gate 53 and hook guard 94 PASS; time suite 5 PASS in each of two zones.
Real compiled HTTP strict supersede/detail/list 1 PASS; full browser suite
434 PASS, 4 intentional skips and 2 transient failures; both failures then
PASS on isolated serial rerun (436 cases verified). Chromium used local Docker
because native macOS launch is sandbox-blocked. No test assertion was loosened.
