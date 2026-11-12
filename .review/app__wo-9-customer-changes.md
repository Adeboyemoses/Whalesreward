---
branch: app/wo-9-customer-changes
linear: WHR-19
tier: high
reviewed_head: 38091c017dbc57a7c281e7864ae9ff1f3f7b768c
rounds: 2
builder: frontend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 14
plan:
  goal: deliver C02-C05 customer identity change flows against WO-core-10
  files: src/shared/phone.ts, src/server/adapters/phone.ts, src/client/customer-recovery*, src/ui/admin/customer*, src/app/(admin)/admin/customers/**, tests/**, docs/briefs/**, docs/qa/**
  approach: validated real endpoints with live session guards, frozen review versions and operation replay, transient verification input, masked receipts and intake-only fallback
  tests: real-stack Playwright with local server adapter, permission and stale-version failures, uncertain retries, secret clearing, unconfigured fallback, 1440px fidelity, existing phone normalization parity
  risks: identity changes require current customer and card versions; no secret persistence; manager intake must not mutate identity; no provider or stranded-phone scope; shared helper extraction retains server phone policy
invariants: [I-07, I-09, I-15, I-19, I-21, I-21a, I-41, I-49]
p1: ["fixed canceled verification preflight dispatch with live guard and red-green browser regression"]
tickets: [WHR-113]
---
C02-C05 now use WO-core-10 endpoints with card-present phone change, verified lost-card replacement, intake-only fallback, and masked historical receipts.
Round 1 code review found delayed context completion could dispatch issuance after navigation; fixed before issuance, with real-response regression proving one request/challenge before and zero after. Intake review now uses future tense. All three reviewers passed round 2 at the reviewed head; worktree and head stayed unchanged during review.
Core approved the behavior-preserving shared phone extraction at 6ac7a6f. No endpoint policy or server identity semantics changed.
EM final checks: typecheck, lint (two existing image warnings), 810 unit tests, build; Linux PostgreSQL integration 775/775 on a fresh isolated DB; full Linux browser suite 302 passed, four existing skips, two workers and zero retries.
Independent fidelity: two checks, 12 screenshots/metrics at 1440 and 390 px, no remaining fix-severity differences. See tests/design-parity/customer-changes/REPORT.md.
Configured C03 tests bridge only to the real service/PostgreSQL with the ephemeral server test adapter; ordinary paths and unconfigured fallback use real HTTP. No production adapter toggle or secret fixture/trace was added.
Native browser sandbox and intermittent integration fixture timeouts are documented; WHR-113 tracks the latter. Final fresh, isolated Linux integration passed without assertion or timeout changes.
Dispatch flag exceeded: 14 includes frontend/test work, adapter exploration, core boundary review, fidelity fixes, diagnosis/regression work and two rounds of three independent reviewers.
No STATUS, coverage or lane edits; no stranded-phone recovery, manager final decision, provider or cloud changes. Smoke runbook: docs/qa/smoke-2026-11-13-customer-changes.md.
