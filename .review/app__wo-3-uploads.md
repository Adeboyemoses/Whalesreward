---
branch: app/wo-3-uploads
linear: WHR-7
tier: high
plan:
  goal: Upload queued sales safely and display credit only from validated authoritative server status.
  files: src/client/**, src/app/(attendant)/**, src/ui/**, src/styles/**, tests/fixtures/**, tests/e2e/**, tests/design-parity/**, docs/briefs/**, docs/qa/**, docs/engineering/coverage-map.md, docs/agentic/lanes/app.md, STATUS.md
  approach: Extend typed M1 adapter and account-scoped durable sync state machine; reconcile unknown outcomes, preserve immutable finalize requests, lease retries, and render receipts from server status.
  tests: Lost submit/finalize responses, restart, expired permissions, Retry-After, account handover, expiry, concurrent leases, partial uploads, invalid photos, mixed holds, gas receipt, independent fidelity and Playwright.
  risks: Cross-account upload, duplicate credit, false Synced, evidence loss, stale retries, permission leakage; real endpoints and physical phone acceptance remain external dependencies.
---

Implementation plan for WO-app-3; Earl approved this session on 5 November 2026.

- [ ] Offline builder extends src/client/api.ts and types.ts with validated M1 sync responses and a test-only contract fake.
- [ ] Offline builder implements submit, permission, PUT, finalize, status reconciliation and durable leases behind CaptureClient; tests failures before implementation.
- [ ] Frontend builder renders A04/A08/A23/A14/A16, live account-scoped pending count and upload-first logout using that client.
- [ ] Test engineer independently exercises browser restart/retry/handover, gas and held states, and compares board screenshots.
- [ ] EM runs typecheck, lint, unit tests, build and e2e, then dispatches code/security/integrity review on the committed head.
- [ ] Resolve review findings within three rounds, commit evidence, merge green PR to staging, update coverage and session records, mark READY and stop.

Spec: docs/engineering/contracts/m1.md; docs/briefs/attendant-row-03-upload-sync.md.
Review focus: late callbacks after sign-out; unknown finalize plus version change; cancelled missing-photo records; stale leases in two tabs; partial upload never counted as credit.
