---
branch: spec/wo-4-m4-contracts
linear: WHR-51
tier: high
reviewed_head: 24e794d9860aa61ec86fcdc1ecfd1f591d6b7afb
rounds: 2
builder: spec-em
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 6
invariants: [I-07, I-09, I-11, I-14, I-28, I-29, I-32, I-34, I-35, I-39, I-40, I-41, I-42, I-43, I-44, I-45, I-45a, I-46, I-47, I-48, I-49, I-51, I-52]
p1: [fixed unchanged-result reconciliation, fixed versioned audit field contract]
tickets: [WHR-54, WHR-55, WHR-56]
plan:
  goal: Specify M4 rankings, finalization, reports, overview and settings for parallel implementation.
  files: docs/engineering/contracts/m4.md, docs/engineering/data-model.md, docs/engineering/coverage-map.md, docs/agentic/lanes/spec.md, STATUS.md
  approach: Reuse M1-M3 protocols; exact accepted-revision totals; serialized immutable snapshots; explicit unresolved policy gates.
  tests: EM typecheck, lint, unit, build, paragraph and contract consistency checks; independent code/security/integrity review.
  risks: Capture/deadline ambiguity, stale reconciliation, changed permissions, export precision, unintended retention deletion.
---
M4 specifies 26 endpoints and supporting storage, with exact accepted-revision totals, immutable giveaway results, reviewed settings and disabled deletion. No code, migrations, prize fulfilment, product-doc edits or cloud operations.

Round 1: integrity/security PASS; code review found two P1 gaps. Round 2: all three PASS after adding reconciliation-only success for bookkeeping-only changes and an explicit version-2 audit field/action contract. Each reviewer left the worktree clean and HEAD unchanged.

EM typecheck, lint, 27 unit tests and build passed. New M4 prose paragraphs are at most 94 words; model additions at most 83. Endpoint uniqueness, local links and diff whitespace passed. Final-head gates are rerun after this evidence commit. Repository validator exempts docs; supplemental evidence checks verify high-tier reviewers, plan identity, ancestry and only evidence changes after review.

WHR-54/55/56 are downstream policy questions, not unresolved review defects. Production values stay unset; unsupported finalization is blocked and photo deletion remains disabled. READY takes effect only on green staging merge; then stop for Earl’s acceptance.
