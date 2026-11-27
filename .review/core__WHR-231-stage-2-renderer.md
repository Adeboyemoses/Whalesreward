---
branch: core/WHR-231-stage-2-renderer
linear: WHR-231
tier: high
reviewed_head: PENDING
rounds: 1
builder: backend-engineer
reviewers:
  code-reviewer: PENDING
  security-reviewer: PENDING
  integrity-reviewer: PENDING
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 3
plan:
  goal: Stage 2 of WHR-231 — port the approved brief into renderer.ts: a table-based A4 PDF (500-row-capped source sales) and a 4-sheet XLSX (Summary, Daily, Groups, Source sales), embedding a vendored open-licence font for ₦, within the existing 5s render budget at REPORT_LIMITS ceilings
  files: src/server/modules/reports/renderer.ts (full rewrite), src/server/modules/reports/renderer.test.ts, renderer-pdf-text.test.ts, renderer-timing.test.ts (new), src/server/modules/reports/reports.test.ts (column-order updates), tests/integration/reports-currency-adversarial.test.ts, reports-exports-adversarial.test.ts (4-sheet updates), src/server/modules/reports/fonts/** (NotoSans TTFs + OFL.txt, vendored), Dockerfile (ship fonts to runtime image), package.json/pnpm-lock.yaml (@pdf-lib/fontkit to dependencies, pdfjs-dist devDependency for test PDF-text extraction), docs/engineering/contracts/m4.md (Reports and exports section — 500-row PDF cap, 4-sheet XLSX)
  approach: shared drawTable/wrapText routine for Daily/Groups/Source-sales PDF tables (real column widths, hard word-break, right-aligned money/quantity, repeated headers per page); PDF source-sales table capped at 500 rows (Earl, 27 Nov) with a one-line count-and-pointer-to-Excel above the cap; XLSX Source sales splits Quantity+Unit into separate Litres/Kilograms columns; real Date cells for calendar days and Lagos-shifted (+1h, fixed offset) instants; literal ₦ numFmt for NGN, code-prefix for other currencies, in both PDF text and XLSX numFmt; XLSX built on ExcelJS's streaming WorkbookWriter with shared frozen style objects (not the default in-memory Workbook) after profiling showed the latter takes ~16s at the 100k-row ceiling against the real 5s cardStorageDeadline budget
  tests: XLSX structure (4 sheet names, bold/frozen/autofiltered headers, Litres/Kilograms split, Date-cell round trip, NGN vs non-NGN numFmt); real PDF text extraction via pdfjs-dist (headings, ₦, Page X of Y, the over-500 summary line, under-cap legend/spelled-out labels); 500-row cap page-count differential; long run-on name hard-break; Earl's literal worst case (366 days, 500 sources, long name) timed against the real CARD_STORAGE_TIMEOUT_MS budget; a separate XLSX timing test at REPORT_LIMITS.sources (100,000); static Dockerfile-content check that the fonts directory ships to the runtime image
  risks: XLSX now uses the streaming writer API instead of the in-memory Workbook (different ExcelJS surface — views must be set at addWorksheet time, not after); PDF text is glyph-ID encoded by the embedded subsetted font, so only CMap-aware extraction (pdfjs-dist) can assert on it, not a raw-bytes search; multi-currency Daily/Groups/Summary-excluded rows get one dynamically-named column per currency encountered rather than a fixed single column, a judgment call against the contract's multi-currency spend array; Summary sheet's single freeze/autofilter applies only to the totals block, not the excluded-states block below it (ExcelJS streaming worksheets allow one of each per sheet)
invariants: []
p1: []
tickets: []
---

Stage 2 (WHR-231 / WO-core-13b): full rewrite of `renderer.ts` per Earl's 27 Nov 2026 approval comment and WHR-235, folding in every item (500-row PDF cap, no column overlap, right-aligned numbers, units on every quantity, real Excel dates in Lagos time, ₦ numFmt, fonts moved to a lane:core path and proven to ship in the production build, m4.md updated in the same PR, a worst-case render-time test). No builder — backend-engineer and test-engineer both work in this worktree/branch.

Font files vendored at `src/server/modules/reports/fonts/` (moved logically from the Stage-1 brief's `docs/design/assets/fonts/` copy, which stays in place as that PR's own historical sample record — Stage 1 merged to staging mid-session and both copies now coexist, which matches the brief's own text that Stage 2 vendors a fresh copy into `src/`). Dockerfile's runtime stage now copies that fonts directory; proven with a static Dockerfile-content test since this repo's CI has no actual `docker build` step to check against.

test-engineer's worst-case timing tests caught a real, systematic bug: rendering XLSX at `REPORT_LIMITS.sources` (100,000 rows) took ~10-11s against the renderer's real enforced budget (`export-service.ts` wraps the render call in `cardStorageDeadline`, 5000ms, not the 60s `leaseMs`) — every export reaching near that ceiling would fail with a 503 every time, not occasionally. Root-caused to ExcelJS's default in-memory `Workbook`'s one-shot final serialization plus its per-cell style-object allocation; fixed by switching to `stream.xlsx.WorkbookWriter` with shared frozen style objects, verified down to ~2-3s with real margin. Reviewers should weigh in on this change given its scope (XLSX cell-writing architecture, not just formatting).

Gates run by the EM on the final head: `pnpm typecheck` clean, `pnpm lint` 0 errors (4 pre-existing unrelated warnings), `pnpm test` 1072/1072, targeted `pnpm test:integration` on the three reports-touching files (reports-currency-adversarial, reports-exports-adversarial, reports-meter-adversarial) 14/14, `pnpm build` green.
