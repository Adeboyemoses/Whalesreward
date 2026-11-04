---
branch: app/wo-1-wrap-fix
linear: WHR-2
tier: high
plan:
  goal: fix Earl’s AppHeader wordmark and narrow LoyaltyCard footer wrapping findings
  files: src/ui/navigation.tsx, src/ui/data-display.tsx, src/styles/app.css, tests/design-parity/design-system/**, docs/qa/**, .codex/agents/test-engineer.toml, lane/status/coverage docs
  approach: preserve wordmark nowrap, subordinate surface label, stack narrow card footer with mono customer ID; leave vendored styles unchanged
  tests: reproduce failures before fix, line-box and overflow assertions at actual 390px and 360px, independent screenshots against A02/A07, all app gates and browser suites
  risks: descendant selectors may affect new spans; preserve admin brand layout, card code, target sizes and explicit fixture-only scope
---
Saved before builder or test-engineer dispatch. No credit, persistence, quantity formatting or auth changes.
