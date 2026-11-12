---
branch: spec/wo-3l-online-price-refresh
linear: WHR-125
tier: high
builder: spec-em
reviewed_head: 4f8af97101bb5c28516d367903b4016c0a53a27b
rounds: 1
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 3
invariants: [I-03, I-04, I-05, I-05a, I-06, I-09, I-22, I-23, I-28, I-28a, I-28b, I-29, I-30, I-31, I-32, I-35, I-49, I-50]
p1: []
tickets: []
plan:
  goal: Specify additive online pump-price refresh for new drafts without rewriting sales or capture bounds
  files: docs/engineering/contracts/{m1,m2}.md, docs/engineering/decisions/INDEX.md
  approach: Capability-gated lookup snapshot plus existing session price; monotonic context-bound adoption; keep and warn on composed drafts
  tests: Compatibility and race acceptance matrix, paragraph and link checks, typecheck, lint, unit tests, build, three independent verdicts
  risks: Late responses must not roll back price or cross accounts; refresh is not trusted capture evidence or renewed offline authority
---

P-27 adds strict capability-gated lookup prices and existing session-price refresh.
Atomic monotonic adoption applies only to future drafts; composed drafts keep and warn.
Price/receipt consistency, immutable sales, capture bounds and zero added requests are explicit.
Code, security and integrity reviewers independently PASS round 1 with no findings.
Review worktree remained clean and head unchanged.
EM typecheck, lint (two inherited image warnings), 689 unit tests and production build PASS.
Paragraph limit PASS (maximum 120 words); local links and diff whitespace PASS.
PR-T1-01–12 are downstream obligations, not runtime coverage or UI parity.
Core and app follow-on work orders are listed for Rook; no implementation or cloud action.
