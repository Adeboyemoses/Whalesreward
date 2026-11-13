# WHR-132 · Independent S04 fidelity check

Checker: test-engineer, 13 Nov 2026. Reference: S04-PriceCorrection PNG/HTML, the meter-correction brief and P-26 amendment. Built captures use the local real stack, fictional retained meter evidence and a fictional approved browser profile, at 1440 CSS pixels and device scale factor 2. No deployed policy was activated.

**Verdict: PASS with documented requirement and inherited-shell differences. No remaining blocking or fix-severity finding in this slice.**

| Board/state | Match | Differences | Severity |
|---|---|---|---|
| S04 editor | Compact editor and meter photo occupy the top two-column row; original and corrected pairs remain side by side; supporting fields/actions occupy the full-width review sheet below. | Initial build put the entire form in the left column and stretched the evidence sheet. Reported to EM/frontend and corrected before these final captures. | Fixed |
| S04 review | Original/submitted pairs and photograph remain visible above the separate confirmation sheet. Frozen readings are disabled; confirmation displays the exact submitted spend/quantity and the retained reason. | Explicit review then confirmation is clearer than the board's combined draft. | Note · approved flow |
| S04 money and quantity | Recorded money has the naira sign, separators and two decimals; quantity uses the captured unit/precision; labels and controls remain distinct. | Coherent fictional meter pair is ₦11,000.00 / 11.00 litres at captured precision 2, rather than the board's illustrative three-decimal pair. No implied rate or suggested reading is shown. | Note · P-26 |
| S04 evidence | Actual retained photograph shows both fictional displays; “Open full size” is visible in the photo bar. | Replaces the board's placeholder well. Notes are labelled explanation, not proof; selectable server records extend the review sheet as P-25 requires. | Note · approved contract |
| S04 outcome language | Impact is conditional on remaining checks; original history remains visible; no aggregate/customer totals are invented. | Board example assumes immediate contribution and sample aggregate totals. Those statements are superseded by P-25/P-26. | Note · approved contract |
| Admin shell | Existing typography, cards, status pills, blue/amber vocabulary, focus ring and sales-active navigation are preserved. | Existing permission-driven sidebar, “Price review” heading, generated sale reference and “Back to reviews” differ from static board navigation/copy. | Note · inherited shell |

## Evidence and limits

- `S04-1440.built.png`: editor; `S04-review-1440.built.png`: separate confirmation with original/submitted comparison preserved.
- `S04-1440.metrics.json`: viewport width 1440 and document scroll width 1440; no horizontal document overflow. Desktop amount/quantity controls are 40 px high. Element y coordinates reflect the browser scrolling to the explanation field before capture.
- Visually inspected both final PNGs and the reference board with the image viewer. No clipped labels, overlapping controls, absent primary action, or stretched empty evidence panel remains.
- Root's native Linux verification reports five focused real-stack meter tests passed after the layout fix, and the independent capture test passed (7.3 seconds). Tests cover real passing/refused pairs, retained original, independent date hold, full-size-photo dialog, stale guard, unchanged pair, invalid/reasonless transcription and exact same-operation lost-response replay.
- This report checks S04 at 1440 px. It does not claim pixel-perfect equality of dynamic fixture text, a new parity check of the inherited S03/S09 shell, or physical-phone acceptance. Earl's end-of-M3 smoke remains the acceptance gate.
