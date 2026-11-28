---
branch: core/WHR-240-m4-station-note
linear: WHR-240
tier: high
reviewed_head: PENDING
rounds: 0
builder: EM (docs-only, per AGENTS.md session protocol)
reviewers:
  code-reviewer: PENDING
  security-reviewer: PENDING
  integrity-reviewer: PENDING
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: document the already-merged, already-reviewed additive Report.station field (WHR-239/WHR-240 Option A) in the m4 contract spec, with no code change
  files: docs/engineering/contracts/m4.md
  approach: add a short amendment note above the Reports-and-exports type block, and add `station:{id:Id;name:string}|null` to the documented `Report` type literal, matching exactly what src/shared/contracts/reports.ts already ships (merged in WHR-239, PR #198)
  tests: none — documentation only, nothing executable changes; the field's runtime behavior (additive, nullable, backward-compatible with pre-change frozen snapshots) was already tested and merged in WHR-239
  risks: none identified — this is a pure spec note describing shipped, reviewed code; the only risk is the note drifting from the real type if reports.ts changes again without a follow-up doc update
invariants: []
p1: []
tickets: []
---

Split out of WHR-239 (PR #198) after that PR was mistakenly reviewed as
medium tier — this file alone makes any PR touching it high tier per
`docs/engineering/contracts/**`, which wasn't caught until after two
medium-tier review rounds had already run on the combined branch. Rather
than backfill a plan onto already-reviewed code, the `m4.md` commit was
reverted off that branch and moved here, with the plan written and
committed before any reviewer is dispatched, as high tier requires.

The change itself: one amendment note plus one field (`station`) added to
the `Report` type literal in the "Reports and exports" section, matching
the additive, nullable, optional field that shipped in WHR-239/PR #198
(src/shared/contracts/reports.ts, already merged to staging). No code,
schema or endpoint changes here — pure documentation of what's already
live.
