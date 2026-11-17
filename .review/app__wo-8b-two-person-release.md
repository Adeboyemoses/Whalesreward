---
branch: app/wo-8b-two-person-release
linear: WHR-171
tier: high
reviewed_head: 1eefd75820cb99f26f116eeae504a8c49526db5b
rounds: 2
builder: frontend-engineer
reviewers:
  code-reviewer: PASS (round 2)
  security-reviewer: PASS (round 2)
  integrity-reviewer: PASS (round 2)
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 13
plan:
  goal: implement approved two-person stuck-hold release screens R0–R18 and complete pending discovery
  files: src/client/admin-release*, src/ui/admin/**, src/styles/**, tests/**, docs/briefs/**, docs/qa/**, playwright.release.config.ts
  approach: consume unchanged WHR-153 and WHR-164 strict endpoints; gate proposal entry on positive preparation and live access; preserve frozen operation retries and server-owned credit
  tests: exact decimal and range validation, admission and access denial, upload and lost-response replay, independent decisions, complete stale queue, real-stack v2 and unconfigured R17, fidelity at 1440/390/360
  risks: protected photo lifetime, same-person exclusion, stale guards, accidental credit claims, hidden pending blockers; no runtime activation or endpoint changes
invariants: [I-07, I-11, I-25, I-26, I-35, I-39, I-41, I-46, I-48, I-49]
p1: ["fixed fresh preparation after terminal decisions", "fixed surrounding sale status history and actions", "fixed unsent approval confirmation after photo expiry"]
tickets: [WHR-176]
---
Source reviewed independently in two rounds. All three P1 app findings are fixed.
Source typecheck, lint (four dynamic-image warnings), 997 unit tests and build pass.
Review gate self-test: 53 passed; guard self-test: 94 passed.
Real HTTP: seven cases fail at the unchanged core UUIDv4/UUIDv7 mismatch, WHR-176.
EM independently reproduced reserve201 followed by upload-url400 on the final source.
Native Chromium and Firefox fail before browser test bodies; no UI pass is claimed.
39 isolated release cases plus ordinary R17 are committed; browser/fidelity remain unverified.
No PNGs exist yet. CI retains fictional capture artifacts for independent inspection.
This is source review evidence only. Draft PR must not merge or claim READY until
WHR-176 is fixed separately and all real-stack/browser/fidelity gates pass.
Dispatch count exceeds the high-tier flag of eight; review stayed within round cap three.
No endpoint/schema/runtime policy or STATUS/coverage/lane file changed.
