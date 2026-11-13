# WHR-17 review screens and A14 fidelity

Independent checker: test-engineer. Local production build, fictional fixture accounts, real PostgreSQL and local object storage. No staging or deployed policy was changed. Compared the source PNGs for S02, S03, S04, S06, S07, S09 and A14 with the attached built captures, using the two implementation briefs and P-25 where the older boards differ from the approved behavior.

Admin captures use a 1440px viewport and device scale factor 2. A14 uses actual 390px and 360px viewports, initially 844px high, and scale factor 2. Screenshots include the complete page. Dynamic sale/card/staff identifiers, receipt times and the clearly fictional meter image replace the board's sample records; this is a hierarchy/behavior comparison, not a pixel equality claim. The meter quantity matches the captured purchase.

| Board | Match | Differences (file:line where known) | Severity |
| --- | --- | --- | --- |
| S02 | Purchase/evidence hierarchy, pair comparison, review explanation and audit history | Latest server pair facts and both retained meter photos are shown. The approved keep-both label and two explicitly named cancellation targets replace the older generic action choices (`src/ui/admin/reviews.tsx:486`). | Note: approved behavior |
| S03 | Original purchase, meter evidence, captured price context, decision and retained history | P-25 explanation-only notes and selectable server records replace free-form proof. The page distinguishes captured values from current totals (`src/ui/admin/reviews.tsx:621`). | Note: approved behavior |
| S04 | Explicit unavailable correction state with original context | Meter correction and price cancellation are disabled and explain “Not available yet”; no fake correction editor or failing submit action is presented. This intentionally supersedes the older correction board. | Note: required scope |
| S06 | Original purchase and replaced-card review hierarchy | The base SaleDetail service supplies no replacement record (WHR-117). The page reports unavailable replacement context rather than inventing it; the server still checks its complete history. Notes cannot settle interval ambiguity. | Note: inherited API limitation |
| S07 | Date review, original timestamps, reason and history | A single verified Lagos calendar date and constrained server references replace the board's free-form evidence examples. Device time and notes are explicitly not proof. | Note: approved behavior |
| S09 | Recorded outcome, reason, actor, server time, original and current totals/history | The receipt explicitly lists remaining holds and other checks. Fresh current status reads Completed and included after acceptance; the old Held/Not credited contradiction was fixed (`src/ui/admin/reviews.tsx:368`). | Note: required detail |
| Capture | Same review components and evidence hierarchy | No dedicated capture PNG exists in this row. The screen follows the approved brief and groups both capture checks in one decision, preserving independent holds. Status is below the original-purchase heading. | Note: brief-led state |
| A14, 390/360 | Sale status header, clock result, customer/amount summary, notice and reassurance | Own-history entry uses View details disclosure and Refresh sale, with History selected in navigation. Price is the supplied held fixture; the summary states uploaded and not counted. The earlier missing summary was fixed (`src/app/(attendant)/attendant/history/history-view.tsx:623`). | Note: entry-point action differences |

The existing admin sidebar contains implemented destinations instead of the board's complete future navigation. Original purchase and server audit information make admin pages taller than the mockups. Brand, typography, blue review pills, green completed state, sheets, controls and spacing use the vendored design system. No new palette or shadow treatment was needed.

A14 metrics record no horizontal overflow at either width, one rendered wordmark line, and every visible interactive target at least 48px high. A14 has no loyalty-card footer, so no footer line box exists on this route. Both widths were inspected directly, including amount alignment and the bottom navigation. Review inputs have visible labels; notes say explanation, not proof, and no file upload or free-form URL/reference input is offered.

## Findings corrected during checking

- S09 initially displayed an included receipt beside stale Held/Not credited facts. The page now removes the old form immediately, refreshes authoritative details, and separates the immutable operation receipt from current status. The capture asserts no stale Held credit text or decision form after the successful read.
- A14 initially buried the amount in full detail. It now shows the board's result → summary → notice hierarchy with optional full details.
- Capture statuses initially crowded the heading. They now sit below it.
- The normal-click regression exposed an overlapping duplicate cancellation button at 390px. Sales action rows now wrap, buttons fit their available width, and sheets can shrink. No forced click or skipped test was used.

## Reproduction and evidence

Run `pnpm exec playwright test review-screens-real.spec.ts --workers=1` against the local fixture database, and `pnpm exec playwright test --config tests/design-parity/reviews/playwright.config.ts` for the nine captures. The root Playwright configuration activates only the fixture review-evidence-v1 policy; the fixture inserts its fictional approval. Production configuration is untouched.

On this host native Chromium is blocked by the sandbox's Mach bootstrap permission. A clean `mcr.microsoft.com/playwright:v1.64.1-noble` container ran the matching Playwright browser server; localhost ports 3000 and 9000 proxy to the host's local app/storage. Temporary, uncommitted configs added `connectOptions.wsEndpoint`. The parity run reused the just-built production artifact with `pnpm start --hostname 127.0.0.1`.

Focused browser coverage includes queue filters, duplicate keep-both and named other-member cancellation, latest guards, an actually committed/lost HTTP response followed by identical-operation retry, price accept/unavailable actions, date validation errors and sufficiency, card ambiguity/confirm/cancel, grouped capture confirm/cancel, remaining holds, revoked permissions, and A14 at both phone widths. All decisions go through the real endpoints; adversarial date input changes the outgoing request, not the server response.

Final evidence on frontend candidate `f92c25d`:

```text
Focused real-stack browser suite: 20 passed (44.9s), 0 failed, 0 skipped.
Fidelity capture suite: 5 passed (16.3s), 0 failed, 0 skipped; nine PNGs.
pnpm typecheck: exit 0.
Targeted ESLint over changed test/helper/config files: exit 0.
```

Earlier failures are resolved: a receipt assertion omitted the trailing retention sentence; the 390px normal-click failure exposed the real wrapping defect above; the first line-box metric counted the nested surface label as wordmark text and was narrowed to the wordmark text node. None was waived or skipped. No unresolved blocking or visible-fix finding remains at the required widths; the API limitation and brief-approved differences above remain documented.
