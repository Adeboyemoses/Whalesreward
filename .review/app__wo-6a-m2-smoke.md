---
branch: app/wo-6a-m2-smoke
linear: WHR-92
tier: high
reviewed_head: 10ef2c0ceab08aa03dc08de2e7a8ac3e3376307a
rounds: 1
builder: frontend-engineer + offline-engineer + test-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 8
plan:
  goal: diagnose s02 and fix approved M2 client smoke findings without weakening validation
  files: src/client/**, src/ui/**, src/app/(attendant)/**, tests/**, docs/qa/**, docs/briefs/**, .codex/agents/frontend-engineer.toml
  approach: reproduce exports first on production build with local Postgres and MinIO; stop and post T1 evidence if server-side; otherwise fix source then registration routing and persistent reassignment notice
  tests: real PDF/XLSX prepare-poll-download and replay; valid unknown versus malformed code; persistent banner during save and fresh sign-in; independent 390px fidelity; full gates
  risks: uncertain operations retain IDs; server validation stays authoritative; no interruption or loss of saved sale; no shared record edits
invariants: [I-03, I-05, I-06, I-07, I-16, I-19, I-20, I-22, I-23, I-49]
p1: [WHR-92]
tickets: []
---

Draft only: WHR-92 remains BUILD. The s02 staging incident is unreproduced and blocks merge/READY; no server-side cause or export source fix is established. Original client checks remain unchanged. WHR-90 has not started.

The initial plan was committed at 84405b8 before dispatch. File scope later included the required one-line escape-to-test gotcha; no new product scope. No STATUS, coverage or lane files changed.

Malformed code errors no longer imply a lookup/registration need. Authoritative unknown-card navigation is preserved with an account/context-scoped memory candidate. Shared A17 warning survives offline reloads and stale replies; fresh sign-in clears it without changing capture details or queues.

Red/green tests found a lost Account-first offline warning and a stale configured response hiding the switch action. Durable current-context hint and monotone same-context refresh fix the first; Account's known-warning OR and confirmed-target display fix the second. Real hash-barrier save retains one original and matching photo.

All independent reviewers PASS at reviewed_head in round 1, no findings. Code/security independently ran 13 access tests; integrity independently ran 78 offline tests. Head and clean worktree verified after review.

EM final-head typecheck, lint, 458 unit tests and production build PASS. Exact-source local Linux pnpm test:e2e: 224 passed, four existing staging-only skips, two workers, zero retries (3.5 minutes). Remote-browser preflights were stopped for missing fake-camera flags and unsupported local restart/ephemeral-port tests; unchanged complete suite then passed with runner and browser together in Linux.

Independent 390px fidelity: 2 passed, seven PNGs/metrics, no new blocking drift; report tests/design-parity/m2-smoke-fixes/REPORT.md. Test-producer typing/Uploads-badge locator corrections preserved assertions, timeouts and retries.

s02 matrix: six real production/MinIO PDF/XLSX x Generated/Printed/Active ten-card cases pass receipt/schema/MIME/signature checks and immutable replay; multipage PDF and reserved stock verified. Actual export UI and three retry cases pass. See tests/customers-cards/S02-INVESTIGATION.md. These passes do not resolve Earl's incident; failing staging action/format and safe boundary evidence remain needed.
