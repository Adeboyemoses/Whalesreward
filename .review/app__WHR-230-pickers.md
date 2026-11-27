---
branch: app/WHR-230-pickers
linear: WHR-230
tier: medium
reviewed_head: a55437aabbc58c0cf4ce1b803093a66fe29d51f0
rounds: 2
builder: frontend-engineer
reviewers:
  code-reviewer: PASS (round 2)
  integrity-reviewer: PASS (round 2)
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 5
invariants: []
p1: []
tickets: [WHR-234]
---

WO-app-13c (WHR-230), screens only: replaced the free-text ISO-datetime-with-offset
fields for launchAt/purchaseStart/purchaseCutoff with a date picker + time picker pair
each, and the free-text timezone field with a searchable IANA timezone combobox
(Africa/Lagos first, default for a new campaign). Wall-clock input is read in the
selected campaign timezone, never the browser's, and converted via Intl-only (no date
library) DST-aware offset computation to the same explicit-offset instant the server
already accepts (`src/shared/contracts/settings.ts` unchanged). New `src/ui/pickers.tsx`
holds the conversion helpers and the new `TimezoneCombobox`.

Round 1 (commit 859bac2): frontend-engineer built the pickers/combobox; test-engineer's
Playwright run found a real bug — a brand-new campaign's date+time pickers could never
be completed, because displayed wall-clock text was derived purely from the committed
instant each render. Routed back to frontend-engineer and fixed (per-field provisional
`draft.wall` state). Also found and fixed a test-authoring issue in the new e2e spec's
own assertion (expected a literal offset string back from settings-read, which
`canonicalTimingInstants` legitimately normalizes to UTC `Z` — same instant, different
serialization; fixed the assertion to compare instants). code-reviewer and
integrity-reviewer both PASS at 859bac2, with two non-blocking P2 accessibility findings
on `TimezoneCombobox` (no blur-revert for keyboard users; missing
aria-activedescendant/option ids).

Round 2 (commit a55437a): fixed both P2s directly (EM, ~15 lines). Both reviewers
re-reviewed the incremental diff only and confirmed the fix is correct, doesn't touch
the commit/onChange path, and introduces no regression. PASS, no findings, no blockers.

Verification (real output, this worktree): `pnpm typecheck`, `pnpm lint` (0 errors, 4
pre-existing unrelated warnings), `pnpm test` (115/115 files, 1055/1055 tests),
`pnpm test:time` under TZ=UTC and TZ=America/New_York (14/14 each), `pnpm build`, and
`pnpm playwright test tests/e2e/pickers-timezone-real.spec.ts` against a real local
Postgres 16 + Next server (4 passed, 2 skipped on worker-shared-DB collision, confirmed
passing in isolation). Design fidelity at 1440/390/360px: no diffs, 48px tap targets
confirmed, keyboard operability confirmed.

Found-work filed outside this PR's scope, not fixed here: WHR-234 (two pre-existing
Playwright specs reference the old pre-split field labels).
