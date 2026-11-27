# Report export brief — PDF layout and Excel sheet plan

WHR-231 (WO-core-13b) Stage 1. Scope: this brief and the sample files below. No
`renderer.ts` change — that is Stage 2, after Rook review and Earl's approval
of this brief.

## Why

`renderer.ts` as built (WHR-24) produces a PDF that is one plain-Helvetica
text line per fact, wrapped character-by-character at the current font's
measured width, with no tables, no repeated headers and no source-row detail
at all (the PDF today stops at the groups table; only the Excel copy lists
individual sales). Its Excel file is a single "Report" sheet of key/value
rows with a separate "Source sales" sheet; neither sheet has a bold/frozen
header row or an autofilter. Money is formatted `0.00` (no thousands
separator) and currency is spelled out as the code (`NGN 169500.00`), never
the ₦ sign — `StandardFonts.Helvetica` has no glyph for it, and the renderer
never attempts to draw it, so its escape-fallback path for unencodable
characters is never actually exercised by currency text today. Earl's M4
smoke note on step o4 (26 Nov 2026) asked for both exports to read like a
finished business document a manager can hand to someone else, and for the
Excel copy to be sortable and filterable without instructions.

This brief proposes a new table-based PDF layout (adding a Source sales
table, per the work order's Stage 2 scope) and a 4-sheet Excel workbook. Every
value still comes unchanged from the frozen snapshot — same totals, same
`precision_not_representable` guard, same formula-injection safety, same
exclusion of phones, provenance and photo links — but the Source sales table
in the PDF is new, not carried over, and is a presentation change to the
report-export contract (see "Contract change" below).

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
   row per day that has at least one included purchase, exactly as the
   snapshot's `report.daily` array lists it (`reportFromRows` in `data.ts`
   only emits a day when it has included rows). A day absent from the table
   is **not** a claim of zero station sales — the same caveat the admin
   screen's chart carries for an unrendered bar — so the table does not
   invent zero-filled rows for the rest of the range; a one-line footnote
   repeats the caveat under the table.
4. **Groups** table: the dimension named by `filters.groupBy` (product,
   attendant or pump) with the same five columns, plus the group's staff code
   or pump code alongside its name so two attendants who share a name, or two
   pumps, stay distinguishable.
5. **Source sales** table: one row per purchase, with the header row repeated
   on every page the table spans. Columns sized to fit the 515 pt usable
   width in one pass: Sale code, Date (with a V/R marker for verified vs.
   reported — `dateBasis`'s evidence distinction, required by the contract's
   "explicitly labelled reported" rule), Attendant / pump, Product, Amount,
   Quantity, Status (`Included`, or `Excluded (<reason>)` using the same
   exclusion labels as the summary), and a compact Flags column (`Dup`,
   `Corr`, both, or `—`) carrying over the current PDF's duplicate/correction
   counts at the row level. The existing document-level line — "Included
   duplicate flags: N · Pending corrections: N" — stays in the Summary
   section above.
6. **Footer** on every page: "Page X of Y".

Pagination: long text wraps by measured width at the current font size
rather than being truncated or overflowing the margin (this is new — the
current renderer has no tables, so nothing in it can overflow a column; it
wraps whole lines of text instead). A table that would not fit before the
bottom margin starts a new page; the Source sales table additionally repeats
its header block on the new page, since it is the one table that can run to
thousands of rows.

## Open-licence font for ₦

**Proposal: Noto Sans, SIL Open Font License 1.1** (Regular + Bold static
instances). `StandardFonts.Helvetica` in pdf-lib is a non-embedded base-14
font with WinAnsi encoding and has no ₦ glyph (U+20A6); the current renderer
never draws one — it prints the currency code instead (`NGN 169500.00`) and
only falls back to a `\u{20a6}`-style escape for characters that reach
`font.encodeText` and fail, which ₦ never does today because it is never
attempted. This proposal changes that: it prints the actual ₦ sign, which
needs a font that has the glyph. Noto Sans has it (verified against the
vendored TTFs below with `@pdf-lib/fontkit`: `font.glyphForCodePoint(0x20A6)`
resolves to a real glyph, not `.notdef`) and covers the Latin Extended ranges
needed for stored Nigerian names, so the escape fallback is not needed for
body text at all. It is actively maintained, Google-funded, and already a
safe choice for a public repository (OFL 1.1 permits embedding in a generated
document).

Stage 2 vendors `NotoSans-Regular.ttf` and `NotoSans-Bold.ttf` with their
`OFL.txt` under a `src/` font-assets path (next to
`src/styles/design-system/`, matching T-06's vendoring convention), registers
`@pdf-lib/fontkit` with `PDFDocument.registerFontkit`, and embeds both with
`subset: true` to keep the generated PDF small. The two files together are
about 1.2 MB uncompressed, vendored once, not per export. `@pdf-lib/fontkit`
is a devDependency in this Stage 1 PR (only the sample script uses it);
Stage 2 moves it to `dependencies` once `renderer.ts` imports it.

The samples below were rendered with this exact font and licence file,
copied for this brief to `docs/design/assets/fonts/` (`NotoSans-Regular.ttf`,
`NotoSans-Bold.ttf`, `OFL.txt`) — the same files Stage 2 would vendor into
`src/`.

## Excel sheet plan

Four sheets, replacing the current single "Report" + "Source sales" pair:

| Sheet | Content | Header row |
|---|---|---|
| **Summary** | Report metadata (ID, station, period, filters, as-of, data version, date basis); a totals block (purchases, spend, litres, kilograms, one row per product); a separate "Excluded from totals" block, one row per state (all four states always present, matching `reportFromRows`, even when a state has zero records) | Metadata has no header row; the totals block header is `Metric, Value, Unit`; the excluded block has its own `State, Records, Spend (NGN)` header |
| **Daily** | One row per day present in the snapshot (see the PDF section's caveat — no invented zero days) | `Day, Purchases, Recorded spend (NGN), Litres, Kilograms` |
| **Groups** | One row per group in `filters.groupBy`, with the attendant's staff code or the pump's code as its own column so two same-named attendants or two pumps stay distinguishable | `Group, Attendant staff code, Pump code, Purchases, Recorded spend (NGN), Litres, Kilograms` |
| **Source sales** | One row per purchase, every field the current renderer exposes — nothing dropped | `Purchase ID, Sale code, Revision ID, Sale date, Date evidence, App captured at, Verified sale date, Server received at, Attendant ID, Staff code, Attendant, Username, Pump ID, Pump code, Pump, Product, Unit, Amount, Currency, Quantity, State, Included in totals, Exclusion, Values source, Duplicate flag, Correction pending` (same 26 columns the current renderer already writes) |

Every sheet with tabular data gets: a bold header row at whichever row the
table's header actually sits on (the Summary sheet's totals-block header is
not row 1 — it comes after the metadata rows), frozen at that row, an
autofilter over that header's range, and column widths sized for the content
(not the current renderer's uniform 24-character width on both sheets).
Money columns move from the current `numFmt: "0.00"` to `"#,##0.00"` (adds
the thousands separator) and stay in naira, not kobo; quantity columns keep
their unit in the header rather than mixing litres and kilograms in one
column, matching `renderer.ts`'s existing split. `excelNumber`'s precision
guard (`precision_not_representable` on values Excel's 15-significant-digit
numbers can't represent exactly) carries over unchanged — this brief does
not touch that boundary; Stage 2 calls the existing `excelNumber`/`money`
functions directly rather than reimplementing them (the sample script below
has its own copies, marked not to port, since it predates and stands outside
`renderer.ts`).

## Contract change (Stage 2, flagged now)

[M4](../engineering/contracts/m4.md), "Reports and exports" section, line
437, currently says the XLSX "contains Report and Source sales sheets" and
describes the PDF as metadata, totals, excluded buckets and grouped figures
only — no source rows. The work order's Stage 2 scope (Earl, 26 Nov 2026) explicitly
asks for four Excel sheets and a PDF Source sales table, which supersedes
that wording. Per AGENTS.md, the newer approved instruction wins, but a code
lane changes a contract only through a `lane:spec` child issue or a PR that
updates the contract doc in the same change — so Stage 2 needs a small
`lane:spec` amendment to `m4.md` alongside the `renderer.ts` change, not a
silent reinterpretation. This brief records the conflict now rather than at
Stage 2 review time.

Putting source rows in the PDF also means the PDF can run long: a report can
have up to `REPORT_LIMITS.sources` (100,000) source rows and the export
artifact is capped at `REPORT_LIMITS.artifactBytes` (64 MB) — at roughly 25
rows per page that is a multi-thousand-page document for the largest allowed
range. That is the same bound the Excel Source sales sheet already accepts
today for the same data, so this is not a new capacity risk, but Stage 2
should say explicitly that the PDF's page count is unbounded within those
existing limits rather than leaving it implicit.

## Samples

Rendered from fictional data shaped like the current `ReportSnapshot`
contract (`src/shared/contracts/reports.ts`), covering: the daily and groups
tables, an excluded-totals section, a long double-barrelled attendant name to
exercise wrapping and the Noto Sans glyph coverage, and the ₦ sign throughout.
Originally generated by `scripts/design/render-report-samples.ts` (the Stage 1
mockup script; sample-only, not wired into the export pipeline). As of Stage
2, `scripts/design/render-report-samples-stage2.ts` regenerates both files
from the real production renderer (`renderer.ts`) instead — re-running the
Stage 1 script would silently overwrite them with the old mockup output:

- `docs/design/samples/report-sample.pdf`
- `docs/design/samples/report-sample.xlsx`

## Stage 2 (not in this PR)

Port this layout into `renderer.ts`, vendor the font under `src/`, add the
PDF-text and XLSX-structure tests the work order lists (including a many-row
and a long-name case), and keep every unchanged guarantee: exact snapshot
values, `precision_not_representable`, formula-injection safety, and no
phones, provenance or photo links in either export.
