---
branch: app/wo-6a-m2-smoke
linear: WHR-92
tier: high
reviewed_head: 376aff2b08733fd35dc92f19fa6a7422d965c3af
rounds: 2
builder: frontend-engineer + offline-engineer + test-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 13
plan:
  goal: diagnose s02 and fix approved M2 client smoke findings without weakening validation
  files: src/client/**, src/ui/**, src/app/(attendant)/**, tests/**, docs/qa/**, docs/briefs/**, .codex/agents/frontend-engineer.toml
  approach: reproduce exports first on production build with local Postgres and MinIO; stop and post T1 evidence if server-side; otherwise fix source then registration routing and persistent reassignment notice
  tests: real PDF/XLSX prepare-poll-download and replay; valid unknown versus malformed code; persistent banner during save and fresh sign-in; independent 390px fidelity; full gates
  risks: uncertain operations retain IDs; server validation stays authoritative; no interruption or loss of saved sale; no shared record edits
invariants: [I-03, I-05, I-06, I-07, I-16, I-19, I-20, I-22, I-23, I-49]
p1: []
tickets: [WHR-83]
---

Earl identified Prepare/PDF on Generated at 17:16 UTC and approved the client classification/retry fix. A real committed export followed by substituted 502 HTML reproduces the misleading verification notice on old source. Non-OK unreadable responses now show unavailable and retain the original operation; malformed successful JSON/envelopes remain invalid_response. Structured domain refusals and receipt/schema/MIME/signature checks remain intact. The historical edge/deploy event is unconfirmed and is not asserted.

The initial plan was committed at 84405b8 before dispatch. File scope later included the required one-line escape-to-test gotcha; no new product scope. No STATUS, coverage or lane files changed.

Malformed code errors no longer imply a lookup/registration need. Authoritative unknown-card navigation is preserved with an account/context-scoped memory candidate. Shared A17 warning survives offline reloads and stale replies; fresh sign-in clears it without changing capture details or queues.

Red/green tests found a lost Account-first offline warning and a stale configured response hiding the switch action. Durable current-context hint and monotone same-context refresh fix the first; Account's known-warning OR and confirmed-target display fix the second. Real hash-barrier save retains one original and matching photo.

All independent reviewers PASS at reviewed_head in round 2, no findings; round 1 reviewed the earlier client slice at 10ef2c0. Independent round-2 unit checks: code 103, security 107, integrity 162 tests passed. Frozen head and clean worktree verified after review.

EM final-head typecheck, lint, 474 unit tests and production build PASS. Exact-source local Linux pnpm test:e2e: 226 passed, four existing staging-only skips, two workers, zero retries (4.6 minutes). First run: 225 passed and one unchanged assignment-end fixture failed with Route is already handled at line 63, matching WHR-83; recorded there, then the unchanged full suite passed. No assertion, timeout, worker count or retry policy was weakened.

Independent 390px fidelity: original phone cases 2 passed/seven PNGs and metrics; new unavailable/retry state 1 passed/one PNG and metrics, no overflow and 48px controls. No new blocking drift; report tests/design-parity/m2-smoke-fixes/REPORT.md. Earlier producer typing/Uploads-badge locator corrections preserved assertions, timeouts and retries.

s02 matrix: six real production/MinIO PDF/XLSX x Generated/Printed/Active ten-card cases pass original verification and immutable replay. New 202 commit -> 502 HTML -> same-key/body/original-ID reconciliation, nominal PDF/XLSX and malformed successful JSON/null cases pass 8/8 across desktop/attendant, zero retries. One Generated/version-1 snapshot and unchanged inventory are asserted. See tests/customers-cards/S02-INVESTIGATION.md.

Dispatch flag exceeded (13 > 8): resumed s02 builder/test work plus a second full independent review round. High-tier round cap 3 retained; two rounds used. Shared records remain excluded from this feature PR. No cloud/provider, main or ~/.codex changes; WHR-90 starts only in a fresh session after staging merge and READY.
