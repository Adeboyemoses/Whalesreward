---
branch: spec/wo-3h-evidence-policy
linear: WHR-103
tier: high
reviewed_head: 32573677300bb7e4dad20db94645542834f747e1
rounds: 1
builder: spec-em
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 3
plan:
  goal: propose evidence admissibility for price, card, date and capture without activating policy
  files: docs/engineering/proposals/evidence-policy.md, docs/engineering/coverage-map.md, docs/agentic/lanes/spec.md, STATUS.md
  approach: bounded server facts, per-kind sufficiency and exclusions, versioned configuration, protected health, client questions
  tests: EM typecheck/lint/unit/build; prose limit, local links, unchanged m3; independent code/security/integrity review
  risks: circular evidence, invented capture time, unsupported cancellations, cross-sale references, accidental policy activation
invariants: [I-05a, I-07, I-22, I-25, I-26, I-28, I-31, I-33, I-34, I-35, I-41, I-45a, I-46, I-48]
p1: []
tickets: []
---

Proposal only. High tier retained from WHR-103 despite docs-only routing.
Code, security and integrity reviewers independently passed the reviewed head in round 1, with no findings.
Reviewers were read-only; the worktree stayed clean and HEAD stayed unchanged after review.
EM verification: typecheck PASS; lint PASS (two inherited image warnings); 631 unit tests PASS; production build PASS.
Proposal paragraph maximum 86 words; relative links, lane size and whitespace checks PASS. m3.md is unchanged.
No runtime or normative policy is activated. WHR-50 remains separate; no migration, user-flow change or additional integration/browser gate applies.
Client questions EP-1–EP-5 are WHR-109 and WHR-105–108, each with options, recommendation and an explicit no-activation default.
Shared records were removed from this PR for the required separate READY update; the proposal remains byte-identical to reviewed_head.
After merging newer staging 5176260, EM typecheck/lint, 663 unit tests and build PASS. No proposal conflict or source-contract change occurred.
