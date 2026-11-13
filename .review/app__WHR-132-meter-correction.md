---
branch: app/WHR-132-meter-correction
linear: WHR-132
tier: high
reviewed_head: 910fe6ac4ac07cc4e9f0ef626012218a209aa30e
rounds: 1
builder: frontend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 7
plan:
  goal: Enable exact independent meter amount and quantity transcription with private full-size evidence and guarded review-confirm on price holds.
  files: src/client/admin-review*, src/ui/admin/**, src/styles/app.css, tests/**, playwright.config.ts, docs/briefs/**, docs/qa/**
  approach: Extend the existing strict price decision and frozen retry flow using shared exact parsers; never derive either field or imply credit before the server; preserve price cancellation unavailability.
  tests: Exact decimals and captured precision; unchanged/invalid inputs; real-stack approved test profile passing and failing pairs; policy/rate/allowance and stale refusals; lost-response same-operation retry; independent S04 fidelity at 1440px.
  risks: Incorrect parsing or reconstructed values could miscredit a sale; changed guards or keys on uncertain retries could duplicate decisions; private evidence and session authority must stay scoped; fixture meter profiles never authorize deployed policy.
invariants: [I-07, I-09, I-26, I-29, I-31, I-35, I-39, I-41, I-48]
p1: []
tickets: [WHR-136, WHR-137]
---

Approved WHR-132, high tier, one formal round within the three-round cap.
Exact independent meter amount and quantity use shared helpers, captured precision/unit and existing guarded price decisions.
No reading, rate or suggestion is derived. Price cancellation remains unavailable.
Frozen same-operation retries preserve submitted strings and guards; server no_change remains authoritative when a staged candidate is absent from the read API.
Meter policy, rate/allowance, unchanged-pair and stale outcomes use plain wording. Credit remains conditional on every other check.
Code, security and integrity reviewers PASS at 910fe6a with no blocking findings.
The EM verified unchanged HEAD and a clean worktree after the round.
Code's P2 customer-scope navigation finding is ticketed as WHR-136; it does not alter values, evidence or credit.
Independent S04 fidelity PASS after fixing the initial tall left-column form into a compact editor/photo row and full-width review sheet.
Original/submitted pairs remain visible during confirmation; final captures/report are in tests/design-parity/meter-correction/.
Baseline real-browser red confirmed the editor input was absent before implementation.
Five focused real-stack browser tests PASS: reconciled pair/revision with remaining date hold, outside-allowance refusal, stale guard, no_change plus lost-response exact replay, and invalid/reasonless input.
EM final-head typecheck, lint, 862 unit tests and production build PASS; two inherited image lint warnings remain.
Initial full Linux run: 337 passed, four existing skips, one transient sync 503 in an inherited sale/photo fixture. It passed unchanged alone; WHR-137 tracks investigation.
EM final fresh-database Linux browser gate: 338 passed, four existing staging-only skips, zero failures and no retries (6.1 minutes, two workers).
Additional signed-upload browser storage gate: one passed.
Fictional approved test meter profiles include protected approvals and artifact bindings; no deployed policy was activated.
No server/schema/shared-helper changes, and no STATUS, coverage or lane-file edits per WHR-63.
Earl's end-of-M3 smoke remains the acceptance gate; smoke runbook: docs/qa/smoke-2026-11-13-meter-correction.md.
