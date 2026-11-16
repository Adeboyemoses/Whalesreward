---
branch: spec/WHR-163-release-discovery
linear: WHR-163
tier: high
reviewed_head: 9dfbf0901054f21ec54f7e95652c7c0862ce5642
rounds: 2
builder: spec-em
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 6
plan:
  goal: Specify protected release preparation and complete pending proposal discovery
  files: docs/engineering/contracts/m3.md, docs/engineering/decisions/INDEX.md, docs/engineering/decisions/technical.md
  approach: Extend P-29 reads using WHR-159/160 decisions and WHR-153 implementation; preserve all mutation and finalization gates
  tests: Independent code/security/integrity contract review; typecheck, lint, unit tests, build, diff and evidence checks
  risks: Read admission mistaken for approval; inaccessible or stale proposals omitted; mixed snapshots or disclosure after revocation
invariants: [I-07, I-09, I-26, I-35, I-39, I-41, I-46, I-48, I-49]
p1: []
tickets: []
---
Specification only; no runtime behavior or activation claimed.
All three independent reviewers passed both rounds with no actionable findings.
Round 2 checked explicit snapshot-after-security-serialization ordering for pending paging.
Original context, candidate/guards and structural admission remain separate from credit.
Authorized queue discovery does not narrow giveaway blockers or expose protected narrative.
EM verification: typecheck, lint (two inherited image warnings), 955 unit tests and build PASS.
Relative file links and diff whitespace PASS. No code, STATUS, coverage-map or lane edits.
Rook review and Earl acceptance remain separate from READY and staging merge.
