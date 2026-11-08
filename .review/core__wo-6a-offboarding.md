---
branch: core/wo-6a-offboarding
linear: WHR-80
tier: high
reviewed_head: 465a9cd
rounds: 0
builder: backend-engineer
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: implement P-21 assignment ending with immediate revocation and immutable historical capture semantics
  files: src/server/**, src/shared/contracts/**, src/app/api/**, tests/integration/**, prisma/** if necessary
  approach: reuse security lock and durable Domain receipts; serialize attendant authority and assignment history before trusted termination boundary
  tests: real PostgreSQL end-reassign-sign-in-first-password-finalize races; exact guards; revoked replay; multi-device revocation; P-20 before-at-after U and old queue isolation
  risks: lock ordering and commit visibility; revoked restricted sessions; no new recovery authority, historical rewrite or renewal of original capture bounds
invariants: [I-01, I-03, I-04, I-05, I-05a, I-06, I-07, I-09, I-26, I-28, I-35, I-41, I-45a]
p1: []
tickets: []
---
Plan committed before dispatch. No completed implementation, review or verification claimed.
