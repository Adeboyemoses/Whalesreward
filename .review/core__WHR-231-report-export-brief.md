---
branch: core/WHR-231-report-export-brief
linear: WHR-231
tier: medium
reviewed_head: a35bcf8
rounds: 2
builder: EM (docs/sample-only, no builder dispatched)
reviewers:
  code-reviewer: PASS (round 2)
  security-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0}
dispatches: 4
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

Round 1: code-reviewer FAIL (2 P1s — the daily-table prose contradicted the
snapshot contract; the proposed Source sales columns dropped 13 existing
fields). security-reviewer PASS (no findings: fictional data, clean
supply chain on `@pdf-lib/fontkit` and the vendored Noto Sans files, no
secrets/product-docs/env access, no machine-identifying metadata in the
committed binaries). Both P1s and the accompanying P2s were fixed in the
next commit: full column parity restored, daily-table prose corrected with
a footnote, PDF column widths fixed to fit the page, Summary sheet
freeze/autofilter moved to its real header row, sample data corrected to
cover all four excluded states, three inaccurate claims about the current
renderer fixed, and a new "Contract change" section added flagging that
Stage 2 needs a `lane:spec` amendment to `m4.md` for the new PDF Source
sales table and its page-count implications.

Round 2 (head `a35bcf8`): code-reviewer PASS with 5 open P2s and 2 P3s, all
below the merge-blocking threshold (cell text overflow on two narrow PDF
columns and an unbroken hyphenated name; a header-orphan edge case; the
sample's local `excelNumber` copy understating that it is unguarded; Daily
and Groups PDF tables not repeating headers like Source sales does; the
plan assuming single-currency NGN against the contract's multi-currency
`spend` array) plus 2 wording nits. Batched into WHR-235 (`found-in:WHR-231`)
for the Stage 2 PR; the two wording nits were fixed directly in the EM's
final commit (prose only, reviewer's own suggested text, no logic change).
Round cap (2) reached; no further round opened.
