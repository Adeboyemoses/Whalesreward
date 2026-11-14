---
branch: app/wo-12-admin-reports
linear: WHR-25
tier: high
reviewed_head: 8766e2db7828be8ec729dc9c5229c18fa7f8d470
rounds: 4
builder: frontend-engineer
reviewers:
  code-reviewer: PASS (round 4)
  security-reviewer: PASS (round 4)
  integrity-reviewer: PASS (round 4)
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 19
plan:
  goal: Build honest permission-gated overview and generation-consistent admin reports and exports
  files: src/client/admin-reports-api*, src/ui/admin/reports*, src/ui/admin/overview*, src/app/(admin)/**, src/styles/app.css, tests/e2e/reports*, tests/design-parity/reports/**
  approach: Reuse merged WHR-24 schemas and endpoints; exact shared formatting; discard invalidated reads; freeze export request identity across uncertain retries; render configuration nulls honestly
  tests: Adapter failure and replay tests; real-stack Playwright for filters, buckets, source date basis, pagination, stale generation, permissions and export lifecycle; independent 1440px fidelity; final typecheck lint unit build e2e gates
  risks: Stale asynchronous responses, changed generations, permission revocation, uncertain export effects, floating precision and board sample data must never produce misleading figures
invariants: [I-07, I-09, I-29, I-40, I-42, I-44, I-45]
p1: ["fixed refresh paging reset with red-green source/group regressions", "fixed WHR-149 by rejecting caller database query parameters before driver construction", "fixed terminal export test readiness race without relaxing assertions"]
tickets: []
escalation: "2026-11-14: Earl approves review round 4 for PR #141 (WHR-25), test-only: the prepared fixes at 8766e2d, with fresh code, security and integrity verdicts. If round 4 needs any product-code change, or a reviewer raises a new finding, stop, park #141 and report — no round 5."
---
B02 overview and E05–E07 reports use WHR-24 unchanged. Authorized server responses supply
all figures; unset launch stays explicit, with reported/verified date basis and exclusion labels.
Views, groups, sources and immutable exports share filters/generation. Shared exact formatting
keeps currencies, litres and kilograms separate; uncertain export retries retain the frozen body/key.

Independent fidelity resolved four presentation findings. Six final PNGs and metrics cover
1440/390 px; fixture differences and required contract metadata are documented in the report.

Round 1 found a refresh/pagination P1. Two-line reset plus delayed source/group regressions
proved red then green. Round 2 passed; CI parallel execution exposed shared fixture coupling.
Report browser workers now use separate migrated schemas and real production Next servers,
with dynamic Origin/baseURL, owned-process/schema cleanup and restored worker environment.
The mixed two-worker reports/review/sale subset passed 46 cases with public prices unchanged.
Round 3's WHR-149 test-guard query override and a terminal-test auto-poll readiness race were
fixed in prepared test-only commit 8766e2d. The six no-network guard tests proved red then green;
terminal tests wait for settled ready UI before mutating fixture metadata, keeping all assertions.

Earl's explicit 14 Nov approval above permits only round 4 at that prepared head, with no new
finding or product-code change and no round 5. All three fresh verdicts PASS with no new findings.
The worktree stayed clean and head unchanged through review. No production path changed in round 4.
Nineteen dispatches exceeds the high-tier flag; one explicit cap exception is recorded above.

EM exact reviewed-head gates: typecheck, lint (two inherited image warnings), 884 unit tests,
production build and full two-worker real-stack browser suite PASS: 384 passed, four existing
staging-only skips, zero failures/retries (6.1 minutes), on a fresh local database.
Focused browser suite 24 PASS; no-network guard 6 PASS; independent fidelity capture 1 PASS.
No reports server/shared contract, campaign value, staging data or feature status record changed.
