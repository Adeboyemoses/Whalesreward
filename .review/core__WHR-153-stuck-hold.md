---
branch: core/WHR-153-stuck-hold
linear: WHR-153
tier: high
builder: backend-engineer
plan:
  goal: implement inactive two-person stuck-hold release under immutable review-evidence-v2
  files: prisma/**, src/server/**, src/app/api/**, src/shared/**, scripts/ops/**, docs/ops/review-evidence.md, tests/**
  approach: append-only proposals and transitions with canonical person checks, guarded admission and joint consistency, private sheet pipeline, shared giveaway generation locks and database-comment operator identity
  tests: real-Postgres SR-01 through SR-08 including SR-02a, non-superuser role checks, full existing gates and independent code/security/integrity reviews
  risks: credit and cancellation races, alias-account self-approval, evidence privacy, partial policy installation and stale giveaway snapshots; v1 remains active and meter stays unconfigured under v2
---
Implementation plan committed before builder dispatch. No activation or real database access authorized.
