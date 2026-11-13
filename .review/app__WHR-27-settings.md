---
branch: app/WHR-27-settings
linear: WHR-27
tier: high
reviewed_head: 86cfecc
rounds: 0
builder: frontend-engineer
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: implement approved admin settings screens against merged WO-core-14 routes
  files: src/client/admin-settings*, src/ui/admin/settings*, src/ui/admin route wiring, tests/e2e/settings*, tests/design-parity/settings, docs/briefs/admin-row-14-settings.md, docs/qa/smoke-2026-11-13-settings.md
  approach: server-authoritative reads and retention review-confirm with immutable retry identity; timing locked until WHR-55; existing shell and design tokens
  tests: strict API decoding, null and invalid days, stale review and version conflict, lost response retry, permissions, real-stack Playwright, independent 1440px fidelity
  risks: ambiguous confirmation must retain identity; no timing mutation or automatic deletion; no board defaults or persistent sensitive browser state
invariants: [I-07, I-11, I-45, I-51]
p1: []
tickets: []
---
Implementation plan committed before builder dispatch. Final evidence pending.
