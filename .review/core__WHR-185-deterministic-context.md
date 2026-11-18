---
branch: core/WHR-185-deterministic-context
linear: WHR-185
tier: low
reviewed_head: abde51829801ef5baf9817e96bc8b45f2e4c4c3d
rounds: 1
builder: em
reviewers:
  code-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 2
invariants: [I-03, I-37, I-38]
p1: []
tickets: []
---

Earl's 18 Nov comment and session instruction authorize this separate test-only fix.
freshSeller sampled the volatile PostgreSQL clock twice; microsecond differences
made offline_expires_at differ from signed_in_at plus exactly 24 hours.
Both expressions now use the same statement timestamp, including at date boundaries.
Audited every capture_context insert and window update under tests: the other
helpers use shared parameters, one clock sample, stable now()/statement_timestamp(),
or fixed timestamps. No equivalent unsafe capture-window pair remains.
No production, constraint, retry, timeout or shared session-record files changed.

Both independent reviewers PASS in round 1, no findings; read-only reviews left
the worktree clean and reviewed head unchanged. No high-tier plan is required.
EM verification on the reviewed head: typecheck, lint (four pre-existing img
warnings), 997 unit tests, build and timezone 5+5 all PASS.
PostgreSQL 15.14 disposable local database: 20 separate affected-file runs,
9/9 each (180/180), no failures or retries. Original helper's ordinary baseline
passed once, confirming the intermittent nature; direct SQL over 100,000 rows
observed 1,427 invalid old clock pairs and zero invalid statement-timestamp pairs.
Full PostgreSQL 16 integration suite and remaining required checks run in PR CI;
their run URL and final outcome are recorded in the PR and Linear READY comment.
