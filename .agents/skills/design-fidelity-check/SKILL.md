---
name: design-fidelity-check
description: "Use at section sign-off of a Whales Rewards UI work order (run by test-engineer, never the frontend builder) to compare built screens with the hi-fi PNG boards and report differences."
---

# Design-fidelity check

1. Read the row's brief in `docs/briefs/` and the board list.
2. Start the app locally on the fixture database (`pnpm db:seed` then `pnpm build && pnpm start`). Never use staging.
3. For each board, write or reuse a Playwright script in `tests/design-parity/<row>/` that opens the route with the board's fixture state at the board's width (390 px attendant, 1440 px admin; deviceScaleFactor 2) and saves `<ID>.built.png`.
4. Open the built PNG and `product-docs/04 UI Design/Hi-Fi/<Surface>/<ID>.png` side by side and check, in order: layout and hierarchy; copy (exact words, sentence case, litres, ₦ with two decimals, Lagos date format); status words and pill colours; components and tokens (no new colours, shadows or fonts); spacing and tap targets (48 px); focus visibility; every state on the row.
5. Report a table: `| Board | Match | Differences (file:line where known) | Severity |`. Severity: blocking (wrong behaviour, wrong copy on status or money, missing state), fix (visible drift), note (pixel-level).
6. Commit the screenshots and report. Blocking differences go back to the EM as findings; the row's coverage-map status reaches `on-staging` only with a clean or accepted report.
