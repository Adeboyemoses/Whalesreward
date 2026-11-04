# WO-app-1: Design system smoke test

Prepared before implementation. Fixture-only gallery; no real screens, accounts, capture or credit. Use the worktree’s `pnpm install --frozen-lockfile` then `pnpm dev`; open `http://localhost:3000/dev/gallery`. No database or seed is needed for these presentational checks. The route must return 404 in production. Record build SHA, browser/device and PASS/FAIL with screenshots per step.

## Android setup

Enable USB debugging on the pilot Android phone, connect and authorize the computer, run `adb devices` and `adb reverse tcp:3000 tcp:3000`, then open phone Chrome at `http://localhost:3000/dev/gallery`. No camera or storage permissions are needed: PhotoCapture here is a presentational fixture. Never enter real credentials/customer data.

## Steps

1. A02 / AppHeader and BottomNav previews: inspect attendant shell at 390px and 360px. Expected: one column, correct fonts/brand, Online and Offline examples, five navigation items with active state and accessible pending count, sticky bars without overlap. This is a shell, not a sale page.
2. A03 / Button, TextField, SegmentedControl previews: keyboard/TalkBack through enabled/disabled/loading/error states. Expected: labels/error association, visible focus, pressed state, phone targets 48px (44px floor), readable disabled reason; live fixture controls change only preview state.
3. A04/A05/A14 / ResultBlock, Notice, StatusPill, KeyValueList, ListRow previews: inspect every status. Expected: fixed words and colours, receipt structure, exact fixture money/quantity strings, legible ₦, no preview implying an actual server credit.
4. A03/A15 / PhotoCapture and gas segments: inspect empty/taken/denied/failure fixtures and read-only Cylinder. Expected: visible fixture image, Retake affordance, no gallery upload, correct kilogram labels. Real camera/storage behavior belongs to WO-app-2.
5. Component previews LoyaltyCard, Sidebar, DataTable, KPI, Attention: inspect admin shell at 1440px and below 900px. Expected: sidebar collapses, grids stack, table scrolls without shrinking text; all component examples match corresponding product component preview.html. No admin workflow is implemented.
6. All previews: verify self-hosted Manrope/Plex Sans/Plex Mono requests and ₦ rendering; refresh with product-docs unavailable to the runtime. Expected: assets served locally with no runtime dependency on product docs. Offline service-worker caching is WO-app-2 and is not claimed here.
7. Production exclusion: `pnpm build && pnpm start` and request `/dev/gallery`. Expected: 404, no fixture gallery shown. Stop production server before returning to `pnpm dev` for Earl’s visual smoke.

## Acceptance

Automated browser/fidelity report is supplied by test-engineer. Earl runs phone/TalkBack checks and replies with findings or acceptance. Mark phone-only checks unexecuted until Earl runs them; do not infer their pass from desktop checks.

## Automated verification

See [independent fidelity report](design-system-fidelity.md). Ten development gallery checks and four production browser checks passed, including production404. Table metadata font weight and compact phone target sizes were corrected before sign-off. These checks do not replace Earl’s real-phone/TalkBack acceptance.

## WO-app-1 FIX: wordmark and loyalty footer

At actual 390px and 360px gallery viewports, inspect AppHeader and AttendantShell: “Whales Rewards” stays one line; the Attendant label may hide/shrink before the wordmark wraps, and Online/Offline stays visible. Inspect LoyaltyCard: name, then “Car owner · CUST001” on one line with CUST001 mono, then “Whales Energy · Station 01” on a separate line. No overflow or clipped text. Compare A02 and A07. Independent desktop fidelity runs now; Earl’s real phone/TalkBack may wait for the staging URL (WHR-28), with no USB setup required for this fix verification. Quantity precision remains WHR-45.
