# WO-app-2 offline capture fidelity

Independent test-engineer check, 4 November 2026. Checked the five reconciled attendant briefs (rows 01, 02, 03, 06 and 08) against all eleven original hi-fi PNGs and the built screens at 390 px and 360 px, device scale factor 2. Final capture includes frontend fixes through `a464e1f` and session refresh fix `8e99408`.

No new blocking fidelity finding. The existing quantity display follow-up WHR-45 remains visible; it does not alter stored kobo or scaled quantity. EM accepts that separately tracked presentation difference for WO-app-2: the shared formatter is unchanged, exact stored values are tested, and WHR-45 remains the follow-up. This report does not claim pixel equality or real-server authentication.

| Board | Match | Differences | Severity |
|---|---|---|---|
| A01-SignIn | [390 px](../../tests/design-parity/offline/screenshots/A01-SignIn-390.built.png) · [360 px](../../tests/design-parity/offline/screenshots/A01-SignIn-360.built.png) | Layout, inputs, focus and action match. Generic footer omits station before authentication; password fixture stays masked. | note |
| A26-SignInError | [390 px](../../tests/design-parity/offline/screenshots/A26-SignInError-390.built.png) · [360 px](../../tests/design-parity/offline/screenshots/A26-SignInError-360.built.png) | Error borders and offline notice match after a464e1f. Password is cleared; generic credential error follows M1 and makes no unsupported lockout claim. | note |
| A12-Account | [390 px](../../tests/design-parity/offline/screenshots/A12-Account-390.built.png) · [360 px](../../tests/design-parity/offline/screenshots/A12-Account-360.built.png) | Identity avatar and caption corrected to board sizes. Account details and pending count match; navigation contains the two implemented destinations. | note |
| A13-Handover | [390 px](../../tests/design-parity/offline/screenshots/A13-Handover-390.built.png) · [360 px](../../tests/design-parity/offline/screenshots/A13-Handover-360.built.png) | Identity hierarchy corrected. Body text remains 16 px for accessibility; 360 px caption wraps. Upload-first action is disabled with truthful scope copy until uploads exist. | note |
| A02-Sale | [390 px](../../tests/design-parity/offline/screenshots/A02-Sale-390.built.png) · [360 px](../../tests/design-parity/offline/screenshots/A02-Sale-360.built.png) | Empty customer, purchase controls, required photo and disabled save hierarchy match. Quantity trailing zeros are the existing WHR-45 presentation follow-up. | fix — WHR-45 |
| A24-SaleCustomerNotFound | [390 px](../../tests/design-parity/offline/screenshots/A24-SaleCustomerNotFound-390.built.png) · [360 px](../../tests/design-parity/offline/screenshots/A24-SaleCustomerNotFound-360.built.png) | Missing-card error and retained input match. Registration action is outside this work order; help directs to station admin without a dead link. | note |
| A03-SaleFilled | [390 px](../../tests/design-parity/offline/screenshots/A03-SaleFilled-390.built.png) · [360 px](../../tests/design-parity/offline/screenshots/A03-SaleFilled-360.built.png) | Selected customer, container, amount, photo and save match. Editable amount has no grouping separators; calculated quantity drops trailing zeros (WHR-45). | fix — WHR-45 |
| A27-SaleOffline | [390 px](../../tests/design-parity/offline/screenshots/A27-SaleOffline-390.built.png) · [360 px](../../tests/design-parity/offline/screenshots/A27-SaleOffline-360.built.png) | Offline status, saved-customer source, deadline, saved-price date and local-save action match. Full Lagos date/year follows repository convention. Quantity formatting remains WHR-45. | fix — WHR-45 |
| A05-SaleSavedOnPhone | [390 px](../../tests/design-parity/offline/screenshots/A05-SaleSavedOnPhone-390.built.png) · [360 px](../../tests/design-parity/offline/screenshots/A05-SaleSavedOnPhone-360.built.png) | Pending state, original ownership, exact total and retained-photo warning match. Copy makes no automatic-upload promise for the unbuilt sync work. Quantity formatting remains WHR-45. | fix — WHR-45 |
| A15-GasSale | [390 px](../../tests/design-parity/offline/screenshots/A15-GasSale-390.built.png) · [360 px](../../tests/design-parity/offline/screenshots/A15-GasSale-360.built.png) | Kilograms, fixed cylinder, gas rate and separate customer category match. Calculated quantity drops trailing zeros (WHR-45); exact stored arithmetic is tested. | fix — WHR-45 |
| A18-OfflineExpired | [390 px](../../tests/design-parity/offline/screenshots/A18-OfflineExpired-390.built.png) · [360 px](../../tests/design-parity/offline/screenshots/A18-OfflineExpired-360.built.png) | Recording paused, preserved queue count and disabled offline sign-in match. Full Lagos dates wrap at 360 px without clipping. | note |

The screenshot fixtures are fictional. Camera images are Chromium's native fake video stream, hence the green test pattern rather than the board's illustrated meter. Dates use a controlled November timestamp. The pre-authentication shell contains no personal station/customer data. At 360 px the optional “Attendant” header label is omitted to preserve the wordmark and connection status. The 3-wheeler label wraps within its control. No horizontal overflow was observed; capture assertions verify visible controls are at least 48 px high.

Screenshots use the original board heights, expanded to natural document height where content is taller, so sticky action bars do not cover content in stitched images. Actual phone-sized scrolling and fixed controls are exercised separately in the Pixel 7 browser suite. Colour/status hierarchy, focus visibility, readable wrapping and photo/action visibility were inspected. Product source PNGs are not copied into this public repository.

Reproduce from the repository root:

```sh
pnpm build
pnpm test:e2e --config tests/design-parity/offline/playwright.config.ts
```

This starts only the local production server on port 3102. The explicit work-order contract fake replaces the skill's database-seed setup: `tests/fixtures/attendant-http-fake.ts` supplies strict M1 HTTP envelopes, and `tests/fixtures/offline-browser.ts` supplies browser actions. There is no production test switch.

Final independent capture output:

```text
Running 2 tests using 1 worker
✓ offline capture boards at 390px (3.8s)
✓ offline capture boards at 360px (3.6s)
2 passed (8.9s)
```

Production build passed before this capture. EM separately ran the full functional suite on integration head `e70ab16`: **30 passed, 0 failed (27.0s)** across both configured projects. That result includes the online-session revocation regression and the corrected offline-clock harness; EM repeats required gates on the final review head. Earlier QA functional run had 11 passed / 2 failed due to expiry timing in the harness; those harness fixes are committed, not skipped.

The browser suite covers real service-worker offline reload, persistent-profile browser restart with exact photo digest and sale preservation, incoming-account isolation, cross-tab sign-out, pending handover, expired access and clock rollback, atomic quota failure, camera denial, QR/typed lookup and transport-error distinction, gas arithmetic and cache exclusions. Client unit tests cover exact save-boundary milliseconds and race cases. This work order stops before credit/upload/finalize and does not claim those server paths tested.

Earl's real-phone smoke remains deferred until WO-core-3 merges. Follow the [smoke runbook](smoke-2026-11-04-offline-capture.md); neither this report nor the HTTP fake substitutes for that acceptance.
