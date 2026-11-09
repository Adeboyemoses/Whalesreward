---
branch: app/wo-5-station
linear: WHR-11
tier: high
plan:
  goal: deliver approved station price and attendant screens including restricted first password and P-21 without changing server authority or original queues
  files: src/app/(admin)/**, src/app/(attendant)/**, src/ui/admin/**, src/client/**, src/styles/**, tests/**, docs/briefs/**, docs/qa/**
  approach: use existing admin session shell and exact shared money helpers, typed M2 HTTP adapters, explicit frozen reviews and guarded retries, memory-only credential state, test-only offboarding contract fake until WHR-80 merges
  tests: real station and first-password fixtures, stale and lost confirmations, OR-grants and revocation, A17 original queue isolation, P-21 contract-fake then real endpoint, responsive board parity and complete EM gates
  risks: stale assignment or price confirmation, duplicate writes after uncertainty, passwords or prior-account data persisting, restricted sessions starting capture windows, rewritten queues, false fake-backed success claims
---
