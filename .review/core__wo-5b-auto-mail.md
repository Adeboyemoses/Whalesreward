---
branch: core/wo-5b-auto-mail
linear: WHR-68
tier: high
reviewed_head: 1b10c1f3a687c7158504849c7f1446ce602bd0e8
rounds: 1
builder: backend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 5
invariants: [I-12, I-41, I-52]
p1: []
tickets: [WHR-71, WHR-72]
plan:
  goal: Automatically drain queued admin mail within a minute under healthy configured delivery without manual console execution or an extra paid component.
  files: src/instrumentation*, src/server/modules/admin-access/mail*, src/server/adapters/email*, jobs/admin-mail.ts, scripts/deploy/entrypoint*, Dockerfile, package.json, tests/integration/*mail*, tests/e2e/*mail*, docs/ops/staging.md
  approach: One bounded non-overlapping polling loop per web process, reuse transactional message claims and leases across instances, explicit provider opt-in, bounded graceful SIGTERM drain, counts-only telemetry.
  tests: Real PostgreSQL overlap and redeploy fencing, crash mid-send revocation without replay, empty outbox cadence, absent provider no-op, bounded polling/batches, actual runtime startup/shutdown and unaffected health; EM standard gates.
  risks: Never reconstruct or replay a link after uncertain delivery, never start a sender during builds or with unset provider, avoid duplicate loops and shutdown races; production provider activation remains gated.
---

High tier for recovery-link delivery, scheduled work, process lifecycle and durable leases.
All three independent reviewers passed the unchanged code head without findings.
EM typecheck, lint, 193 unit tests, build and 143 PostgreSQL/MinIO tests passed.
EM Linux browser suite: 100 passed, four existing staging-only skips, zero retries.
Independent tests cover competing loops, expired leases and late acknowledgements, failed-send no replay, capped recovery, shutdown drain and five-second empty-queue cadence.
The compiled-runtime regression verifies health responsiveness and actual SIGTERM drain through the deployment entrypoint.
No cloud operations or real provider calls; all fixtures and transport tests stay local.
Technical decision and shared session records are separate PRs.

After concurrent app PRs #60/#61 merged, EM reran the combined head: typecheck/lint/build, 197 unit and 143 PostgreSQL/MinIO tests PASS; final Linux browser run 102 passed/four existing skips.
WHR-71 tracks slow CI font downloads; two setup attempts were cancelled before tests and fresh runners passed. WHR-72 tracks an inherited app test redirect race observed once in the first combined local run; the unchanged full rerun passed. Neither changes this feature or test retry policy.
