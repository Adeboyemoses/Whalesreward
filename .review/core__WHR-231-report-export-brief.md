---
branch: core/WHR-231-report-export-brief
linear: WHR-231
tier: medium
reviewed_head: PENDING
rounds: 0
builder: EM (docs/sample-only, no builder dispatched)
reviewers:
  code-reviewer: PENDING
  security-reviewer: PENDING
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0}
dispatches: 0
plan:
  goal: Stage 1 brief for WHR-231 — A4 PDF layout and Excel sheet plan for report exports, plus rendered samples; no renderer.ts change
  files: docs/design/report-export-brief.md, docs/design/samples/**, docs/design/assets/fonts/** (NotoSans TTFs + OFL.txt), scripts/design/render-report-samples.ts, package.json/pnpm-lock.yaml (@pdf-lib/fontkit devDependency)
  approach: propose Noto Sans (OFL 1.1) to replace StandardFonts.Helvetica for ₦ and name coverage; propose a 4-sheet Excel plan (Summary, Daily, Groups, Source sales) with bold/frozen headers and autofilter; render both from fictional data shaped like ReportSnapshot via a standalone sample script, not wired into export-service.ts or renderer.ts
  tests: n/a this stage — pnpm typecheck/lint/test/build all green on this diff; Stage 2 adds the PDF-text/XLSX-structure tests the work order lists
  risks: adds a devDependency (@pdf-lib/fontkit) and ~1.2MB of font assets under docs/design/; no production code path changed; fictional data only, no client data
invariants: []
p1: []
tickets: []
---

Stage 1 only (WHR-231 / WO-core-13b): a design brief proposing the new A4 PDF
layout and 4-sheet Excel plan for report exports, the Noto Sans font to carry
₦ and stored names, and sample PDF/XLSX files rendered from fictional data by
a standalone script. `renderer.ts` is untouched; this PR is docs plus a
sample-rendering script and its font/devDependency, tiered medium per
`required-reviewers.sh` because exports carry business figures and personal
data even in fictional-data samples. Awaiting code-reviewer and
security-reviewer verdicts before READY-BRIEF.
