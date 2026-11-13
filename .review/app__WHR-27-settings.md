---
branch: app/WHR-27-settings
linear: WHR-27
tier: high
reviewed_head: 655cb1126b69318e107c515d03e1cd74ba6cf54e
rounds: 3
builder: frontend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 17
plan:
  goal: implement approved admin settings screens against merged WO-core-14 routes
  files: src/client/admin-settings*, src/ui/admin/settings*, src/ui/admin route wiring, tests/e2e/settings*, tests/design-parity/settings, docs/briefs/admin-row-14-settings.md, docs/qa/smoke-2026-11-13-settings.md
  approach: server-authoritative reads and retention review-confirm with immutable retry identity; timing locked until WHR-55; existing shell and design tokens
  tests: strict API decoding, null and invalid days, stale review and version conflict, lost response retry, permissions, real-stack Playwright, independent 1440px fidelity
  risks: ambiguous confirmation must retain identity; no timing mutation or automatic deletion; no board defaults or persistent sensitive browser state
invariants: [I-07, I-09, I-41, I-45, I-51]
p1: ["fixed HTTP429 preservation of frozen confirmation", "fixed browser assertion to await settled uncertainty state"]
tickets: [WHR-140, WHR-141, WHR-142]
---
Plan committed at cd542d3 before builder dispatch; base 86cfecc.
Final code/security/integrity verdicts PASS on reviewed_head; code/security round 3, integrity second completed invocation in global round 3.
R1 found lost-response plus HTTP 429 discarded the frozen operation; one-line classifier fix and red/green unit/browser regressions retain identical replay.
R2 found incorrect rate-limit copy in the regression; settled-state assertions now verify uncertainty and exactly one version/history/receipt.
Real pre-commit metadata refusals are proven effect-free and explicitly reviewed again (max 3); no version substitution or post-commit re-review.
EM typecheck/lint/build PASS; 870 unit tests PASS. Two inherited sales image warnings remain.
Full browser gate: 360 PASS, 4 existing staging-only skips, 0 failures (10.3m) (one worker, zero retries).
Focused settings 22 PASS; concurrent settings/station/review 68 PASS; two workers, zero retries. Independent fidelity 1 PASS, 12 PNGs/12 metrics at 1440/390/360 px.
WHR-142 tracks three valid metadata refusals exhausting concurrent fixture setup; serial full gate preserves assertions. WHR-140 tracks inherited M3 fixture ordering; WHR-141 tracks one non-reproduced phone correction local-state flake. Isolated feature/base correction tests each 2 PASS; no unrelated code changed.
Dispatch flag exceeded: 17 calls, 16 started and 1 capacity refusal; independent builders/fidelity fixes plus three review rounds. No escalation or cap extension.
Timing stays locked until WHR-55; no server/shared/STATUS/coverage/lane changes. Smoke: docs/qa/smoke-2026-11-13-settings.md.
