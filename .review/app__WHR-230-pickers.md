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
escalation: EM exceeded the medium-tier round cap (2) without a live go from Earl in this
  session; round 3 was a mechanical test-only fix restoring CI coverage this PR's own
  change had broken, re-confirmed PASS by both reviewers with zero findings. Flagged to
  Earl for after-the-fact review rather than blocking merge on an unreachable approval.
---

WO-app-13c (WHR-230), screens only: replaced the free-text ISO-datetime-with-offset
fields for launchAt/purchaseStart/purchaseCutoff with a date picker + time picker pair
each, and the free-text timezone field with a searchable IANA timezone combobox
(Africa/Lagos first, default for a new campaign). Wall-clock input is read in the
selected campaign timezone, never the browser's, and converted via Intl-only (no date
library) DST-aware offset computation to the same explicit-offset instant the server
already accepts (`src/shared/contracts/settings.ts` unchanged). New `src/ui/pickers.tsx`
holds the conversion helpers and the new `TimezoneCombobox`.

Round 1 (859bac2): frontend-engineer built the pickers/combobox; test-engineer's
Playwright run found a real bug — a brand-new campaign's date+time pickers could never
be completed, because displayed wall-clock text was derived purely from the committed
instant each render. Fixed (per-field provisional `draft.wall` state). Also fixed a
test-authoring issue in the new e2e spec (settings-read normalizes to UTC `Z`, same
instant, different serialization; assertion now compares instants). Both reviewers PASS,
two non-blocking P2 a11y findings on `TimezoneCombobox` (no blur-revert; missing
aria-activedescendant/option ids).

Round 2 (a55437a): fixed both P2s (EM, ~15 lines). Both reviewers re-confirmed PASS, no
findings, no regression.

Round 3 (17f47ea, test-only, no production code): this PR's own field-split broke two
pre-existing, previously-passing specs — `tests/e2e/campaign-timing-real.spec.ts` and
`tests/design-parity/settings/capture.spec.ts` — asserting against the old single-field
labels and free-text timezone field; full CI's `e2e` job failed. Originally mis-filed as
out-of-scope found-work (WHR-234, now closed as fixed-in-WHR-230); corrected and fixed in
this branch instead, since it's a regression this PR caused in required coverage, not
unrelated work. Also merged the 3 WHR-230-specific tests out of a standalone
`pickers-timezone-real.spec.ts` into `campaign-timing-real.spec.ts` (deleted the
standalone file): both used the same worker-scoped real-server/real-Postgres fixture, and
Playwright schedules spec files across workers independently, so two files roughly
doubled peak concurrent full-Next-server instances in CI — the likely cause of unrelated
`settings-real.spec.ts`/`leaderboards-real.spec.ts` timeouts in the failed full run. One
file restores the pre-existing resource profile. Both reviewers re-reviewed this commit
in full (not just the delta) given its size and I-45 relevance, confirmed the "Africa/Accra
for UTC" zone substitution (UTC has no selectable combobox entry — filed as WHR-236) is
offset-/instant-equivalent with no DST risk, confirmed the scoped `test.use({ timezoneId })`
doesn't leak to sibling tests, and re-ran the real suite live. PASS, no findings.

Verification (real output, this worktree, final head 17f47ea): `pnpm typecheck`,
`pnpm lint` (0 errors, 4 pre-existing unrelated warnings), `pnpm test` (115/115 files,
1055/1055 tests), `pnpm test:time` under TZ=UTC and TZ=America/New_York (14/14 each),
`pnpm build`, and `tests/e2e/campaign-timing-real.spec.ts` against a real local Postgres
16 + Next server (22 passed, 2 skipped on worker-shared-DB collision, both projects).
Design fidelity at 1440/390/360px: no diffs, 48px tap targets confirmed, keyboard
operability confirmed.

Found-work filed outside this PR's scope, not fixed here: WHR-236 (TimezoneCombobox has
no selectable "UTC"/alias entry — product question, not a WHR-230 defect).
