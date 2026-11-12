# WHR-128 price adoption — independent design fidelity

Candidate: `4556c1795f53db4dc990b5fa7be12bfe3da99db5`. Checked 12 Nov 2026 by the test engineer, independently of the frontend builder, using the design-fidelity-check skill and the attendant row 02 brief. Result: no new blocking visual difference found in the captured states. Existing differences and fixture limitations are explicit below; this is not a pixel-identical claim.

The four source PNGs A02-Sale, A03-SaleFilled, A15-GasSale and A27-SaleOffline were opened from the read-only product boards and compared with all twelve built PNGs in this directory. Capture used the real local app, authenticated fictional fixtures, actual price activation/lookup, local PostgreSQL and local MinIO. Runtime: native Linux Playwright 1.64.1, Node 26.12.0, pnpm 10.17.1. No staging or production access.

Widths are 390 and 360 CSS pixels, device scale factor 2. Layout measurements were taken at actual phone height 844 before expanding height for unobscured full-page screenshots. Each PNG has a matching metrics JSON. Full-page captures show the whole form; they do not claim all content fits without vertical scrolling.

| Board | Match | Differences (file:line where known) | Severity |
| --- | --- | --- | --- |
| A02-Sale | Customer → Purchase → Meter photo → Save and bottom navigation retained; amount/rate and status styling match | Unique fictional pump/account/card IDs replace board IDs. Header context wraps naturally. Existing switching-help text and required caption differ slightly from the board. At 360 the Attendant suffix is hidden by the existing responsive header; wordmark stays one line. | note |
| A03-SaleFilled | Selected customer, ₦20,000.00, ₦1,000.00/litre, photo state and Save hierarchy match | Approved P-27 discard action adds height below rate. Existing calculated quantity trims trailing zeros (20 litres). Photo is a fictional camera canvas, not the board placeholder. | note |
| A15-GasSale | Cooking-gas customer, fixed Cylinder, ₦15,000.00, ₦1,500.00/kg, 10 kg and photo match | Approved discard action adds height. Fictional identifiers and existing trailing-zero formatting differ. No unintended eager composition from Cylinder; browser regression verifies this. | note |
| A27-SaleOffline | Dark offline notice, stored-customer indication, saved rate timestamp and Save sale on phone match | Capture also includes the approved kept-price notice. Existing loyalty footer says “Counts toward loyalty after the details and photo sync.” rather than the board's longer saved-price/admin-review explanation. This unchanged copy predates P-27 and is recorded for EM acceptance, not silently treated as exact fidelity. | note |
| P27-KeptPrice | Approved addition: future ₦1,200.00/litre versus this sale's ₦1,000.00/litre is explicit; yellow notice appears under original rate | No separate source PNG exists; assessed against approved brief. Notice wraps cleanly at both widths; value and photo remain intact. | note |
| P27-KeptPrecision | Approved addition: original precision retained while future sales update | No separate source PNG exists; assessed against approved brief. Message remains fully readable at both widths. | note |

All twelve measured states have `scrollWidth === viewport width`, one rendered wordmark line, one loyalty-footer element with a single rendered text line, and no visible button/input/link below 48 CSS pixels high. The 360px 3-wheeler label wraps within its control; it does not overflow. Card codes and long account names remain within their containers. Notice, discard, photo and save controls do not overlap.

Focus-ring styling was not separately captured; this report makes no new keyboard-focus fidelity claim. The new empty-draft update notice and discard confirmation behavior are asserted in functional tests; their transient visual states are not included in this PNG set. Raw camera fixture lettering is partly cropped by the existing photo preview fit and is not a real customer image or evidence-quality assertion.

Actual output on the candidate:

- Dedicated real activation and preservation suite: **14 passed (30.7s), 0 failed, 0 skipped**.
- Default controlled-response browser regressions: **4 passed (13.0s), 0 failed, 0 skipped**.
- Fidelity capture and phone metrics: **4 passed (13.4s), 0 failed, 0 skipped**, producing twelve screenshots and twelve metric files.

Reproduce with the guarded isolated database and commands in [the verification map](../../price-adoption/verification.md). The initial medium-versus-delayed-lookup race failed before client fix `61aabe0`; its original browser assertion is green on this candidate. No production files were changed by the checker.
