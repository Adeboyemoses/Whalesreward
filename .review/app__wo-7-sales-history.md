---
branch: app/wo-7-sales-history
linear: WHR-15
tier: high
plan:
  goal: Own sales history and numeric corrections plus authorized admin sales and late review
  files: src/client/sales*, src/client/offline/**, src/client/sw/**, src/app/(attendant)/attendant/history/**, src/ui/admin/sales*, src/ui/admin/portal.tsx, src/styles/**, tests/**, docs/briefs/**, docs/qa/**
  approach: Consume merged M3 strict contracts; separate account-partitioned frozen correction operations; original first; no blind rebase; ephemeral authorized history and photos; retain originals and server-only outcomes
  tests: Exact amount and quantity; populated Dexie migration; waiting original; replay after lost response; stale bases; account fencing; real-stack Playwright; 390/360 and 1440 fidelity; all required gates
  risks: Correction identity and monetary contribution; P-19 independent review; stale authority; unavailable evidence; no server-history or photo service-worker caching
---
Precommitted high-tier plan. No STATUS, coverage or lane edits per WHR-63.

Plan clarification before SW implementation: dynamic history routes need the generic History shell when offline; cache only its empty client shell/assets. History API responses and photos remain network-only. Existing admin session account.adminId typing is included for the P-19 maker guard.
