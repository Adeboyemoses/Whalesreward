---
branch: core/WHR-176-sheet-ids
linear: WHR-176
tier: high
reviewed_head: 9801a81713d9b4426b7c32ac71fe7b5e4ec22969
rounds: 1
builder: backend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 4
p1: []
tickets: []
plan:
  goal: make held-release sheet identifiers satisfy strict UUIDv7 HTTP contracts
  files: src/server/modules/reviews/release-uploads.ts, tests, docs/qa
  approach: reproduce HTTP failure then use existing newId for persisted identifiers while retaining random storage paths; audit other randomUUID contract flows
  tests: real HTTP reserve upload-url PUT finalize propose against PostgreSQL and object storage; required gates
  risks: preserve evidence immutability, permissions, zero credit and disabled v2
invariants: [I-07, I-25, I-35, I-41, I-48]
---

All three independent reviewers passed the committed diff without findings.
Only the persisted held-release sheet identifier now uses newId; storage keys remain random.
The real HTTP regression reproduces the prior upload URL rejection and exercises reserve, upload URL, PUT, finalize and propose with returned IDs unchanged.
UUID audit found no other production randomUUID value entering a UUIDv7 contract.
No schemas, fixture IDs or deployed activation defaults changed.
