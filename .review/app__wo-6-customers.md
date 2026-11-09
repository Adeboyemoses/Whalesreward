---
branch: app/wo-6-customers
linear: WHR-13
tier: high
reviewed_head: 0000000
rounds: 0
builder: frontend-engineer
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
invariants: [I-02, I-06, I-07, I-09, I-14, I-15, I-16, I-17, I-18, I-19, I-20, I-29, I-41, I-42, I-44, I-49, I-50]
p1: []
tickets: []
plan:
  goal: deliver approved registration customer and loyalty card screens against M2 while keeping server authority and prior queues intact
  files: src/app/(admin)/**, src/app/(attendant)/**, src/ui/**, src/client/**, src/styles/**, tests/**, docs/briefs/**, docs/qa/**
  approach: extend persistent memory-only admin modules with typed M2 shared schemas and frozen reviewed operations, online-only attendant registration and fresh-card sale handoff, protected immutable export preview and downloads
  tests: real local registration duplicate and lost-response cases, guarded card lifecycle and binary exports, narrow grants revocation stale route and cursor fencing, PII persistence denial and existing queue preservation, independent board parity and complete EM gates
  risks: duplicate registration or batch writes after uncertainty, stale permission or inventory confirmations, prior-account PII or downloads surviving authority changes, receipt mistaken for current card authority, export snapshot or lifecycle drift and unapproved phone or printing policy
---

Preimplementation plan only. Source, reviewers and verification will be filled after independent review; no readiness or acceptance is claimed.
