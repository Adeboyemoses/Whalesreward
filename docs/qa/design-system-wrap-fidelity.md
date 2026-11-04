# WO-app-1 FIX: actual-width wordmark and loyalty footer fidelity

Independent checker: test-engineer. Implementation checked: `28f9fc5` (merged into QA as `58ae575`). This report covers Earl’s two findings on WHR-2 after PR #12; it supersedes the previous report’s acceptance of wordmark wrapping as a gallery-gutter note. The old report is historical evidence, not an acceptance of these wraps.

**Result: PASS. No open blocking or fix differences for either finding.**

## Method

Read and opened source A02-Sale and A07-RegisterSuccess HTML/PNG from the read-only product folder. Compared the header’s one-line wordmark and visible connection pill against A02, and the card’s name/identity/station hierarchy and mono customer ID against A07. Earl’s finding explicitly permits the surface label to yield first and requires narrow footer stacking instead of the board’s wider two-column footer. Fixture card/customer IDs differ from A07 but remain the existing fictional gallery values; no registration screen or workflow is implemented.

Chromium used actual viewports **390 × 844** and **360 × 844**, device scale factor 2. No widened 422px viewport or padding override was used for the new regression checks/captures. Gallery gutters remain present, so the available component widths are narrower than the viewport; this deliberately tests the layout Earl saw. Fonts finished loading before measurement. Only Next’s development badge was hidden for screenshots. Product documents are not imported by committed tests or runtime.

The regression helper measures rendered glyph ranges across text nodes. It verifies the wordmark has one glyph line and retains Manrope 800, connection pills are visible and within the viewport, category/customer ID and station each occupy one line, footer lines appear in the required vertical order and share the name’s left edge, customer ID uses IBM Plex Mono, and no page horizontal overflow occurs. This catches typography-selector collisions as well as simple wrapping; checking CSS `white-space` alone would not suffice.

## Side-by-side inspection

Every new capture below was opened and inspected beside the relevant source PNG.

| Component / actual viewport | Reference | Result | Observation |
|---|---|---|---|
| AppHeader / 390px | A02 | PASS | Whales Rewards stays one line beside the mark; Online pill stays visible. Attendant yields inside the narrower gallery sample. Header/context remain legible. |
| AppHeader / 360px | A02 | PASS | Wordmark stays one line, Manrope 800 retained, connection pill fits; no overlap or clipping. Offline toggle is also measured inside the viewport. |
| AttendantShell / 390px | A02 header | PASS | Reusable shell preserves the one-line wordmark and visible connection pill; no page overflow. This is the existing fictional shell, not a completed sale screen. |
| AttendantShell / 360px | A02 header | PASS | Wordmark remains intact. The longer Component preview heading may wrap naturally; it is not the brand wordmark. Navigation and context remain legible. |
| LoyaltyCard / 390px | A07 card | PASS | Name, single-line Car owner · CUST001 and single-line Whales Energy · Station 01 stack cleanly and align left. CUST001 is mono. |
| LoyaltyCard / 360px | A07 card | PASS | Same three-line hierarchy, no uneven footer split, no clipping. Brand/card code and status remain intact. |

New actual-width evidence: [screenshots/wrap-fix](../../tests/design-parity/design-system/screenshots/wrap-fix), six PNGs named AppHeader-390, AppHeader-360, AttendantShell-390, AttendantShell-360, LoyaltyCard-390 and LoyaltyCard-360. Related legacy AppHeader/LoyaltyCard/AttendantShell captures were refreshed. Unrelated raster-only changes in other legacy captures are excluded from this fix commit.

## Executed verification

- Before the fix, `pnpm exec playwright test --config tests/design-parity/design-system/playwright.config.ts --grep 'at actual'`: **4 failed, 0 passed** on staging implementation `de05d2d` with test commit `fc8e5d3`. Both wordmark cases measured **2** glyph lines instead of 1; both card cases measured **2** category/ID lines instead of 1.
- After the fix, `pnpm exec playwright test --config tests/design-parity/design-system/playwright.config.ts`: **14 passed, 0 failed**, including all ten prior gallery checks and all four actual-width cases. Footer equal-left-edge assertions also passed.
- `pnpm typecheck` and focused ESLint for the changed test file: passed.

Chromium required escalated local execution for its MachPort bootstrap. No database/seed is needed for this development-only presentational gallery. No tests were skipped. Quantity precision remains tracked by WHR-45 and is outside these fixes. Earl’s real-phone/TalkBack acceptance may wait for the staging URL (WHR-28), as stated in the findings; no USB setup or real-phone pass is claimed here.
