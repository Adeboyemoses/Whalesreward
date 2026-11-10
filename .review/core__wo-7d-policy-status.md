---
branch: core/wo-7d-policy-status
linear: WHR-100
tier: high
plan:
  goal: preserve actionable existing M2 errors through the edge and expose safe policy health
  files: src/server/**, src/app/api/health/**, tests/**, src/client/*.test.ts, docs/qa/**
  approach: remap existing auth delivery delegation phone and export_failed gates to 409; reuse environment-aware validators from a single snapshot; allowlist ten statuses and authorize named health output using live settings permission after the probe
  tests: HTTP remaps and unchanged messages with no mutation; isolated policy validation and no values; all public and privileged projections including revocation and database failures; desktop and phone messages; full repository gates
  risks: absent M3/M4 evaluators stay unconfigured; no new policy activation; public reset remains generic; health cannot expose secrets or extend sessions; retained transient errors remain 503
---
Spec prerequisite PR #101 merged at 25ecdc9; branch starts after records PR #102 at 641f7c1.
No cloud or STATUS/coverage/lane edits. High tier, round cap 3.
