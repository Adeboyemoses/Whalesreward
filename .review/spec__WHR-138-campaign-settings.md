---
branch: spec/WHR-138-campaign-settings
linear: WHR-138
tier: high
reviewed_head: 4cbb2330172ad58602c21be2b7d6397f6a459471
rounds: 2
builder: spec-em
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 6
plan:
  goal: specify Owner-only campaign setup and pre-start timing changes under P-28
  files: docs/engineering/contracts/m4.md, docs/engineering/contracts/operations.md, docs/engineering/data-model.md, docs/engineering/decisions/INDEX.md
  approach: extend giveaway review-confirm for create and update, record approved policy identity, preserve locks and history, ground impact notes in PRs 135 and 138
  tests: final-head typecheck, lint, unit tests, build, documentation consistency and evidence validation
  risks: concurrent creation, old-start lock bypass, replay authority, stale policy or eligibility lineage, retention contamination
invariants: [I-07, I-09, I-41, I-45, I-45a, I-46, I-51]
p1: ["fixed policy binding for stations created after migration in their idempotent bootstrap transaction"]
tickets: []
---
Specification only: P-28 Owner-only campaign creation and five-field timing review/confirm;
pre-start/any-snapshot locks, replay, policy health, audit/history and core/app impact notes.
Round 1: code found a P1 fresh-install gap in migration-only station policy binding.
Verified migration-before-station ordering; defined immutable global registration,
existing-station migration binding and transactional idempotent later-station bootstrap.
Round 2: all three independent reviewers PASS, no open findings.
EM gates: typecheck, lint (two inherited image warnings), 870 unit tests and build PASS.
Relative documentation links, diff whitespace and specification-only scope PASS.
No runtime policy activated; follow-up implementation tests are obligations, not coverage.
No STATUS, coverage-map, lane, app/server code or product-docs edits.
