---
branch: core/wo-1b-evidence
linear: WHR-41
tier: high
reviewed_head: f14d6b620e296f623160b957f79e75e2c137b463
rounds: 1
builder: platform-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 4
plan:
  goal: ignore unrelated staging changes after review while detecting changed PR files
  files: scripts/review/validate-evidence.sh, scripts/review/test-review.sh, .review/README.md
  approach: intersect post-review changed paths with base...head paths; preserve ancestor and plan checks
  tests: unrelated staging merge passes; merge changing PR file fails; later commit fails; full gates and guard self-tests
  risks: accidental relaxation of review enforcement; macOS bash 3.2 compatibility
invariants: []
p1: []
tickets: []
---

Round 1: independent code, security and integrity reviewers PASS at f14d6b6; no findings.
Builder e2ab69d implements the approved intersection and one-line escaped-bug gotcha.
RED: 38 passed, 1 failed (unrelated staging merge). GREEN: review 39/39; guard 94/94.
EM reran /bin/bash (3.2.57) self-tests; typecheck, lint, unit 18/18 and build pass.
No server/schema or user-flow change; CI still runs integration and e2e.
WHR-3 and WHR-44 accepted by Earl; acceptance close-out docs bundled.
