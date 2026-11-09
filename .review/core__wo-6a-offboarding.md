---
branch: core/wo-6a-offboarding
linear: WHR-80
tier: high
reviewed_head: 8739cbb24b2b378229c6e0655d76b2c13ea39410
rounds: 2
builder: backend-engineer
reviewers:
  code-reviewer: PASS (round 2)
  security-reviewer: PASS (round 2)
  integrity-reviewer: PASS (round 2)
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 9
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
Plan saved at8d6b114 before dispatch. All three reviewers passed the final head;
repository stayed clean and head unchanged after both rounds. No production findings.
Round2 adds explicit ready/restricted sign-in-key replay after actual offboarding,
closing a coverage limitation without production changes. Old key401, fresh valid
unassigned422, wrong credentials401, no new cookie/context/anchor or receipt mutation.
The end transaction uses live OR grants and exact guards, preserves opening history,
and atomically commits revocation, audit and historical receipt. Per-account authority
locks order protected reads and finalization against termination; no broad price lock.
Two legacy sync fixture setups now supply current assignment/fresh authority while
all original timestamps, contexts and P-20 assertions remain unchanged. Guard retained.
EM final typecheck/lint/unit260/build, real PostgreSQL201/named23 PASS. Unchanged
productionccc686e also passed time3 per timezone, Linux browser130/four existing
staging-only skips/zero retries and signed-upload1. No policy or assertion relaxed.
Named output: docs/qa/verification-2026-11-09-offboarding.md. No migration or new dependency.
Full M3 recovery/review remains future work; no new authority or UI parity claimed.
Dispatch flag: nine feature dispatches exceed eight because of final replay coverage
and scoped re-review; two rounds stay within the high-tier cap of three.
