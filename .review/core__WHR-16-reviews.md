---
branch: core/WHR-16-reviews
linear: WHR-16
tier: high
reviewed_head: bbc083ef85881011e170fd4bcc0a569a51745f0b
rounds: 3
builder: backend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 20
plan:
  goal: implement P-24 advisory duplicates and evidence-bound independent review decisions
  files: prisma/**, src/server/**, src/shared/**, src/app/api/**, jobs/**, tests/**
  approach: durable bounded duplicate intents and atomic guarded decisions using shared security/reporting/purchase locks and staged candidates
  tests: real-Postgres coverage of applicable m3 Required downstream verification bullets, permissions, replay, races, evidence and resolution order
  risks: duplicate cancellation removes credit; evidence and staged candidates must not bypass independent gates
invariants: [I-22, I-26, I-31, I-33, I-34, I-35, I-40]
p1: ["fixed cancellation provenance", "fixed retryable storage failures", "fixed missing-photo adapter classification"]
tickets: [WHR-103]
---
P-24 uses durable bounded intents and station-scoped pinned policy; duplicate flags never change credit.
Five guarded review endpoints preserve original facts, staged candidates, receipts and independent gates.
Round 1 fixed cancellation provenance, stored cancelled-member reads, closed audit actions and transient storage classification.
Round 2 fixed typed missing-photo errors crossing the shared storage/reader boundary; round 3 all reviewers PASS.
Postgres tests cover the relevant M3 downstream matrix, six resolution orders, concurrency, evidence, replay and crash-safe 100-pair continuation.
correct_meter remains 409 meter_policy_unconfigured (WHR-50). Runtime evidence-dependent decisions fail closed pending WHR-103.
Plan scope deviation: src/instrumentation.ts starts the durable detector; storage/sale-evidence adapters classify missing versus transient objects.
These necessary integration paths were included in independent final-head reviews; the pre-dispatch plan remains unchanged.
Dispatch flag: 20 dispatches exceeds 8 due builder continuations, expanded adversarial tests and three review rounds.
No STATUS, coverage or lane files changed.
