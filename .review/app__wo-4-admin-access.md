---
branch: app/wo-4-admin-access
linear: WHR-9
tier: high
plan:
  goal: implement admin access screens on WO-core-5 APIs with server authority
  files: src/app/(admin)/**, src/client/admin*, src/ui/**, src/styles/app.css, tests/**, docs/briefs/**, docs/qa/**
  approach: no-store cookie APIs, memory-only drafts and link tokens, explicit review and confirm, live server permissions
  tests: local Postgres and Mailpit Playwright flows, revocation and refusals, unit client errors, board fidelity at 1440 and usability at 390
  risks: secret exposure, stale authority and versions, uncertain mutations, cross-account state, delivery confusion
---
