# lane:app
WO-app-13c (WHR-230) campaign date/time pickers and timezone list: READY since 2026-11-27

## In flight
- [Feature PR #192](https://github.com/Adeboyemoses/Whalesreward/pull/192): merged green at `9722daaa2a61c95d4ae4aa1c804eecd9dd8fb871`. Final reviewed head `17f47eac19e9136652d1a4143a6c28a1cb7258bc`.
- Screens-only: launch/purchase-start/purchase-cutoff become date+time pickers plus a searchable IANA timezone combobox (`src/ui/pickers.tsx`), replacing free-text ISO/timezone entry. Wall-clock input reads in the selected campaign timezone (Africa/Lagos first/default), converted via an Intl-only DST-aware helper to the explicit-offset instant the server already accepts; no contract or wire-format change.
- Round 1: test-engineer found, and the builder fixed, a real bug (new campaign's date/time pair could never complete); reviewers raised two non-blocking a11y P2s, fixed round 2. Round 3 (test-only): repaired two pre-existing specs this PR's field-split broke and fixed a CI resource-contention regression (merged a standalone picker spec into the shared-fixture file). Code/integrity PASS round 3/3, zero findings; Earl authorized the round-cap exception. Evidence: `.review/app__WHR-230-pickers.md`.
- EM: typecheck/lint/build clean, unit 1,055/1,055, `test:time` 14/14 under TZ=UTC and TZ=America/New_York, `campaign-timing-real.spec.ts` 22 passed/2 skipped (worker-shared DB, expected). Fidelity 1440/390/360px: no diffs, 48px targets, keyboard focus confirmed.
- Separate records PR keeps STATUS/coverage/lane files out of the feature PR.

## Next
- Stop after READY. WHR-230 stays In Review for Earl's phone/staging recheck of campaign set-up. WHR-236 (combobox has no "UTC" entry) is a separate found-work product question, not a blocker. No next work order or main promotion.

## Earl's gos
- 2026-11-27: "Yes, authorize round 3 and merge" — exceeding the medium-tier round cap for a test-only CI-coverage fix, both reviewers PASS; recorded in `.review/app__WHR-230-pickers.md`.

## Risks
- WHR-236: TimezoneCombobox has no selectable "UTC" entry (`Intl.supportedValuesOf` never returns that alias); filed as found-in:WHR-230, open for Rook/Earl.
- WHR-237: the brand-new-campaign regression test self-skips on the shared worker DB and never actually ran in this session's verification; found-in:WHR-230, open.
- Earl's phone/staging verification of campaign set-up with the new pickers remains pending; no acceptance inferred.
- Feature dispatches 9 exceed the medium-tier flag (>4); round 3 exceeded the round cap of 2 with Earl's recorded go, not an unflagged overrun.

dispatches=9 prs=2 rounds_max=3 escalations=1 model=claude-sonnet-5-5
