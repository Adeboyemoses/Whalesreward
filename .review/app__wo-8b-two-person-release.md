---
branch: app/wo-8b-two-person-release
linear: WHR-171
tier: high
reviewed_head: bb8f9f49f388bc5c7e88fe3f5d5aface8cce031a
rounds: 3
builder: frontend-engineer
reviewers:
  code-reviewer: PASS (round 3)
  security-reviewer: PASS (round 3)
  integrity-reviewer: PASS (round 3)
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 35
plan:
  goal: implement approved two-person stuck-hold release screens R0–R18 and complete pending discovery
  files: src/client/admin-release*, src/ui/admin/**, src/styles/**, tests/**, docs/briefs/**, docs/qa/**, playwright.release.config.ts
  approach: consume unchanged WHR-153 and WHR-164 strict endpoints; gate proposal entry on positive preparation and live access; preserve frozen operation retries and server-owned credit
  tests: exact decimal and range validation, admission and access denial, upload and lost-response replay, independent decisions, complete stale queue, real-stack v2 and unconfigured R17, fidelity at 1440/390/360
  risks: protected photo lifetime, same-person exclusion, stale guards, accidental credit claims, hidden pending blockers; no runtime activation or endpoint changes
invariants: [I-07, I-11, I-22, I-25, I-26, I-34, I-35, I-39, I-41, I-46, I-48, I-49]
p1: ["fixed fresh preparation after terminal decisions", "fixed surrounding sale status history and actions", "fixed unsent approval confirmation after photo expiry"]
tickets: [WHR-180, WHR-86]
---
Final code, security and integrity reviewers independently PASS frozen source/QA head.
Integrity explicitly states: "No correction hides a product or contract defect."
Changed API expectations and fixture proof: docs/qa/whr171-test-corrections.md and PR.
Core WHR-176 and WHR-181 landed separately; no app endpoint/schema workaround.
The original date immutability assertion is unchanged and now passes against WHR-181.
Capture setup proves ended-session denial, then fresh current authority while preserving
historical assignment/context, original revision, ownership and purchase guard.
Durable UI/response/image waits only; no sleeps, added retries or raised timeouts.
R11 false held copy was fixed in product source and receives an actual-credit regression.
EM final typecheck, lint (four dynamic-image warnings), 997 unit tests and build PASS.
EM independently ran all 10 real HTTP cases; final code reviewer ran 38 client tests.
Green CI 44204172724 at code 07ad8c7: 997 unit, 1,453 PostgreSQL, timezone 5+5,
42 release (10 HTTP + 32 browser), 430 ordinary browser/4 existing skips/0 flaky passes,
storage 1. Review self-test 53 and guard self-test 94 PASS.
Later changes contain QA documents/images and this evidence only; final-head CI required.
Independent test-engineer fidelity: scoped PASS, 69 fresh original PNGs at 1440/390/360.
All 23 named capture groups inspected; hashes/dimensions verified. Manual gaps explicit.
WHR-180 inherited mobile admin navigation remains visible and separately tracked.
WHR-86 inherited exact-24-hour fixture occurrence was reported; no app workaround.
Smoke: docs/qa/smoke-2026-11-17-two-person-release.md; v2 remains unconfigured (R17).
No runtime activation, physical-phone/client acceptance, STATUS/coverage/lane edits.
Dispatch count 35 exceeds high-tier flag eight; three rounds, no cap escalation.
