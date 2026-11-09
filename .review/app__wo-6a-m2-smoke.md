---
branch: app/wo-6a-m2-smoke
linear: WHR-92
tier: high
plan:
  goal: diagnose s02 and fix approved M2 client smoke findings without weakening validation
  files: src/client/**, src/ui/**, src/app/(attendant)/**, tests/**, docs/qa/**, docs/briefs/**
  approach: reproduce exports first on production build with local Postgres and MinIO; stop and post T1 evidence if server-side; otherwise fix source then registration routing and persistent reassignment notice
  tests: real PDF/XLSX prepare-poll-download and replay; valid unknown versus malformed code; persistent banner during save and fresh sign-in; independent 390px fidelity; full gates
  risks: uncertain operations retain IDs; server validation stays authoritative; no interruption or loss of saved sale; no shared record edits
invariants: [I-03, I-05, I-06, I-07, I-16, I-19, I-20, I-22, I-23, I-49]
---

Pre-dispatch plan. Reviewer verdicts and final verification remain pending.
