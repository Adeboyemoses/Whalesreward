# WO-app-5 station design fidelity

Status: all15 board comparisons complete. No remaining blocking or fix-level difference from this work; the inherited limitations below remain explicit. Functional full-suite verification is reported separately, not inferred from these screenshots.

Independent test-engineer comparison against the approved F01–F10, D01–D04 and A17 PNG/HTML boards and row briefs. Local Chromium, fictional PostgreSQL fixture accounts, device scale 2; no staging or provider session. Admin boards are captured at1440 and390 CSS pixels; A17 at390 and360. Password inputs are empty before every capture, automatic screenshots/trace/video are disabled, and no credentials are printed.

## Board review

| Board | Match | Differences | Severity |
| --- | --- | --- | --- |
| F01 Station pumps | Structure checked | Initial390px overflow668px is corrected: final document390px, wrapper358px, table650px scrolls internally. Product names/rates and real cursor-backed lists are present. | note |
| F02 Add pump | Structure checked | Real creation and generated code replace static preview; no preview disclaimer. | note |
| F03 Pump details | Structure checked | Empty assignment CTA now filled/content-width after builder correction; created Pump06/07 and canonical generated codes differ from board Pump04/P04. | note |
| F04 Pump assignment | Structure checked | Three-row reason textarea verified after correction; selected personal identity and immutable history use actual data. | note |
| F05 Product prices | Structure checked | Server order differs from board; exact prices include explicit unit. Newly created pump appears in scope. | note |
| F06 Update price | Structure checked | Inline naira prefix and three-row textarea verified after correction. Real version/actor/time history replaces sample sentence. | note |
| F07 Confirm price | Structure checked | Compact not-yet-applied pill verified beside heading; real reason and exact old/new values retained. | note |
| F08 Price activated | Structure checked | Receipt distinguishes applied change from current settings after later edits. Real Lagos receipt time, generated actor code and full immutable history differ from static fixture. | note |
| F09 Assignment confirmation | Structure checked | Admin cannot know phone queue size: shows unknown rather than inventing board's two-sales count, per M2. Original and configured pump/identity/reason remain explicit. | note |
| F10 Assignment recorded | Structure checked | Pump-origin confirmation now returns target pump details with the applied receipt and assigned Grace, verified after correction. Status pill takes a full row within the assigned-person card; the original compact placement differs slightly. | note |
| D01 Attendants | Structure checked | Fixture seed contains Grace/Favour; board contains Grace/Bola/Ibrahim. Search is explicit submission; server order/count remain truthful. | note |
| D02 Create attendant | Structure checked | Empty password replaces static preview sample. Reveal control now remains inline after input-group correction. Native select chevrons differ from the static board treatment; labels and selected values remain readable. | note |
| D03 Attendant profile | Structure checked | Deferred reset/disable buttons omitted under AGENTS. Server handover state replaces generic Active; P-21 End assignment and immutable history added by approved scope. | note |
| D04 Attendant created | Structure checked | Actual account, generated permanent ID, first-password/fresh-online-sign-in receipt replace preview-only copy. Password never redisplayed. | note |
| A17 Pump change | Structure checked | Actual current code is PUMP02 and inherited formatter renders “Pump PUMP02”; WHR-81 tracks this inherited presentation defect. Target uses server-configured name. Original queued operations/photos stay with original account/pump. | note, WHR-81 |

All admin screenshots inherit the existing five-section navigation inventory rather than the complete future sidebar in the boards; see inherited navigation scope WHR-69. This work does not claim parity for unbuilt sections. Fixture-generated identifiers, counts and trusted server dates are retained rather than edited to resemble static data.

P-21 reason/review/applied states and attendant first-password/unassigned-denial states have no dedicated approved PNG board. Additional captures use the closest approved admin form/review/receipt and attendant sign-in patterns. They demonstrate layout and state availability, not exact board parity. Actual P-21 endpoint acceptance and test-only fake behavior are reported separately in `tests/station/BASELINE.md`.

## Method and provenance

Initial desktop comparisons opened all14 built/original pairs side by side after inspecting all15 original boards. Initial mobile F01 probe measured viewport390/document668, station width358 with section/wrapper652 and table650. No viewport assertion was relaxed. Production fixes are made by the builder, not the checker.

Final runtime: admin `b40ee2c93f27cc2dce4bc33ebec98e5af9e1ebde`, phone `565686ff940c991116ec3e4e0b48c5b64524cc82`, actual core offboarding `72a737b674a8b70e5b06233af86155808a9d97e7`. Integrated capture producer `e4f8119e2b5883413a26bf9e4ec02bdf38fb112f`. Fresh isolated database `whr_app5_parity_final1`.

`WHR_STATION_PARITY_DATABASE_URL=<local fixture database> pnpm exec playwright test -c tests/design-parity/station/playwright.config.ts`: **3 passed (19.8 seconds), zero failures/skips/retries**. The test server builds production code before running. All42 PNGs and43 geometry JSON files are retained under `screenshots/`:28 admin-board captures,2 A17,6 P-21,4 first-password/unassigned-denial and2 actual-sale wrap checks. All were visually inspected; all14 final desktop original/built pairs were opened side by side, all14 responsive admin states inspected, plus both A17 and all extra contract states. No horizontal document overflow across42 captures, including the36-character P-21 receipt assignment ID at390.

At390 and360, A17/first-password/unassigned sign-in/sale wordmarks each occupy one rendered line. The actual sale loyalty-footer occupies one line at both widths; A17/auth screens have no loyalty-footer, so the sale screen supplies the real measurement. Phone buttons, inputs, selects and links have no visible target shorter than48px. The optional Attendant suffix hides at360 while the wordmark remains intact. Inherited3-wheeler wrapping at360 is unchanged. Focus rings are visible on the filled admin inputs/textarea in the captures; screenshots alone do not establish every keyboard transition.

The390px admin view stacks the existing navigation above content; tables retain horizontal scrolling within the card and two-column forms become one column. This is responsive inspection, not a claim that a390px admin hi-fi board exists. Remaining differences are real fixture data, server order, metadata, content required by newer contracts, inherited navigation/formatter scope, or minor component placement. No product-docs HTML/PNG copies are committed.
