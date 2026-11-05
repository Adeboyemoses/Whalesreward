---
branch: app/wo-3a-upload-race
linear: WHR-60
tier: high
reviewed_head: 887a9d100dbc71191913274a0c40432c8dba2bde
rounds: 2
builder: test-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 12
plan:
  goal: Diagnose and remove the two upload-failure browser races without weakening upload correctness checks.
  files: tests/e2e/upload-sync.spec.ts, tests/fixtures/**, docs/qa/upload-failure-race.md; src/client/offline/** only if diagnosis proves a product recovery defect.
  approach: Reproduce with durable-state and lease observations; verify abandoned-lease recovery; synchronize fixtures on observed failure completion if product recovery is sound.
  tests: Both cases on desktop and attendant with two workers, twenty repeats each and zero retries; full browser suite; standard EM gates; two consecutive green CI executions.
  risks: Hiding a real stuck lease, weakening evidence or exactly-once assertions, sleeping past races, shortening production leases or inflating retries; none are acceptable.
invariants: [I-03, I-06, I-22, I-23, I-25, I-26, I-28]
p1: []
tickets: []
---

Earl approved WHR-60 in the current session on 2026-11-05: “approve WHR-60”.
The existing work-order risk is high and is retained while diagnosis distinguishes fixture and product behavior.
Feature work excludes STATUS, coverage and lane files; records follow after the merge.
The two fixtures now observe durable failure bookkeeping and a released lease before full navigation.
No production, dependency, lease, runner retry or timeout changes; original/photo/validated-credit assertions are strengthened.
Controlled navigation with a live lease recovered automatically in 60,821 ms (desktop) and 61,242 ms (attendant), preserving the original/photo and one credit; procedure and measurements are in docs/qa/upload-failure-race.md.
All three independent reviewers passed both rounds with no findings; round 2 checked only the diagnostic documentation delta and carried forward the unchanged code approval. The worktree remained clean and reviewed HEAD unchanged after each round.
Dispatches=12: three capacity-failed builder launches, one successful builder, one follow-up diagnosis, three first-round reviewers and four second-round calls (one capacity failure). This exceeds the high-tier dispatch flag of eight; two review rounds remain within the cap of three.
EM typecheck, lint, 135 unit tests across 22 files and production build passed.
EM full browser suite: 68 passed, four existing staging-only skips, zero retries (6.3m), on identical application/test code in the separate builder worktree.
Initial repeat run: 79 passed, one expired-PUT case failed at Offline access expired (14.0m); 40 read-only instrumented cases then passed. Empty-browser wall rollback was confirmed, but attribution of the original failure remains an inference, explicitly recorded in QA notes. Instrumentation was removed; no clock or expiry policy changed.
Final unchanged repeat: 80 passed (11.7m), zero failures/skips/retries: 20 repeats × two cases × desktop/attendant, CI mode, two workers, explicit --retries=0. Both required cases passed twenty consecutive times on each project.
Two consecutive green CI executions on the unchanged evidence head are required before merge; their links are recorded in the PR and WHR-60 without modifying the verified commit.
