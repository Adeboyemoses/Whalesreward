# WO-app-3b independent fidelity check

Compared integrated application `8cf5afd` against the six original hi-fi PNGs on 5 November 2026. Screenshots use local Chromium, fictional M1 fixtures, real IndexedDB/service worker, 390 and 360 CSS pixels, device scale 2. No staging browser automation or real customer data.

| Board          | Match                                                                  | Differences (file:line where known)                                                                                                                                                                                                | Severity                           |
| -------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| A02 Sale       | Empty form, disabled save, connection pill and hierarchy match         | Existing 48px controls; scoped three-item navigation.                                                                                                                                                                              | note                               |
| A03 Filled     | Blurred `20,000.00` now matches board; selection, photo and save match | Fake-camera pattern replaces illustrated meter; existing switching hint remains. Quantity trailing zeros remain WHR-45.                                                                                                            | note; existing accepted fix WHR-45 |
| A04 Synced     | Success, exact total, receipt and next action match                    | Approved mono Sale reference added at receipt.tsx:75. Existing separate details receipt time avoids inventing photo time; WHR-45 remains.                                                                                          | note; existing accepted fix WHR-45 |
| A05 Saved      | Offline state and no-credit wording match                              | Approved Reference after upload added. Existing browser-data retention warning retained; WHR-45 remains.                                                                                                                           | note; existing accepted fix WHR-45 |
| A08 Uploads    | Two rows, failed/saved pills, retry action and count match             | Approved assigned reference at uploads/page.tsx:162. Existing full Lagos dates and explicit no-credit text increase height. Fixture freezes future backoff rather than ready-to-retry; original capture time appears on both rows. | note                               |
| A16 Gas synced | Cylinder, gas rate, exact total and success match                      | Approved mono reference. Existing separate details time and WHR-45 quantity presentation remain.                                                                                                                                   | note; existing accepted fix WHR-45 |

All twelve built PNGs are in [screenshots](screenshots/). Open each `*-390.built.png` alongside its corresponding product-docs board; 360px screenshots independently check narrower layout. Source boards remain outside git. No new blocking fidelity finding. Previous accepted differences are documented in `docs/qa/offline-capture-fidelity.md` and `docs/qa/upload-sync-fidelity.md`; this check does not claim pixel equality or resolve WHR-45.

The optional Attendant brand suffix is hidden at 360px; the wordmark stays intact. The 3-wheeler control wraps at 360px as previously documented. Captures assert no horizontal overflow and all visible interactive targets at least 48px high. Range-based wordmark/footer line boxes are saved next to screenshots as metrics JSON; no gallery-gutter explanation is used. Static screenshots do not establish keyboard focus behavior; existing component tests cover focus.

Capture height expands to natural document height to avoid stitched sticky-bar overlap. Browser flow tests separately exercise ordinary phone viewport scrolling and actions. Camera image is a Chromium test stream, not evidence of meter legibility.

Reproduce after a local production build:

```sh
pnpm exec playwright test -c tests/design-parity/phone-smoke/playwright.config.ts
```

Initial independent capture: **6 passed, 0 failed**, twelve screenshots. Final metrics capture: **6 passed, 0 failed (35.8s)**. At both 390px and 360px, A03 wordmark measures one line (118.90625 × 21 CSS pixels) and loyalty footer measures one line (318 × 17 CSS pixels); all twelve JSON records retain the actual line rectangles. The parity output directory is isolated from functional test artifacts; do not run captures concurrently with timing checks.
