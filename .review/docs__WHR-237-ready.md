---
branch: docs/WHR-237-ready
linear: WHR-237
tier: docs
reviewed_head: 5b05592
rounds: 0
builder: engineering-manager
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
p1: []
tickets: []
---

Separate records PR after feature PR #194 merged squash to staging at
`1d9c7c3d6df0ddf1c4bec70e6fe34a1baa5cc2c4`. Updates STATUS.md and the app
lane file to record WHR-237's close; no application code, and no
coverage-map change since this fix adds no new invariant coverage (it
makes an existing WHR-230 regression test actually run).

`bash scripts/review/required-reviewers.sh origin/staging...docs/WHR-237-ready`
computes `tier=docs`, no required reviewers, round cap 0. `git status
--porcelain` is empty at the reviewed head. No secrets, personal data or
commercial terms were introduced.
