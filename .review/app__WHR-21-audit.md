---
branch: app/WHR-21-audit
linear: WHR-21
tier: high
reviewed_head: pending
rounds: 0
builder: frontend-engineer
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: Browse read-only audit history with exact historical attribution and no phone disclosure
  files: src/app/(admin)/admin/audit/**, src/client/**, src/ui/**, tests/e2e/**, tests/design-parity/**, docs/briefs/**, docs/qa/**
  approach: Reuse live audit endpoints and shared format helpers; cursor stack and preserved filter state; typed changes only
  tests: Real-stack Playwright filters paging detail attribution legacy privacy and audit-only permission; G01–G05 fidelity at 1440; all mandatory gates
  risks: Cursor and stale-request races; historical actor confusion; phone disclosure; typed value context and destination permissions
invariants: [I-07, I-09, I-41]
p1: []
tickets: []
---
Precommitted plan for WHR-21. No STATUS, coverage or lane edits (WHR-63).
