---
branch: core/wo-1b-evidence
linear: WHR-41
tier: high
reviewed_head: 0000000
rounds: 0
builder: platform-engineer
reviewers:
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
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
