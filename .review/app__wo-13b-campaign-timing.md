---
branch: app/wo-13b-campaign-timing
linear: WHR-151
tier: medium
reviewed_head: 93d785756ad09d041803623bf4d307b7fb121775
rounds: 3
builder: frontend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 12
invariants: [I-07, I-09, I-41, I-45, I-51]
p1: ["fixed exact microsecond review and deadline comparisons", "fixed full-precision review and history display"]
tickets: [WHR-123, WHR-140, WHR-142]
escalation: Earl explicitly set "round cap 3" in the session instruction on 2026-11-16; round 3 reviewed test isolation only.
---
P-28 Owner campaign creation and timing edits consume the merged server without changing server/contracts.
Session-only drafts, frozen exact retries, server locks, non-Owner reasons and auditable history preserve retention behavior.
Round 1 found timestamp precision mismatch/truncation; exact microsecond comparisons and explicit retained ISO display fixed both.
Round 2 passed; final full-suite investigation led to test-only isolated real Next/schema fixtures, reviewed PASS in round 3.
Reviewers did not mutate files; final reviewed worktree was clean and head unchanged. The branch was renamed without changing that head.
EM gates: typecheck, lint (two inherited image warnings), 893 unit tests and production build PASS.
P-28 PostgreSQL integration: 57 PASS; timezone: 5 PASS in UTC and 5 PASS in New York.
Focused real browser: 40 PASS across desktop/phone, including 18 timing and 22 retention cases.
Independent fidelity: 1 PASS, 16 current PNGs/metrics at 1440/390/360; 48 px phone controls, focus and wrapped comparisons verified.
Final local full browser: 399 PASS, 4 existing skips, 3 failures: WHR-123 preview-navigation race and both native restart cases blocked by macOS sandbox.
Remote Linux browser required allowing the tests' simulated-camera launch flags; camera/media/offline flows passed after correcting that runner.
Earlier interrupted runs exposed shared fixture ordering (WHR-140/142); new timing cases now assert isolated schema cleanup and unchanged public campaign.
Complete native Linux CI must pass before staging merge. No policy, production data, cloud resource or retention deletion is changed.
Smoke: docs/qa/smoke-2026-11-16-campaign-timing.md. Fidelity: tests/design-parity/settings/REPORT.md.
