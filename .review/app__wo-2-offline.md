---
branch: app/wo-2-offline
linear: WHR-5
tier: high
reviewed_head: 8b55ff77ece22d5f41a3776368be2e585d00bb47
rounds: 2
builder: offline-engineer + frontend-engineer + test-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 15
plan:
  goal: Save attendant sales and live photos durably offline under the originating account, without claiming upload or credit.
  files: src/client/**, src/app/(attendant)/**, src/ui/**, src/styles/**, public/**, tests/**, package.json, pnpm-lock.yaml, docs/briefs/**, docs/qa/**
  approach: Typed M1 HTTP adapter with test-only contract fake; Dexie v1 atomic account partitions; conservative persisted 24-hour window; static client shells; Workbox generic-shell precache per settled T-01 and T-12.
  tests: Exact expiry and rollback/restart; atomic quota failure; photo digest; cross-account isolation and handover; amount/quantity and gas; Playwright offline save/restart; cache exclusions; board fidelity.
  risks: Server endpoints arrive in WO-core-3; phone smoke deferred until its merge; browser storage is not encrypted; uncertain time locks capture; no upload or credit implementation.
invariants: [I-02, I-03, I-06, I-09, I-17, I-22, I-23, I-24, I-29, I-30, I-49, I-50]
p1: ["fixed stale refresh locking newer sign-in", "fixed multi-tab monotonic elapsed loss", "fixed delayed-response capture-window extension"]
tickets: [WHR-45]
---
Smoke runbook and unchanged high-tier plan committed before builders. Production uses a typed M1 HTTP adapter; strict contract fakes are test-only. Real endpoints belong to WO-core-3; uploading and crediting remain out of scope.
Round 1 found SEC-HIGH lookup denial leaving capture active and P1 stale refresh, multi-tab timing and response-delay cases. Deterministic reproductions preceded fixes. Round 2 code/security/integrity PASS at the exact reviewed head; each independently ran 47 targeted tests. Worktree and head were unchanged after both rounds.
EM gates: typecheck, lint, 74 unit tests, production build, 32 Playwright tests passed; 4 staging-only tests intentionally skipped in non-staging mode. Time suite: 3 passed each in UTC and America/New_York. Runtime staging banner/noindex checked locally on attendant shells and gallery.
Independent design fidelity: 22 screenshots for 11 boards at 390/360 px, two capture tests passed. Existing WHR-45 quantity-display difference accepted within this scope; exact storage and calculations remain tested. Report: docs/qa/offline-capture-fidelity.md.
Concurrent staging changes require generic runtime-rendered shells. Worker revisions use BUILD_ID and attendant manifest dependency closure; installation caches fixed generic routes, not personal data. Root runtime staging behavior is preserved. Populated Dexie v1 reopen, atomic quota failure, browser restart, cross-account/cross-tab handover and cache exclusions are covered.
Dispatch flag exceeded for handover regressions, review fixes and concurrent staging integration; recorded in app lane. This PR has 15 dispatches; the session also used one independent reviewer for WO-app-1 closeout PR #24.
READY follows green staging merge. Earl's phone smoke waits until WO-core-3 merges; no phone acceptance, cloud change, upload or credit is claimed.
