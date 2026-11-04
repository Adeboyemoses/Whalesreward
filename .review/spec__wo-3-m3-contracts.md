---
branch: spec/wo-3-m3-contracts
linear: WHR-46
tier: high
reviewed_head: b21bd05bad9c694df42831cb98908b7601bc6d8a
rounds: 3
builder: spec-em
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 12
plan:
  goal: specify M3 corrections, exception reviews, customer changes, recovery and audit
  files: docs/engineering/contracts/m3.md, docs/engineering/data-model.md, coverage-map.md, lane spec and STATUS.md
  approach: preserve M1/M2 wire and authority rules; independent holds, immutable history and explicit unresolved-policy gates
  tests: EM typecheck, lint, test and build; independent code, security and integrity contract review
  risks: no implementation claimed; unresolved evidence and identity policies cannot authorize credit or account changes
invariants: [I-03, I-05a, I-06, I-07, I-09, I-11, I-15, I-19, I-21, I-21a, I-22, I-25, I-26, I-28, I-29, I-31, I-33, I-34, I-35, I-36, I-37, I-38, I-39, I-40, I-41, I-42, I-45a, I-46, I-48, I-49, I-50]
p1: [fixed card version reads, fixed scoped recovery reconciliation, fixed strict attendant shapes, fixed audit target mapping, fixed multi-hold cancellation, fixed canonical correction replay]
tickets: [WHR-47, WHR-48, WHR-49, WHR-50]
---

38 M3 endpoint contracts and supporting model additions; no product implementation or parity claim.
Docs routing requires no evidence, but EM raised review to high for credit/auth contract risk.
All three independent reviewers PASS on the same reviewed head; full verdicts are in the PR.
Round 1 blocked unauthenticated recovered-correction automatic acceptance; now preserved as an unverified proposal without changing accepted credit.
Round 1 also fixed card guard acquisition, scoped recovery base reads, strict attendant schemas, audit targets, hold cancellation storage and frozen retry bodies.
Round 2 clarified canonical correction identity excludes changing recovery wrapper/grant/session identity; final round passed.
EM typecheck, lint, 18 unit tests and production build pass. No code/schema/flow changed, so integration/e2e not applicable.
Existing WHR-38/39 and new WHR-47–50 remain explicit implementation gates, not approved policies.
12 dispatches exceeds high-tier flag 8; nine reviews across three rounds plus three unchanged-contract synchronized-head confirmations, no additional fix round or cap escalation.
The concurrent core closeout was merged from staging to meet branch freshness; contract/model/coverage blobs are identical to the previously reviewed head.
