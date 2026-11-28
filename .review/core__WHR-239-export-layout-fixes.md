---
branch: core/WHR-239-export-layout-fixes
linear: WHR-239
tier: medium
reviewed_head: 8865d43
rounds: 2
builder: backend-engineer
reviewers:
  code-reviewer: PASS (round 2)
  integrity-reviewer: PASS (round 2)
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 5
invariants: [I-29, I-40, I-42, I-43, I-44, I-46]
p1: [fixed in round 2 commit 8865d43]
tickets: [WHR-240 m4.md note, split to its own PR]
---

Fixes WHR-239 defects 1-5 in the report export renderer: PDF section
headings/footnotes overlapping prior content (baseline-direction mismatch
between `Cursor.text()` and `drawTable()`'s row drawing, unified); the PDF
header missing the station name (WHR-240 Option A: additive, nullable,
optional `Report.station`); "Excluded from totals" showing raw state codes
instead of one sentence-cased line; the Excel Groups sheet showing raw
product codes instead of PRODUCT_LABEL display labels; and Summary's
Period cells now real Date cells. Includes a test proving a pre-change
frozen snapshot with the `station` key entirely absent still renders, the
WHR-238 item 7 doc-credit fix, and regenerated samples.

Round 1 (medium): code-reviewer FAIL (P1: an integration-test assertion
still expected raw product codes after the Groups-label fix; two P2s: the
merged "Excluded from totals"/header line could overflow the PDF's right
margin with realistic data, and Summary's Product filter row still showed
a raw code when a filter was set). integrity-reviewer PASS with the same
overflow issue flagged non-blocking.

Round 2 (commit 8865d43) fixed all three: updated the integration
assertion to the display labels; added `Cursor.paragraph()` wrapping text
against the page's usable width for both overflow sites, with a new test
asserting every text item on every page stays within PAGE_WIDTH-MARGIN
using a fixture built to reproduce the original overflow; mapped the
Summary filter row through PRODUCT_LABEL with its own test. Both
reviewers re-reviewed fresh at 8865d43 and returned PASS with zero
findings; integrity-reviewer additionally confirmed the wrap drops no
content by actually rendering a stress fixture and reading back all four
exclusion buckets.

The branch briefly included a one-line note on the new `station` field in
`docs/engineering/contracts/m4.md`; a third reviewer (security-reviewer)
also ran and PASSed on that version, since touching `docs/engineering/
contracts/**` computes as high tier. That tier was discovered only after
two medium-tier rounds had already run, so high tier's required
plan-committed-before-review couldn't be satisfied honestly after the
fact. Rather than backfill a plan, the m4.md commit was reverted here
(`7e03cad`) and moves to its own small PR with a plan written first,
properly reviewed at high tier. This branch is unaffected: no code file
in this diff changed between the reviewed head and now, only that one
doc-only commit was removed.

`pnpm test:integration` could not be executed on this machine this
session — Docker Desktop's backend did not come up after a restart
attempt. code-reviewer and integrity-reviewer each independently verified
the one changed assertion (Groups display labels, same sort order) by
reading `reportFromRows`'s sort logic and `buildGroupsSheet`'s label
mapping rather than running it. Per Earl's 27 Nov decision on
WHR-239/WHR-240, merging now; test:integration will be run and reported
on the final head as soon as Docker recovers.
