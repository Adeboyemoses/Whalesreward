---
branch: app/wo-128-price-adoption
linear: WHR-128
tier: high
reviewed_head: a90436d8fd15068de2466048633df40b2afbc9e8
rounds: 2
builder: offline-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 14
plan:
  goal: Adopt current acknowledged-pump prices through existing reads while preserving composed drafts and every saved original.
  files: src/client/api*, src/client/types*, src/client/offline/**, src/app/(attendant)/**, src/ui/**, src/styles/app.css, tests/**, docs/briefs/**, docs/qa/**
  approach: Strict four-shape lookup decoding and capability header; one context-guarded transactional monotonic price adoption path for session and lookup; compose from the latest persisted price only on meaningful input; keep-and-warn UI with no refresh-only requests.
  tests: P-27 PR-T1-01 through PR-T1-12 app obligations; stale generations and two-tab ordering; populated legacy storage immutability; real phone flows and 390/360 fidelity; full unit and browser gates.
  risks: A stale response could cross accounts or roll back price; early form freezing could miss lookup refresh; late refresh could reprice a draft or saved sale; update handover and capture-window anchors must remain intact.
invariants: [I-02, I-03, I-05, I-06, I-22, I-23, I-26, I-28, I-28a, I-28b, I-29, I-31, I-32, I-39, I-45b, I-49, I-50]
p1: ["fixed photo intent reserves its snapshot before asynchronous access checks", "fixed gas notices use the contract kilogram unit"]
tickets: [WHR-129]
---

Approved WHR-128; core dependency merged as 1fce459 via PR #125 before work began.
High-tier plan committed before builder dispatch. No STATUS, coverage-map or lane edits.
Strict negotiated lookup decoding and transactional monotonic price adoption preserve authority and saved originals.
Composition uses the latest persisted price at meaningful input; open drafts retain their price and evidence.
Before formal review, a browser regression exposed a client transaction-ordering race; six unit regressions cover its fix.
Round 1 found a remaining photo-handler await race and incorrect gas units. Both are fixed, with no deferrals.
All three added browser regressions failed before the fixes and passed afterward.
Round 2 code, security and integrity reviewers all PASS at reviewed_head; worktree and head stayed unchanged during review.
The integrity reviewer independently reproduced draft V1 retained while current price adopts V2 after the fix.
EM typecheck, lint, 802 unit tests and production build PASS; two inherited admin image warnings remain.
Independent dedicated real-activation browser gate: 16 PASS, zero failures/skips/retries.
EM full local browser gate: 280 PASS, four inherited staging-only skips, zero failures/retries (8.9 minutes).
Fidelity: initial four cases plus two affected gas cases PASS; fourteen captures at 390/360 px, no new blocking drift.
Exact test scope and limitations: tests/price-adoption/verification.md and tests/design-parity/price-adoption/REPORT.md.
Inherited offline-footer wording is tracked as WHR-129; physical-phone acceptance remains Earl's M3 smoke.
Dispatch flag: 14 exceeds 8 because separate client/UI/test builders, targeted pre-review fixes, one formal fix batch and two three-reviewer rounds were required.
