---
branch: app/wo-17-review-screens
linear: WHR-17
tier: high
reviewed_head: 180436b987ac9b2f573c4cbab8bce03a80e39bf1
rounds: 2
builder: frontend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 14
plan:
  goal: Ship guarded admin duplicate and independent hold review screens plus own-attendant held status against WO-core-9 and WO-core-9a.
  files: src/client/admin-review*, src/ui/admin/*, src/app/(attendant)/**, src/styles/**, tests/**, playwright.config.ts, docs/briefs/**, docs/qa/**
  approach: Reuse strict contracts and current session guards; latest-read versions and frozen same-operation retries; API-only evidence references; no meter correction or price cancellation.
  tests: Unit request/retry boundaries; real-stack Playwright decisions, permissions, stale versions, remaining holds and lost responses; independent 1440px and A14 390/360px fidelity.
  risks: Decisions can cancel sales or release credit; stale guards, uncertain sends, permission changes and insufficient evidence must fail closed without changing operation identity.
invariants: [I-07, I-09, I-22, I-26, I-31, I-33, I-34, I-35, I-39, I-40]
p1: ["fixed historical cancelled duplicate pairs: reject new decisions, retain frozen replay"]
tickets: [WHR-117, WHR-123]
---

Approved WHR-17; high risk, two rounds within the three-round cap.
Round 1 code review found new decisions remained enabled for a historical pair with a cancelled member.
Round 2 confirms the UI and adapter reject those new decisions while existing frozen operations still replay.
The real-browser regression loses a committed cancellation response, leaves and returns, retries the identical operation, and asserts one decision plus read-only historical pairs from either member.
Security and integrity passed both rounds; code passed round 2. All reviewers saw the final reviewed head; the EM checked the head and clean worktree after each round.
Fidelity checking fixed stale post-decision status, A14 summary hierarchy, capture heading layout and narrow-screen action overlap. Nine captures and the independent report are in tests/design-parity/reviews/.
EM final-head typecheck, lint, 687 unit tests and production build pass; lint retains two pre-existing image warnings.
EM final-head full real-stack browser gate: 296 passed, four existing staging-only skips, zero failures and no retries (9.3 minutes).
The local browser harness uses a fixture evidence policy and isolated card batches; no deployed policy was activated.
Native macOS browser restrictions required a clean Linux runner for the full suite, including persistent-browser and local-port tests.
WHR-117 tracks absent replacement read context; WHR-123 tracks an inherited preview-navigation test race observed in the temporary remote-browser harness.
Dispatch flag exceeded: 14 calls cover builders, independent tests/fidelity, fixture diagnosis/fixes and two formal review rounds; no over-cap escalation was needed.
No STATUS, coverage-map or lane-file edits in this feature diff, per WHR-63 and Earl's instruction.
