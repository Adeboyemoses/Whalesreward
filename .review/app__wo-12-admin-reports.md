---
branch: app/wo-12-admin-reports
linear: WHR-25
tier: high
reviewed_head: c298be86b58b4d52589a2dd26f25e416664a99f1
rounds: 2
builder: frontend-engineer
reviewers:
  code-reviewer: PASS (round 2)
  security-reviewer: PASS (round 2)
  integrity-reviewer: PASS (round 2)
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 10
plan:
  goal: Build honest permission-gated overview and generation-consistent admin reports and exports
  files: src/client/admin-reports-api*, src/ui/admin/reports*, src/ui/admin/overview*, src/app/(admin)/**, src/styles/app.css, tests/e2e/reports*, tests/design-parity/reports/**
  approach: Reuse merged WHR-24 schemas and endpoints; exact shared formatting; discard invalidated reads; freeze export request identity across uncertain retries; render configuration nulls honestly
  tests: Adapter failure and replay tests; real-stack Playwright for filters, buckets, source date basis, pagination, stale generation, permissions and export lifecycle; independent 1440px fidelity; final typecheck lint unit build e2e gates
  risks: Stale asynchronous responses, changed generations, permission revocation, uncertain export effects, floating precision and board sample data must never produce misleading figures
invariants: [I-07, I-09, I-29, I-40, I-42, I-44, I-45]
p1: ["fixed refresh resets paging state; source/group delayed-response regressions red then green"]
tickets: []
---
B02 overview and E05–E07 reports use the merged WHR-24 server unchanged. Runtime figures
come from current authorized responses, with explicit unset launch, date basis and exclusions.
Filters invalidate old views; groups, sources and immutable exports bind the viewed generation.
Shared exact aggregate helpers keep currencies, litres and kilograms separate. Uncertain export
preparation retains its frozen body/key; failed or expired files require a new preparation.

Independent fidelity fixed four presentation findings. Six final PNGs/metrics at 1440/390 px
have no unresolved blocking/fix findings; fixture differences and contract metadata are documented.
Local fixtures now append restoration versions for prior live catalog metadata without rewriting history.

Round 1: security and integrity PASS. Code found one P1: refresh during pending pagination
left controls locked. The two-line reset fixes it. Two source/group tests failed on the original;
all four desktop/phone cases passed unchanged after the fix and reject obsolete response publication.
Round 2: code, security and integrity PASS at reviewed_head, all blocking counts zero.
Worktree/head were unchanged after each review round. Ten dispatches exceeds the high-tier flag;
this includes the independent fidelity corrections and explicit red/green test follow-up.

EM final-head typecheck, lint (two inherited image warnings), 878 unit tests and build PASS.
Focused real-stack suite: 20 PASS; refresh regressions: 4 PASS; fidelity capture: 1 PASS.
Full serial production browser regression: 384 PASS, four existing staging-only skips, zero failures/retries (11.4 minutes), from a fresh local database. The initial reused-fixture run and pre-fix run were stopped; only this final-head full run is claimed.
No server, shared contract, campaign values, staging data or feature-PR status records changed.
