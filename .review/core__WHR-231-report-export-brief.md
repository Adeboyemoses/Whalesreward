---
branch: core/WHR-231-report-export-brief
linear: WHR-231
tier: medium
reviewed_head: a35bcf8
rounds: 2
builder: EM (docs/sample-only, no builder dispatched)
reviewers:
  code-reviewer: PASS (round 2)
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 5
plan:
  goal: Stage 1 brief for WHR-231 — A4 PDF layout and Excel sheet plan for report exports, plus rendered samples; no renderer.ts change
  files: docs/design/report-export-brief.md, docs/design/samples/**, docs/design/assets/fonts/** (NotoSans TTFs + OFL.txt), scripts/design/render-report-samples.ts, package.json/pnpm-lock.yaml (@pdf-lib/fontkit devDependency), tsconfig.json (add scripts/**/*.ts to typecheck include)
  approach: propose Noto Sans (OFL 1.1) to replace StandardFonts.Helvetica for ₦ and name coverage; propose a 4-sheet Excel plan (Summary, Daily, Groups, Source sales) with bold/frozen headers and autofilter, and a new PDF Source sales table; render both from fictional data shaped like ReportSnapshot via a standalone sample script, not wired into export-service.ts or renderer.ts
  tests: n/a this stage — pnpm typecheck/lint/test/build all green on this diff; Stage 2 adds the PDF-text/XLSX-structure tests the work order lists
  risks: adds a devDependency (@pdf-lib/fontkit) and ~1.2MB of font assets under docs/design/; no production code path changed; fictional data only, no client data; PDF Source sales table is a new behaviour vs. m4.md's current contract text, flagged in the brief's Contract change section
invariants: []
p1: []
tickets: [WHR-235]
---

Stage 1 only (WHR-231 / WO-core-13b): a design brief proposing the new A4 PDF
layout and 4-sheet Excel plan for report exports, the Noto Sans font to carry
₦ and stored names, and sample PDF/XLSX files rendered from fictional data by
a standalone script. `renderer.ts` is untouched. Tier medium per
`required-reviewers.sh` (exports carry business figures and personal data
even in fictional-data samples).

Round 1: code-reviewer FAIL (2 P1s — daily-table prose contradicted the
snapshot contract; proposed Source sales columns dropped 13 existing
fields). Fixed in the next commit: full column parity restored, daily-table
prose corrected with a footnote, PDF column widths fixed, Summary sheet
freeze/autofilter moved to its real header row, sample data fixed to cover
all four excluded states, inaccurate renderer claims fixed, and a new
"Contract change" section flagging that Stage 2 needs a `lane:spec`
amendment to `m4.md` for the new PDF Source sales table.

Round 2 (head `a35bcf8`): code-reviewer PASS with 5 P2s and 2 P3s, all below
the merge-blocking threshold (PDF column text overflow on two columns and an
unbroken hyphenated name; a header-orphan edge case; the sample's local
`excelNumber` stub understating that it is unguarded; Daily/Groups PDF
tables not repeating headers; the plan assuming single-currency NGN against
the contract's multi-currency `spend`; two wording nits). All 7 batched into
WHR-235 (`found-in:WHR-231`) for Stage 2 rather than reopening Stage 1.
Round cap (2) reached for code-reviewer.

EM correction: the earlier dispatch used security-reviewer (PASS, no
findings), but `required-reviewers.sh origin/staging...HEAD` actually names
integrity-reviewer for this diff (its float-near-money heuristic fires on
the sample's `excelNumber` stub — itself a WHR-235 finding). integrity-
reviewer PASS (no INTEGRITY-P1; confirms nothing here can touch real data —
`renderer.ts` untouched, sample script unreferenced by any production path)
with 2 more non-blocking findings (Source sales quantity-unit wording nit;
confirms the header-freeze wording nit), both added to WHR-235. The two
wording-nit fixes were reverted out of this head so `reviewed_head` matches
exactly what both reviewers saw.
