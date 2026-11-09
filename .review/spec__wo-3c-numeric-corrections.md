---
branch: spec/wo-3c-numeric-corrections
linear: WHR-84
tier: high
reviewed_head: f78f49dfc21f226f5cdffbcd07d03e5822544db8
rounds: 1
builder: spec-em
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 3
invariants: [I-22, I-28, I-29, I-31, I-32, I-37, I-38, I-39, I-41]
p1: []
tickets: []
plan:
  goal: configure P-22 numeric-only retained-photo corrections in the M3 specification
  files: docs/engineering/contracts/m3.md, docs/engineering/decisions/INDEX.md, docs/engineering/coverage-map.md, docs/agentic/lanes/spec.md, STATUS.md
  approach: amend existing policy and correction sections, log WHR-47 decision, preserve other gates and record READY on green staging merge
  tests: EM typecheck lint unit build, evidence validator, paragraph length and local link checks, independent code security integrity reviews
  risks: broader edits or basis switching, invalid evidence, stale bases, late or recovered proposals must gain no new authority
---

P-22 configures numeric-only corrections in the recorded basis against the retained validated meter photo. The M3 amendment removes the unset correction-evidence policy gate for this flow, preserving all other authorization, evidence, timing, exact-calculation and contribution safeguards. Broader correction kinds remain out of scope.

All three independent reviewers returned PASS in round 1 with no findings and all blocking counts zero. Worktree remained clean and the reviewed head unchanged after review.

EM verification: typecheck, lint, 333 unit tests and production build PASS. New/changed prose paragraphs and list items are <=120 words; local Markdown file targets and the new M3 section anchor resolve; diff whitespace PASS. No code, schema or user flow changed; integration/e2e run through ordinary CI, with no new runtime coverage claimed. Rook should mirror P-22 in product docs.

The shared-records validator requires a separate docs-only READY PR after this amendment merges. STATUS.md, the spec lane file and coverage-map.md were therefore removed from this PR; the reviewed M3 and P-22 texts are unchanged. The EM posts merged PRs and verbatim verdicts on WHR-84, then stops at READY. No application code or product-doc write.
