---
branch: core/wo-15-staging-fix
linear: WHR-28
tier: high
reviewed_head: e0be4e938ade57b0f945f637b302d7f71f4cd597
rounds: 1
builder: platform-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 4
invariants: [I-01, I-09, I-48]
p1: []
tickets: [WHR-58]
plan:
  goal: align staging source and runbook with console and accepted authentication
  files: .do/app.staging.yaml, docs/ops/staging.md, staging regression tests, lane and status and coverage records
  approach: attach managed pg cluster, document provider-owned IP header and Earl-only credentials, close accepted WHR-4
  tests: staging spec regression, typecheck, lint, unit, build and review validation
  risks: no cloud operations; empty secrets must never overwrite live settings; IP header requires trusted overwrite
---

Three independent reviewers passed with no findings. Header trust stays empty pending WHR-58 provider assurance; no cloud validation claimed.
EM typecheck, lint, unit80 and build passed. Three new regressions fail against old configuration and pass with the fix.
Accepted authentication closeout uses verified PR #30 and its green CI; source FIX READY follows green staging merge.
