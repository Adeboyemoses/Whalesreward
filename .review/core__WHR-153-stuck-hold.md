---
branch: core/WHR-153-stuck-hold
linear: WHR-153
tier: high
builder: backend-engineer
reviewed_head: a1db6f898bed148323feb51fe472bb6d6d73293b
rounds: 2
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: FAIL
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 20
invariants: [I-07, I-22, I-25, I-26, I-28, I-31, I-33, I-34, I-35, I-41, I-46, I-48]
p1: [WHR-155]
tickets: [WHR-123, WHR-155]
plan:
  goal: implement inactive two-person stuck-hold release under immutable review-evidence-v2
  files: prisma/**, src/server/**, src/app/api/**, src/shared/**, scripts/ops/**, docs/ops/review-evidence.md, tests/**
  approach: append-only proposals and transitions with canonical person checks, guarded admission and joint consistency, private sheet pipeline, shared giveaway generation locks and database-comment operator identity
  tests: real-Postgres SR-01 through SR-08 including SR-02a, non-superuser role checks, full existing gates and independent code/security/integrity reviews
  risks: credit and cancellation races, alias-account self-approval, evidence privacy, partial policy installation and stale giveaway snapshots; v1 remains active and meter stays unconfigured under v2
---
DRAFT / NOT READY. Integrity review fails acceptance because WHR-155 is unresolved.
The missing giveaway service belongs to draft WHR-22; WHR-54 policy remains unresolved.
V2 complete installation stays false; no deployment or real database activation occurred.
Round 1 found recovery admin/user identity confusion, private-reason disclosure,
synthetic lookup provenance rejection, obsolete deadline handling and missing boundary lineage.
Round 2 confirmed those code defects corrected; code/security PASS, integrity FAIL solely
for absent initial/revision/unchanged giveaway integration and executable SR-06 evidence.
EM typecheck, lint (two existing warnings), 947 unit tests, build and both timezone runs pass.
Targeted PostgreSQL suites: service 96, upload 31, policy 11, lifecycle 9, foundation 7,
consistency 2; operator 32. Positive dormant-service tests explicitly mock installation only.
Full integration/browser final runs and limitations are recorded in the PR, not claimed green here.
The browser preview-download failure also reproduces on unchanged base 09e2c86 (WHR-123).
Exact named SR evidence and remaining dependency: tests/integration/held-release-matrix.md.
No STATUS, coverage-map or lane files changed. This draft must not merge as completed work.
