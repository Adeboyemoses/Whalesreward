---
branch: core/WHR-111-review-evidence
linear: WHR-111
tier: high
reviewed_head: 21a5904f03b10a2e8c06e4a0879730950866b2fe
rounds: 2
builder: backend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 14
plan:
  goal: implement normative review-evidence-v1 and protected reviewEvidence health status
  files: prisma/**, src/server/**, src/shared/**, src/app/api/**, scripts/**, tests/**, docs/ops/**
  approach: fixed bounded resolvers and immutable release artifact; scoped append-only policy approvals and revisions; pin and serialize policy/history through decision commit; protected atomic evaluation provenance
  tests: real-Postgres RE-01 through RE-21 from amended m3 including equality boundaries, invalid histories, cycles, authority, deactivation races, replay and health privacy
  risks: evidence must never create facts or bypass independent gates; rollout remains inactive until Earl provisions approved configuration
invariants: [I-07, I-09, I-22, I-26, I-31, I-33, I-34, I-35, I-39, I-41, I-45a, I-46]
p1: ["fixed stored receipt microsecond comparison", "fixed typed frozen lookup dependency traversal"]
tickets: []
---
Plan committed before builders. Implements P-25 fixed resolvers, exact intervals, approved policy pinning, protected provenance and the twelve-status health projection.
Round 1 found two P1s: a retained card query rounded receipt time, and nested frozen lookup dependencies reached a UUID query. Both have failing-before/passing-after PostgreSQL regressions.
Round 2: code, security and integrity PASS on the reviewed head; reviewers made no changes. No open findings.
EM verification: typecheck, lint (two existing image warnings), 678 unit tests, build, 688 PostgreSQL tests, five time tests in each timezone, 276 browser tests (four existing skips), and one signed-upload browser test passed. Guard self-tests: 53 and 94 passed.
Full local integration uses maxWorkers=2 after unrestricted concurrent builds caused test harness timeouts; test deadlines and production guards are unchanged. The health storage-fault fixture also prevents public-schema fallback.
RE-01 through RE-21 names are indexed in tests/integration/review-evidence-matrix.md; five additional precision and multi-hop regressions are in review-evidence-regressions.test.ts.
Price cancel and correct_meter stay refused. No runtime activation or cloud, STATUS, coverage-map or lane changes. Staging configuration and immutable approval provisioning are documented in docs/ops/review-evidence.md.
Dispatch flag: 14 exceeds the high-tier flag of 8 because policy/resolver/test work and adversarial/fixture verification were split, followed by two full review rounds. No round-cap escalation.
