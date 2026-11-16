---
branch: app/wo-8b-two-person-release
linear: WHR-171
tier: high
reviewed_head: 9cc7eef
rounds: 0
builder: frontend-engineer
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: implement approved two-person stuck-hold release screens R0–R18 and complete pending discovery
  files: src/client/admin-release*, src/ui/admin/**, src/styles/**, tests/**, docs/briefs/**, docs/qa/**, playwright.release.config.ts
  approach: consume unchanged WHR-153 and WHR-164 strict endpoints; gate proposal entry on positive preparation and live access; preserve frozen operation retries and server-owned credit
  tests: exact decimal and range validation, admission and access denial, upload and lost-response replay, independent decisions, complete stale queue, real-stack v2 and unconfigured R17, fidelity at 1440/390/360
  risks: protected photo lifetime, same-person exclusion, stale guards, accidental credit claims, hidden pending blockers; no runtime activation or endpoint changes
invariants: [I-07, I-11, I-25, I-26, I-35, I-39, I-41, I-46, I-48, I-49]
p1: []
tickets: []
---
Plan committed before builder dispatch. Approval: WHR-161 and Earl's WHR-171 session go.
