# WO-app-3 upload and receipt fidelity

Independent test-engineer comparison completed on 5 November 2026 against A04, A08, A23, A14 and A16 PNG boards. Ten built screenshots cover 390 px and 360 px at device scale 2 in `tests/design-parity/uploads/screenshots/`. No new blocking visual difference was found. WHR-45 remains the previously accepted quantity-formatting follow-up.

## Execution and scope

The local production app ran in the isolated Linux Chromium container `whr-upload-browser:lean` (Node 26.12.0, Playwright 1.64.1), with local fixture Postgres and the contract-shaped HTTP fake through the real adapter and IndexedDB. Native macOS Chromium initially failed before scenario execution with sandbox process-registration error 1100; Docker resolved that execution limit without changing app code.

Capture starts at the board height (844 px, or 1108 px for receipts), then expands vertically for additional contract-required content. Every capture checks no horizontal overflow and visible interactive targets at least 48 px high. The first controlled capture run reported **7 passed, 1 failed**: the pending fixture navigated during an active PUT. Waiting for its receipt failure before navigation fixed the fixture; the targeted rerun reported **2 passed (19.4s), 0 failed, 0 skipped**. All eight capture scenarios now have passing evidence. Screenshots were opened independently alongside the source boards at both widths; the wordmark stays on one line, status pills remain legible and no amount or action is clipped. Keyboard focus remains covered by the existing vendored-component tests, not by these static screenshots.

## Findings

| Board | Match | Differences | Severity |
|---|---|---|---|
| A04 Sale synced | Hierarchy, teal success treatment, receipt rows, amount and primary action match | Server details receipt time is separate; no invented photo timestamp. Compact header identity fits one line at 390 px. Quantity shows 20 instead of 20.000 (WHR-45). | note; existing accepted fix WHR-45 |
| A08 Pending uploads | Two named rows, failed/saved pills, warning, retry action and badge match | Full Lagos date/time and explicit no-credit copy increase height. Fixture retains a future retry time so the screenshot shows the backoff state instead of ready-to-retry. | note |
| A23 Empty uploads | Success hierarchy, zero count and record-sale action match | Copy explicitly requires server-confirmed credit; removes unbuilt History link and fabricated last-upload time. | note, contract-driven |
| A14 Price review | Clock, blue hold treatment, amount and preserved-entry explanation match | Historical price-at-capture wording, all-holds list, account identity, server details time and next-sale action add height. Pill uses Awaiting price review consistently. Fictional sale ID differs. | note, contract-driven |
| A16 Gas synced | Gas pump, Cylinder, kilograms, rate, total and next-sale action match | Separate details receipt timestamp; quantity shows 10 kg instead of 10.00 kg (WHR-45). | note; existing accepted fix WHR-45 |

All screens use the scoped Sale / Uploads / Account navigation. Register and History remain later scope. The 360 px layout hides the secondary Attendant brand label while retaining the wordmark and connection state, as the existing responsive shell specifies. Colours, typography, cards and buttons retain the vendored design treatment.

## Reproduction

Run `pnpm exec playwright test --config tests/design-parity/uploads/playwright.config.ts` against a local production build. The fixture waits for service-worker control before offline capture and awaits the server-shaped outcome before navigation. A08 adds a second fictional local row only inside its test fixture. No production bypass is installed.

This is client UI evidence only. Real storage validation, transactional credit, adversarial accepted-object replacement and physical Android acceptance require WO-core-4 and Earl’s phone smoke. No phone or real-endpoint pass is claimed.
