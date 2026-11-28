---
branch: core/WHR-240-m4-station-note
linear: WHR-240
tier: high
reviewed_head: efdf8a7
rounds: 1
builder: EM (docs-only, per AGENTS.md session protocol)
reviewers:
  code-reviewer: PASS (round 1)
  security-reviewer: PASS (round 1)
  integrity-reviewer: PASS (round 1)
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 3
plan:
  goal: document the already-merged, already-reviewed additive Report.station field (WHR-239/WHR-240 Option A) in the m4 contract spec, with no code change
  files: docs/engineering/contracts/m4.md
  approach: add a short amendment note above the Reports-and-exports type block, and add `station:{id:Id;name:string}|null` to the documented `Report` type literal, matching exactly what src/shared/contracts/reports.ts already ships (merged in WHR-239, PR #198)
  tests: none — documentation only, nothing executable changes; the field's runtime behavior (additive, nullable, backward-compatible with pre-change frozen snapshots) was already tested and merged in WHR-239
  risks: none identified — this is a pure spec note describing shipped, reviewed code; the only risk is the note drifting from the real type if reports.ts changes again without a follow-up doc update
invariants: [I-46]
p1: []
tickets: []
---

Split out of WHR-239 (PR #198) after that PR was mistakenly reviewed as
medium tier — this file alone makes any PR touching it high tier per
`docs/engineering/contracts/**`, which wasn't caught until after two
medium-tier review rounds had already run on the combined branch. Rather
than backfill a plan onto already-reviewed code, the `m4.md` commit was
reverted off that branch and moved here, with the plan written and
committed before any reviewer was dispatched, as high tier requires.

All three reviewers (code, security, integrity) ran fresh in round 1 and
returned PASS with zero blocking findings. Each independently verified
every clause of the amendment note against the real shipped code on
staging (reports.ts, data.ts, export-service.ts, exports.ts, renderer.ts)
rather than trusting the prose: the field is additive/nullable/optional,
old frozen snapshots have no `station` key and are never schema-validated
on render, the renderer already prints no station name when it's absent,
and the field is display-only with no new endpoint, permission or data
exposure (security-reviewer specifically traced it back to the
single-station `reportAuthority()` lookup, never request-supplied).

All three also independently caught the same non-blocking P2: the
documented `Report` type literal wrote `station:{...}` (reads as
always-present) when the shipped schema is `.nullable().optional()`,
contradicting both the code and the amendment note's own "nullable and
optional" wording. Fixed directly in this round (one-character change to
`station?:{...}`) rather than opening a ticket, since it's within the
EM's small-fix allowance and matching the code exactly was this PR's only
deliverable.
