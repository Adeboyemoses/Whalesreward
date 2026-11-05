---
branch: core/wo-5-admin-access
linear: WHR-8
tier: high
plan:
  goal: Implement m2 admin access, 28 action permissions, roles and verified-email recovery for WO-core-5.
  files: prisma/**, src/server/lib/**, src/server/modules/admin-access/**, src/server/adapters/**, src/app/api/admin/**, src/shared/contracts/**, tests/**, jobs/**, docs/ops/staging.md, docs/qa/**
  approach: Reuse Better Auth identities and database sessions; central authz and serialized security lock protect live grants, delegation and last Owner; hashed purpose-bound challenges and asynchronous adapter mail protect recovery.
  tests: Permission denial and surface isolation, first-password enforcement, subset delegation, concurrent last-Owner changes, token expiry/replay/generation, reset revocation, idempotency and privacy; full EM gates on final head.
  risks: Additive schema only; proposed WHR-42/43 policy isolated and production fails closed; no provider activation or staging data change; no shared records in feature PR.
invariants: [I-07, I-08, I-09, I-10, I-11, I-12, I-13, I-41]
---

Approved implementation scope is docs/engineering/contracts/m2.md through admin users and roles; station, cards, attendants and UI are excluded.
Backend builder owns implementation, migrations, focused tests and staging-seed documentation. Test engineer independently adds real-Postgres adversarial coverage after the API is available.
Local Mailpit and staging no-op adapter only. Production policy and delivery remain disabled pending approval. Staging insert-only admin credential is an Earl-run data step, never executed by this session.
