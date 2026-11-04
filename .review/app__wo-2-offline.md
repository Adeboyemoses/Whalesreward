---
branch: app/wo-2-offline
linear: WHR-5
tier: high
plan:
  goal: Save attendant sales and live photos durably offline under the originating account, without claiming upload or credit.
  files: src/client/**, src/app/(attendant)/**, src/ui/**, src/styles/**, public/**, tests/**, package.json, pnpm-lock.yaml, docs/briefs/**, docs/qa/**
  approach: Typed M1 HTTP adapter with test-only contract fake; Dexie v1 atomic account partitions; conservative persisted 24-hour window; static client shells; Workbox generic-shell precache per settled T-01 and T-12.
  tests: Exact expiry and rollback/restart; atomic quota failure; photo digest; cross-account isolation and handover; amount/quantity and gas; Playwright offline save/restart; cache exclusions; board fidelity.
  risks: Server endpoints arrive in WO-core-3; phone smoke deferred until its merge; browser storage is not encrypted; uncertain time locks capture; no upload or credit implementation.
---
Plan committed before builder dispatch. READY requires independent code/security/integrity PASS, EM gates, green CI and staging merge. Workbox follows T-01; no new stack decision.
