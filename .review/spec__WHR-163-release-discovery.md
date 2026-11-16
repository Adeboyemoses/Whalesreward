---
branch: spec/WHR-163-release-discovery
linear: WHR-163
tier: high
reviewed_head: 6cd0870
rounds: 1
builder: spec-em
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
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
Specification only. Reviewer results pending. No runtime behavior or activation claimed.
