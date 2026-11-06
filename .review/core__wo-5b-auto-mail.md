---
branch: core/wo-5b-auto-mail
linear: WHR-68
tier: high
plan:
  goal: Automatically drain queued admin mail within a minute under healthy configured delivery without manual console execution or an extra paid component.
  files: src/instrumentation*, src/server/modules/admin-access/mail*, src/server/adapters/email*, jobs/admin-mail.ts, scripts/deploy/entrypoint*, Dockerfile, package.json, tests/integration/*mail*, tests/e2e/*mail*, docs/ops/staging.md
  approach: One bounded non-overlapping polling loop per web process, reuse transactional message claims and leases across instances, explicit provider opt-in, bounded graceful SIGTERM drain, counts-only telemetry.
  tests: Real PostgreSQL overlap and redeploy fencing, crash mid-send revocation without replay, empty outbox cadence, absent provider no-op, bounded polling/batches, actual runtime startup/shutdown and unaffected health; EM standard gates.
  risks: Never reconstruct or replay a link after uncertain delivery, never start a sender during builds or with unset provider, avoid duplicate loops and shutdown races; production provider activation remains gated.
---

High tier raised for recovery-link delivery, process lifecycle and durable leases.
No cloud operations or real provider calls; all fixtures and transport tests stay local.
Technical decision and shared session records are separate PRs.
