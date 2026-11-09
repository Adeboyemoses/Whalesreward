---
branch: spec/WHR-91-p23
linear: WHR-91
tier: high
reviewed_head: 5abc12ba5e56709a306d574479f317a426869b37
rounds: 2
builder: spec-em
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 6
plan:
  goal: specify P-23 signed lookup lower bound without changing runtime code
  files: docs/engineering/contracts/m1.md, docs/engineering/contracts/m2.md, docs/engineering/data-model.md, docs/engineering/invariants.md, docs/engineering/decisions/INDEX.md
  approach: bind immutable receipt to original context and evaluate all histories over the narrowed interval
  tests: document consistency, paragraph bounds, typecheck, lint, unit tests, build, independent reviews
  risks: receipt replay, delayed upload, invalid receipt fallback, registration retries and changed payloads
invariants: [I-03, I-05a, I-22, I-28, I-31, I-33, I-34, I-35, I-45a, I-50]
p1: ["fixed strict legacy response compatibility through explicit capability negotiation"]
tickets: []
---
P-23 specification only. All three independent reviewers PASS at the reviewed head.
Round 1 code P1 identified strict legacy response breakage; round 2 confirms capability negotiation fixes it.
EM typecheck, lint, 454 unit tests and production build pass. No runtime P-23 coverage claimed.
No migration, code or shared records are included. Paragraphs are at most 120 words.
