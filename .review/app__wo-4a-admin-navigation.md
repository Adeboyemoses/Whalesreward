---
branch: app/wo-4a-admin-navigation
linear: WHR-75
tier: high
reviewed_head: c4486ee0fe7edd94c8af0ace74aeb36b930a9c42
rounds: 2
builder: frontend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 16
invariants: [I-07, I-09, I-12, I-13, I-41, I-49]
p1: ["fixed authoritative same-route save reconciliation and audit refresh", "fixed secondary-read warnings fabricating delivery success"]
tickets: []
plan:
  goal: remove admin focus and navigation reload stalls while preserving server authority
  files: src/app/(admin)/**, src/ui/admin/**, src/ui/navigation.tsx, src/ui/shells.tsx, src/client/admin*, src/styles/app.css, tests/**, docs/briefs/**, docs/qa/**
  approach: measure local fixture baseline with DevTools network throttling first, persist identity-scoped session in memory above routes, client navigation, background revalidation and inline data progress
  tests: baseline and after local timings at 150 ms RTT and Fast 3G, no document reload, focus and visibility revalidation, revoked or changed identity, stale responses, memory-only state, existing admin access and 390px regressions
  risks: stale grants or account leakage, credential drafts surviving navigation, false authority or success, recipient-token navigation regressions
---

Persistent layout-scoped session memory and client navigation retain the shell, lists and healthy drafts during background revalidation. Server authority and memory-only storage remain unchanged.
Round 1 found stale review/version/history after same-route saves, secondary-read errors fabricating queue success, and late mutation navigation. Fixes reconcile returned server state, distinguish warnings/acknowledgements, and fence callbacks by authority, component lifetime, pathname and view generation. Same-record Back during Resend POST/GET has red-to-green coverage. Round 2: all three independent reviewers PASS at the frozen reviewed head; clean tree and unchanged head verified.
EM typecheck/lint/259 unit/build PASS. Full Linux browser 130 PASS, four existing staging-only skips, zero retries; existing local Mailpit four and new mail-race five PASS. Browser runtime/test source is identical to reviewed head; only final reports/screenshots and unrelated base records followed archive capture. Independent focused default14/Mailpit5+4/parity2 PASS. Red evidence and reproducible commands are in tests/admin-navigation/mutations/REVIEW-REGRESSIONS.md.
Local BEFORE6072636 / AFTER4e87ed7 samples use matched fixtures, CDP150ms and an explicit Fast3G-shaped stress profile. Representative medians: tab482.2→0.9ms, user842.2→322.2ms, role690.4→329.9ms; zero AFTER document reloads. Stress full details remain1.18–1.66s. Timing preceded mutation-only review fixes and accepted base changes; no deployed measurement or device-discard claim. See tests/admin-navigation/COMPARISON.md and focused fidelity report.
Dispatch flag exceeded:16 versus8 high-tier flag, including separate test production, review fix rounds and same-record race follow-up; two formal review rounds remain within cap3. Runtime model identity unavailable. No live staging session, cloud/provider calls or staging-data changes. WHR-69/70 remain separate; no new deferred findings.
