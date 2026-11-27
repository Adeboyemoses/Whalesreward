---
branch: app/WHR-230-pickers
linear: WHR-230
tier: medium
reviewed_head: 17f47eac19e9136652d1a4143a6c28a1cb7258bc
rounds: 3
builder: frontend-engineer
reviewers:
  code-reviewer: PASS (round 3)
  integrity-reviewer: PASS (round 3)
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 9
invariants: [I-45]
p1: []
tickets: [WHR-236]
escalation: Earl authorized round 3 (test-only CI-coverage fix, both reviewers PASS) on 2026-11-27
---

WO-app-13c (WHR-230), screens only: date/time pickers + searchable IANA timezone list
replacing free-text ISO-datetime and timezone fields for launchAt/purchaseStart/
purchaseCutoff. Wall-clock input is read in the selected campaign timezone, converted
via Intl-only DST-aware offset computation to the same explicit-offset instant the
server already accepts (`src/shared/contracts/settings.ts` unchanged). New
`src/ui/pickers.tsx` holds the conversion helpers and `TimezoneCombobox`.

Round 1 (859bac2): built pickers/combobox; test-engineer found a real bug (a brand-new
campaign's date+time pair could never be completed) and a test-authoring issue (settings
read normalizes to UTC `Z`, same instant); both fixed. Reviewers PASS, 2 non-blocking P2
a11y findings on `TimezoneCombobox` (no blur-revert; missing aria-activedescendant).

Round 2 (a55437a): fixed both P2s (EM, ~15 lines). Reviewers re-confirmed PASS.

Round 3 (17f47ea, test-only, no production code): this PR's field-split broke two
pre-existing, previously-passing specs (`campaign-timing-real.spec.ts`,
`capture.spec.ts`) asserting the old labels/free-text timezone field; CI's `e2e` job
failed. Mis-filed first as out-of-scope found-work (WHR-234, closed as fixed-in-WHR-230);
corrected and fixed here instead. Also merged 3 WHR-230 tests out of a standalone
`pickers-timezone-real.spec.ts` into `campaign-timing-real.spec.ts` (file deleted): both
used the same worker-scoped real-server fixture, doubling peak CI concurrency — the
likely cause of unrelated `settings-real.spec.ts`/`leaderboards-real.spec.ts` timeouts.
Reviewers re-reviewed the full commit given I-45 relevance, confirmed the Africa/Accra-
for-UTC zone substitution (UTC has no combobox entry — WHR-236) is instant-equivalent,
confirmed `test.use({ timezoneId })` scoping doesn't leak. PASS, no findings. Round cap
exceeded with Earl's recorded go above.

Verification (real output, final head 17f47ea): typecheck/lint clean, unit 1055/1055,
`test:time` 14/14 under TZ=UTC and TZ=America/New_York, build clean,
`campaign-timing-real.spec.ts` 22 passed/2 skipped (worker-shared-DB, expected) on a
real local Postgres 16 + Next server, both projects. Fidelity at 1440/390/360px: no
diffs, 48px targets and keyboard operability confirmed.

Found-work, not fixed here: WHR-236 (no "UTC" entry in the new timezone list).
