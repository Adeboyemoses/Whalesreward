---
branch: app/wo-9-customer-changes
linear: WHR-19
tier: high
plan:
  goal: deliver C02-C05 customer identity change flows against WO-core-10
  files: src/shared/phone.ts, src/server/adapters/phone.ts, src/client/customer-recovery*, src/ui/admin/customer*, src/app/(admin)/admin/customers/**, tests/**, docs/briefs/**, docs/qa/**
  approach: validated real endpoints with live session guards, frozen review versions and operation replay, transient verification input, masked receipts and intake-only fallback
  tests: real-stack Playwright with local server adapter, permission and stale-version failures, uncertain retries, secret clearing, unconfigured fallback, 1440px fidelity, existing phone normalization parity
  risks: identity changes require current customer and card versions; no secret persistence; manager intake must not mutate identity; no provider or stranded-phone scope; shared helper extraction retains server phone policy
---
