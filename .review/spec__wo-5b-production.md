---
branch: spec/wo-5b-production
linear: WHR-186
tier: high
reviewed_head: 3df1bc98604a237acd7cf37271f2c30a2142a76e
rounds: 2
builder: spec-em
reviewers:
  code-reviewer: PASS (round 2)
  security-reviewer: PASS (round 2)
  integrity-reviewer: PASS (round 2)
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 6
plan:
  goal: Specify recoverable production operations and explicit launch decisions for WHR-29 and WHR-31
  files: docs/ops/production.md, docs/engineering/contracts/operations.md, docs/engineering/decisions/INDEX.md, docs/engineering/decisions/technical.md
  approach: Ground eight operational areas in approved contracts, separate recommendations from activation, preserve all evidence, and enumerate owner/default gates
  tests: Source and scope audit, typecheck, lint, unit tests, build, three independent specification reviews, evidence validator
  risks: Incomplete database-photo recovery, silent policy gaps, incompatible activation, secret loss on spec reapply, or accidental retention authority
invariants: [I-22, I-25, I-26, I-28, I-41, I-45, I-46, I-49]
p1: ["fixed production TLS prerequisite and pg/Prisma verification in setup, promotion and WHR-31 impact notes"]
tickets: []
---
All eight operational areas are specified in production.md; operations.md preserves
health projections/status semantics while adding protected monitoring and release gates.
T-22 records the engineering boundary; 24 owner/default decisions remain proposals.
Round 1 code review found the existing DB TLS wrapper is staging-only. The spec now
blocks production on reviewed WHR-206 implementation and positive/negative local
pg/Prisma TLS tests; no application code was changed. All three round 2 verdicts PASS
at reviewed_head. Worktree stayed clean and head unchanged after each review round.
EM verification: typecheck, lint (four inherited image warnings), 997 unit tests and
build PASS. Final evidence-head rerun recorded in the PR. No integration/e2e rerun
required for this documentation-only change; GitHub runs its normal checks.
Source/scope audit: eight areas, required inputs, 24 owner/default rows and local
links checked. No code, cloud actions, doctl, secrets, client data or commercial terms;
no STATUS, coverage-map or lane edits. WHR-29/31 impact comments posted in Linear.
WHR-188 through WHR-205 hold new decision questions; existing human gates are reused.
Rook review and Earl acceptance remain after READY; no client policy or release go
is inferred from the specification merge.
