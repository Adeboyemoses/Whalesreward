---
branch: core/WHR-176-sheet-ids
linear: WHR-176
tier: high
plan:
  goal: make held-release sheet identifiers satisfy strict UUIDv7 HTTP contracts
  files: src/server/modules/reviews/release-uploads.ts, tests, docs/qa
  approach: reproduce HTTP failure then use existing newId for persisted identifiers while retaining random storage paths; audit other randomUUID contract flows
  tests: real HTTP reserve upload-url PUT finalize propose against PostgreSQL and object storage; required gates
  risks: preserve evidence immutability, permissions, zero credit and disabled v2
invariants: [I-07, I-25, I-35, I-41, I-48]
---
