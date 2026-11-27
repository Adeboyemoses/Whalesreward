# Report export brief — PDF layout and Excel sheet plan

WHR-231 (WO-core-13b) Stage 1. Scope: this brief and the sample files below. No
`renderer.ts` change — that is Stage 2, after Rook review and Earl's approval
of this brief.

## Why

`renderer.ts` as built (WHR-24) produces a PDF that is plain Helvetica text
lines wrapped by width, and an Excel file that is a single "Report" sheet of
key/value rows with a separate "Source sales" sheet but no bold/frozen header
row or autofilter on the Report sheet itself. Earl's M4 smoke note on step o4
(26 Nov 2026) asked for both exports to read like a finished business document
a manager can hand to someone else, and for the Excel copy to be sortable and
filterable without instructions. This brief proposes the fix for both without
changing what the exports contain: still the frozen snapshot's exact values,
`precision_not_representable`, formula-injection safety, and no phones,
provenance or photo links.

## PDF page layout (A4, 595.28 × 841.89 pt)

One continuous flow, paginated by content height, not by section:

1. **Header** (once per document): "Whales Rewards" wordmark line, station
   name, the period (`<from> through <to> inclusive`), the date basis in the
   plain label the screen uses ("Verified or reported sale date"), prepared
   time in Lagos with its UTC offset, export ID, data version. A thin rule
   separates the header from the body.
2. **Summary**: the same figures and labels as `E05-Reports.html`'s KPI
   row — recorded spend, completed purchases, litres, kilograms, per-product
   breakdown — then "Excluded from totals" with the same state labels
   (pending / cancelled / held / ineligible) and their record counts and
   spend, exactly as the admin screen's notice line reads them.
3. **Daily** table: Day, Purchases, Recorded spend, Litres, Kilograms — one
   row per day in the filtered range, not just days with sales (a day with no
   rendered bar on the screen's chart is not a claim of zero station sales,
   and the table should not create that false impression either).
4. **Groups** table: the dimension named by `filters.groupBy` (product,
   attendant or pump) with the same five columns.
5. **Source sales** table: one row per purchase, with the header row repeated
   on every page the table spans (not just page 1). Columns: Sale code, Sale
   date, Attendant, Pump, Product, Amount, Quantity, Status (included, or
   "Excluded (`<reason>`)" using the same exclusion labels as above).
6. **Footer** on every page: "Page X of Y".

Rules carried over unchanged from the current renderer: long text wraps by
measured width at the current font size rather than being truncated or
overflowing the margin; a table that reaches the bottom margin starts a new
page and (for Source sales only, since it is the one table that can run to
hundreds of rows) repeats its header.

## Open-licence font for ₦

**Proposal: Noto Sans, SIL Open Font License 1.1** (Regular + Bold static
instances). `StandardFonts.Helvetica` in pdf-lib is a non-embedded base-14
font with WinAnsi encoding and has no ₦ glyph (U+20A6) — the current renderer
works around this with a `\u{20a6}` escape fallback for any character the
font can't encode. Noto Sans actually contains the glyph (verified against
the vendored TTFs below with `@pdf-lib/fontkit`: `font.glyphForCodePoint
(0x20A6)` resolves to a real glyph, not `.notdef`) and covers the Latin
Extended ranges needed for stored Nigerian names, so no escape fallback is
needed in the body text at all. It is actively maintained, Google-funded, and
already a safe choice for a public repository (OFL 1.1 permits embedding in a
generated document).

Stage 2 vendors `NotoSans-Regular.ttf` and `NotoSans-Bold.ttf` with their
`OFL.txt` under a `src/` font-assets path (next to
`src/styles/design-system/`, matching T-06's vendoring convention), registers
`@pdf-lib/fontkit` with `PDFDocument.registerFontkit`, and embeds both with
`subset: true` to keep the generated PDF small. The two files together are
about 1.2 MB uncompressed, vendored once, not per export.

The samples below were rendered with this exact font and licence file,
copied for this brief to `docs/design/assets/fonts/` (`NotoSans-Regular.ttf`,
`NotoSans-Bold.ttf`, `OFL.txt`) — the same files Stage 2 would vendor into
`src/`.

## Excel sheet plan

Four sheets, replacing the current single "Report" + "Source sales" pair:

| Sheet | Content | Header row |
|---|---|---|
| **Summary** | Report metadata (ID, station, period, filters, as-of, data version, date basis), then the same totals and excluded-state rows as the PDF summary | `Metric, Value, Unit` |
| **Daily** | One row per day in range | `Day, Purchases, Recorded spend (NGN), Litres, Kilograms` |
| **Groups** | One row per group in `filters.groupBy` | `Group, Purchases, Recorded spend (NGN), Litres, Kilograms` |
| **Source sales** | One row per purchase | `Sale code, Sale date, Attendant, Pump, Product, Unit, Amount (NGN), Quantity, State, Included in totals, Exclusion, Duplicate flag, Correction pending` |

Every sheet with tabular data gets: a bold header row, frozen at row 1
(`views: [{ state: "frozen", ySplit: 1 }]`), an autofilter over the header
range, and column widths sized for the content (not the current renderer's
uniform 24-character width on both sheets). Money columns keep `numFmt:
"#,##0.00"` and stay in naira, not kobo; quantity columns keep their unit in
the header rather than mixing litres and kilograms in one column, matching
`renderer.ts`'s existing split. `excelNumber`'s precision guard
(`precision_not_representable` on values Excel's 15-significant-digit numbers
can't represent exactly) carries over unchanged — this brief does not touch
that boundary.

## Samples

Rendered from fictional data shaped like the current `ReportSnapshot`
contract (`src/shared/contracts/reports.ts`), covering: the daily and groups
tables, an excluded-totals section, a long double-barrelled attendant name to
exercise wrapping and the Noto Sans glyph coverage, and the ₦ sign throughout.
Generated by `scripts/design/render-report-samples.ts` (sample-only; not
wired into the export pipeline):

- `docs/design/samples/report-sample.pdf`
- `docs/design/samples/report-sample.xlsx`

## Stage 2 (not in this PR)

Port this layout into `renderer.ts`, vendor the font under `src/`, add the
PDF-text and XLSX-structure tests the work order lists (including a many-row
and a long-name case), and keep every unchanged guarantee: exact snapshot
values, `precision_not_representable`, formula-injection safety, and no
phones, provenance or photo links in either export.
