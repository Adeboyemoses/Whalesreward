---
branch: app/wo-1-wrap-fix
linear: WHR-2
tier: high
reviewed_head: d41785f247ff9888517fed995efc0f156293e8d3
rounds: 2
builder: frontend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 9
invariants: []
p1: []
tickets: []
plan:
  goal: fix Earl’s AppHeader wordmark and narrow LoyaltyCard footer wrapping findings
  files: src/ui/navigation.tsx, src/ui/data-display.tsx, src/styles/app.css, tests/design-parity/design-system/**, docs/qa/**, .codex/agents/test-engineer.toml, lane/status/coverage docs
  approach: preserve wordmark nowrap, subordinate surface label, stack narrow card footer with mono customer ID; leave vendored styles unchanged
  tests: reproduce failures before fix, line-box and overflow assertions at actual 390px and 360px, independent screenshots against A02/A07, all app gates and browser suites
  risks: descendant selectors may affect new spans; preserve admin brand layout, card code, target sizes and explicit fixture-only scope
---
Saved before builder or test-engineer dispatch. No credit, persistence, quantity formatting or auth changes.

All three independent reviewers PASS on reviewed_head, no findings or reviewer edits.
Four actual-width glyph regressions failed before the fix at 390px/360px, then passed.
Independent test-engineer compared A02/A07 and nine target captures; report docs/qa/design-system-wrap-fidelity.md PASS.
EM final gates PASS: typecheck, lint, 18 unit tests, build, 4 production browser tests and 14 gallery checks.
The agent-file gotcha is required by the escape-to-test rule and does not expand authority.
Quantity display remains WHR-45; no auth, persistence, credit or vendor CSS changes.
Generated Next agent-file append and unrelated raster shifts excluded after testing; source worktree clean before evidence.
Second round checked the synchronized staging head and preserved both coverage-map entries; no new findings.
Review-gate self-tests 39/39 and guard self-tests 94/94 PASS; nine dispatches flagged in lane notes.
