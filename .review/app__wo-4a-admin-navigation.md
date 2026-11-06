---
branch: app/wo-4a-admin-navigation
linear: WHR-75
tier: high
plan:
  goal: remove admin focus and navigation reload stalls while preserving server authority
  files: src/app/(admin)/**, src/ui/admin/**, src/ui/navigation.tsx, src/ui/shells.tsx, src/client/admin*, src/styles/app.css, tests/**, docs/briefs/**, docs/qa/**
  approach: measure staging first, persist identity-scoped session in memory above routes, client navigation, background revalidation and inline data progress
  tests: baseline and after staging timings, no document reload, focus and visibility revalidation, revoked or changed identity, stale responses, memory-only state, existing admin access and 390px regressions
  risks: stale grants or account leakage, credential drafts surviving navigation, false authority or success, recipient-token navigation regressions
---
