---
branch: app/WHR-132-meter-correction
linear: WHR-132
tier: high
reviewed_head: pending
rounds: 0
builder: frontend-engineer
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: Enable exact independent meter amount and quantity transcription with private full-size evidence and guarded review-confirm on price holds.
  files: src/client/admin-review*, src/ui/admin/**, src/styles/app.css, tests/**, playwright.config.ts, docs/briefs/**, docs/qa/**
  approach: Extend the existing strict price decision and frozen retry flow using shared exact parsers; never derive either field or imply credit before the server; preserve price cancellation unavailability.
  tests: Exact decimals and captured precision; unchanged/invalid inputs; real-stack approved test profile passing and failing pairs; policy/rate/allowance and stale refusals; lost-response same-operation retry; independent S04 fidelity at 1440px.
  risks: Incorrect parsing or reconstructed values could miscredit a sale; changed guards or keys on uncertain retries could duplicate decisions; private evidence and session authority must stay scoped; fixture meter profiles never authorize deployed policy.
invariants: [I-07, I-09, I-26, I-29, I-31, I-35, I-39, I-41, I-48]
p1: []
tickets: []
---

Approved WHR-132, high tier, three-round cap. Scope is the P-26 app follow-up only.
No STATUS, coverage or lane-file edits per WHR-63 and Earl's instruction.
