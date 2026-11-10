---
branch: app/wo-6b-update
linear: WHR-90
tier: high
reviewed_head: pending
rounds: 0
builder: offline-engineer
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: Safely replace outdated attendant shells without interrupting capture or queued sales.
  files: src/client/**, src/ui/**, src/app/(attendant)/**, next.config.ts, tests/**, docs/qa/**, docs/engineering/contracts/**
  approach: Build stamp on API responses and client; detect mismatches; coordinate worker activation and reload only after capture ends and all local queues empty; retain offline fallback.
  tests: Old worker with new server sign-in/session; first-password upgrade; capture and queued-sale reload blocking; offline precache navigation; multi-tab safety.
  risks: Activation/reload races across tabs and asynchronous outbox saves; stale shell bootstrap; no API caching or IndexedDB deletion.
invariants: [I-03, I-06, I-22, I-23, I-49, I-50]
p1: []
tickets: []
---
Plan committed before builder dispatch. WHR-63 excludes shared record edits.
