---
branch: app/wo-17-review-screens
linear: WHR-17
tier: high
reviewed_head: pending
rounds: 0
builder: frontend-engineer
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: Ship guarded admin duplicate and independent hold review screens plus own-attendant held status against WO-core-9 and WO-core-9a.
  files: src/client/admin-review*, src/ui/admin/*, src/app/(attendant)/**, src/styles/**, tests/**, docs/briefs/**, docs/qa/**
  approach: Reuse strict contracts and current session guards; latest-read versions and frozen same-operation retries; API-only evidence references; no meter correction or price cancellation.
  tests: Unit request/retry boundaries; real-stack Playwright decisions, permissions, stale versions, remaining holds and lost responses; independent 1440px and A14 390/360px fidelity.
  risks: Decisions can cancel sales or release credit; stale guards, uncertain sends, permission changes and insufficient evidence must fail closed without changing operation identity.
invariants: [I-07, I-09, I-22, I-26, I-31, I-33, I-34, I-39]
p1: []
tickets: []
---

Approved WHR-17. High risk raised above path-only routing. Review cap 3.
No STATUS, coverage-map or lane-file edits per WHR-63 and Earl's instruction.
