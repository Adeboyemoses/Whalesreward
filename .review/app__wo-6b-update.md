---
branch: app/wo-6b-update
linear: WHR-90
tier: high
reviewed_head: afb5428b34a0761ace8146fb8c2dc9a7d089ae7c
rounds: 2
builder: offline-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 8
plan:
  goal: Safely replace outdated attendant shells without interrupting capture or queued sales.
  files: src/client/**, src/ui/**, src/app/(attendant)/**, next.config.ts, tests/**, docs/qa/**, docs/engineering/contracts/**
  approach: Build stamp on API responses and client; detect mismatches; coordinate worker activation and reload only after capture ends and all local queues empty; retain offline fallback.
  tests: Old worker with new server sign-in/session; first-password upgrade; capture and queued-sale reload blocking; offline precache navigation; multi-tab safety.
  risks: Activation/reload races across tabs and asynchronous outbox saves; stale shell bootstrap; no API caching or IndexedDB deletion.
invariants: [I-03, I-06, I-22, I-23, I-49, I-50]
p1: ["fixed capture-start race with final synchronous guard and delayed-outbox regressions"]
tickets: []
---
Plan committed before builder dispatch. WHR-63 excludes shared record edits.
Round 1: code FAIL (P0 bundler import resolution), security PASS,
integrity FAIL (same P0 and P1 capture start during awaited outbox read).
Fixed worker-relative bundling and rechecked capture, route, freeze and token
after asynchronous queue reads. Two delayed-query tests reproduced the race.
Round 2: all three reviewers PASS at reviewed_head; worktree clean and head unchanged.
EM verification: typecheck, lint, 57 unit files / 506 tests and production build PASS.
Local full Playwright attempted: Chromium launch denied by macOS sandbox
(bootstrap_check_in MachPortRendezvousServer Permission denied); CI e2e required.
No API runtime caching, IndexedDB deletion, contract shape or admin flow changes.
Legacy clients without the update protocol require one full close/reopen bootstrap;
unknown tabs fail closed. See contracts/app-build.md and the smoke runbook.
