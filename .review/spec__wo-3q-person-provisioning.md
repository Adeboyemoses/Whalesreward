---
branch: spec/wo-3q-person-provisioning
linear: WHR-222
tier: high
reviewed_head: 64bad98bf8383e9d59b05f79b6e69e4236933508
rounds: 2
builder: spec-em
reviewers:
  code-reviewer: PASS (round 2)
  security-reviewer: PASS (round 2)
  integrity-reviewer: PASS (round 2)
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 6
plan:
  goal: specify private operator provisioning for canonical people without runtime activation
  files: docs/engineering/contracts/person-provisioning.md, docs/engineering/contracts/m3.md, docs/ops/person-provisioning.md, docs/engineering/decisions/INDEX.md, docs/engineering/decisions/technical.md
  approach: append-only bindings and scoped revision guard, fail-closed identity, explicit downstream invalidation and fictional walkthrough
  tests: source trace, Markdown links, diff check, typecheck lint unit build and three independent spec reviewers
  risks: alias self-approval, stale proposals and phone evidence, operator target confusion, private identity disclosure
invariants: [I-07, I-09, I-35, I-41, I-46]
p1: ["fixed explicit P-29 historical-proposer rejection in both phases"]
tickets: [WHR-223, WHR-224, WHR-225]
---
Specification only: operator contract, private verification, append-only bindings,
all-enabled-account gate, downstream invalidation and fictional M4 walkthrough.
T-24 records only Earl's settled operator delivery choice; WHR-223–225 remain open.
Round 1 code/integrity P1: existing P-29 rejection still needs live proposer binding.
Fixed by explicitly requiring historical-proposer rejection at preflight and commit,
retaining current decider authority, exclusions, versions, receipts and audit.
Round 2 code/security/integrity all PASS on the exact reviewed head, no blockers.
Worktree clean and head unchanged after each round. No reviewer edited files.
EM typecheck/lint/unit/build passed; 111 files and 1,024 unit tests.
Lint has four existing image warnings, zero errors. Markdown target checks and
whitespace diff passed. No runtime implementation or staging smoke claimed.
No STATUS, coverage-map, lane files, credentials or client data changed.
