---
branch: spec/WHR-152-policy-settings
linear: WHR-152
tier: high
reviewed_head: 11fc363679f29ab86e98a93be010f605abcf8173
rounds: 2
builder: spec-em
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 6
plan:
  goal: declare staging duplicate-window settings and document every health policy gate
  files: .do/app.staging.yaml, docs/ops/staging.md
  approach: add only the two approved plain web runtime variables; inventory existing policy evaluators and document owners, missing-setting behavior and diagnostic limits; file application diagnostics for T1
  tests: compare parsed staging spec against base for unchanged existing variables; check all health policy names in the runbook; typecheck, lint, unit tests, build and independent code/security/integrity review
  risks: missing policy configuration can silently disable duplicate flags; health readiness is not policy activation; never include secret values or alter existing variables
invariants: [I-40]
p1: []
tickets: [WHR-154]
---

WHR-152 is limited to configuration and operations documentation. No application code,
cloud operations, STATUS, coverage-map or lane changes are authorized in this PR.

All three independent reviewers passed the final content head in round 2, with
no open findings. Round 1 code/security P2 corrected: admin receipt fallback is
v1 only, and another writer version needs an explicit matching keyring entry.
The reviewers remained read-only; the worktree was clean and head unchanged.

EM verification: typecheck, lint, 871 unit tests and production build passed.
Lint reports two inherited no-img-element warnings. A parsed-spec comparison
proved every existing field unchanged after removing the two approved variables;
all 12 health keys, lookup receipt settings and local runbook links are covered.
No server/schema or user-flow code changed, so integration/e2e are not additional
local gates. Live policy activation and smoke remain Earl's operational steps.
WHR-154 tracks application startup diagnostics for T1, awaiting approval.
