---
branch: app/WHR-25-admin-reports
linear: WHR-25
tier: high
reviewed_head: 7521d68
rounds: 0
builder: frontend-engineer
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: Build honest permission-gated overview and generation-consistent admin reports and exports
  files: src/client/admin-reports-api*, src/ui/admin/reports*, src/ui/admin/overview*, src/app/(admin)/**, src/styles/app.css, tests/e2e/reports*, tests/design-parity/reports/**
  approach: Reuse merged WHR-24 schemas and endpoints; exact shared formatting; discard invalidated reads; freeze export request identity across uncertain retries; render configuration nulls honestly
  tests: Adapter failure and replay tests; real-stack Playwright for filters, buckets, source date basis, pagination, stale generation, permissions and export lifecycle; independent 1440px fidelity; final typecheck lint unit build e2e gates
  risks: Stale asynchronous responses, changed generations, permission revocation, uncertain export effects, floating precision and board sample data must never produce misleading figures
invariants: [I-07, I-09, I-29, I-40, I-42, I-44, I-45]
p1: []
tickets: []
---
Plan committed before builder dispatch. Final review evidence is pending.
