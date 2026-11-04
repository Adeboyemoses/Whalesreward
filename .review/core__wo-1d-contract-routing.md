---
branch: core/wo-1d-contract-routing
linear: WHR-53
tier: high
plan:
  goal: require high-tier review for contract and data-model documentation
  files: scripts/review/routing.conf, scripts/review/test-review.sh, lane and STATUS and coverage records
  approach: add two rules in enforcement block before generic docs exemption with narrow regression cases
  tests: review gate self-test, guard self-test, typecheck, lint, unit and build
  risks: gate change must preserve all unrelated routing and evidence enforcement
---
