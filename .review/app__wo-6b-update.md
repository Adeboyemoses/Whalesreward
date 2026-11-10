---
branch: app/wo-6b-update
linear: WHR-90
tier: high
reviewed_head: 4031ce5fcbea9cfedca9bf14047673b669939274
rounds: 3
builder: offline-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 12
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
Round 1: code/integrity FAIL (P0 bundling; P1 async capture race), security PASS.
Fixed worker-relative imports and synchronous token/capture checks after IDB reads.
Round 2: all reviewers PASS; CI e2e exposed first-install transient waiting freeze.
Fixed first-install preparation and released freeze on first controller claim;
lifecycle regressions reproduce this bug. Navigation-aware browser polling and
immutable queue assertions preserve safety checks while allowing retry metadata.
Round 3: code, security and integrity PASS at reviewed_head; clean worktree/head.
EM: typecheck, lint, 57 unit files / 508 tests and production build PASS.
EM full Linux Docker Playwright: 234 PASS, 4 existing staging-only skips (4.0m).
Builder independently ran full suite: 234 PASS, 4 skips (3.8m).
Host Chromium is denied by macOS sandbox; Docker uses standard Playwright config.
No API runtime caching, IndexedDB deletion, contract shape or admin flow changes.
Legacy clients without protocol need one full close/reopen bootstrap; unknown tabs
fail closed. See contracts/app-build.md and the phone smoke runbook.
Dispatch flag: 12 exceeds the high-tier flag of 8; rounds remain within cap 3.
