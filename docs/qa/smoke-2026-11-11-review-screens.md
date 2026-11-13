# WHR-17 review screens smoke

Use local fictional fixtures or the approved M3 smoke environment; never reseed deployed data.
Acceptance remains Earl's combined WO-app-7/8 M3 smoke after READY.

1. Sign in with sales access and open Sales → Reviews. Filter duplicates, price, card, date and capture; each row opens its review. Empty and failed reads have clear states.
2. S02: inspect both original sales/photos. Enter a reason, choose Clear the flag · keep both, review then confirm. The flag clears; credit is not newly granted. Repeat with a different pair cancelling the explicitly named member; the other remains unchanged.
3. S03/S04: inspect captured price and server reference. Correct from meter evidence and price cancellation say Not available yet. Confirm captured values with explanation and API references. Insufficient records leave the sale held.
4. S06: confirm an earlier purchase or cancel an invalid one using server evidence. Ambiguous timing says “The records don't settle this yet.” The old card remains retired.
5. S07: enter a verified Lagos calendar date, review then confirm. Invalid dates and dates after receipt are explained; unresolved/multiple-day evidence remains held.
6. Capture: inspect all open capture blocks. Confirm/cancel considers them together; a different remaining hold prevents credit.
7. S09: check recorded decision, server time, reason, retained original and actual credit/remaining holds. Refresh shows current state without another mutation.
8. Competing change: open two sessions; decide in one, then confirm the stale other view. It explains stale/closed state and requires reread and review.
9. Lost response: interrupt the response after send. Fields freeze; Retry same decision reuses the operation and exact body. No changed decision is automatically sent.
10. Revoke the relevant permission while a review is open. Action is refused and the screen explains changed access. Sales-only users cannot perform decisions.
11. A14: on the originating attendant's phone, view the held sale at 390px and 360px. Plain wording says it is not counted and need not be recorded again; no internal policy codes or admin notes appear.
12. Across reviews, confirm there is no upload control, URL input or free-form reference entry; notes are explicitly explanation, not proof.
