---
branch: app/WHR-23-stage-2a
linear: WHR-23
tier: high
reviewed_head: e230cdfd648c83c631e84a0db1b053883fe57155
rounds: 3
builder: frontend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 18
plan:
  goal: Build E01 E02 grouped readiness E04 confirmation and E03 immutable results for Stage 2a
  files: src/client/admin-giveaway*, src/ui/admin/leaderboard*, src/ui/admin/giveaway*, src/app/(admin)/admin/leaderboards/**, tests/e2e/leaderboards*, tests/design-parity/leaderboards/**, docs/briefs/admin-row-11-leaderboards.md, docs/qa/smoke-2026-11-16-giveaway-stage-2a.md
  approach: Consume unchanged WHR-22 endpoints with strict client parsing frozen operation bodies session epoch guards server readiness and paginated immutable previews and snapshots
  tests: Exact spend ties category paging unconfigured grouped blockers prepare confirm replay uncertainty stale evidence permission loss saved lineage unchanged reconciliation and 1440 390 360 fidelity
  risks: Irreversible save requires owned current preview and returned guard; unknown request outcomes retain exact key and body; missing granular checklist stays unavailable until Stage 2b
invariants: [I-07, I-09, I-11, I-40, I-41, I-42, I-43, I-44, I-45, I-46, I-49]
p1:
  - fixed configured all-time queries omit campaignId and undefined optional parameters
  - fixed stale snapshot history restarts from its first page
  - fixed authority-loss assertion handles removal of protected main content
tickets: [WHR-142, WHR-173]
---
Stage 2a only: E01 live rankings, E02 actual grouped readiness, E04 owned frozen confirmation and E03 immutable saved revisions. Existing WHR-22 endpoints are unchanged. Missing checklist screens are honestly unavailable; unconfigured campaigns stay explicit.

Code, security and integrity reviewers passed at the reviewed head in round 3, within the cap. Worktree remained clean and head unchanged after each round. Earlier findings led to strict outgoing-query regressions, cursor recovery and a corrected authority-loss assertion. Independent fidelity found E02 mobile overflow; scoped wrapping and replacement captures resolved it.

The EM reran typecheck, lint, 981 unit tests and production build on the reviewed head; all passed (two inherited image warnings). Real HTTP protocol passed locally. Linux CI at 41ddc43 passed all 24 new project cases. Full-suite merge still requires every final-head GitHub check green, including integration, browser, timezone, storage and review evidence.

CI attempt 1 on 41ddc43 also exposed the existing shared-public settings campaign-version race (WHR-142); the new giveaway fixtures use isolated migrated schemas and servers. No production quota or guards were weakened. Test instrumentation now uses a separate real narrowly granted observer for passive reads, and stale tests wait for an owned enabled confirmation before mutating fixtures.

Evidence correction (WHR-173, P2): QA prose overstates automated keyboard/focus and horizontal table-scroll interaction coverage. CI measures page width and control heights plus the exercised UI/protocol flows; those interactions remain manual acceptance checks. Correct the prose in the separate reviewed READY records PR. Native captures and their height-limit caveat remain valid.

Smoke: docs/qa/smoke-2026-11-16-giveaway-stage-2a.md. Independent fidelity: tests/design-parity/leaderboards/REPORT.md, 14 captures at 1440/390/360. Dispatches exceed the high-tier flag of eight; three review rounds, no escalation. STATUS, coverage and lane records are excluded from this feature PR.
