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

Fixes WHR-239 defects 1-5 in the renderer: PDF section headings/footnotes
overlapping prior content (baseline mismatch between `Cursor.text()` and
`drawTable()`'s row drawing, unified); the PDF header missing the station
name (WHR-240 Option A: additive, nullable, optional `Report.station`);
"Excluded from totals" showing raw state codes instead of one
sentence-cased line; Excel Groups showing raw product codes instead of
PRODUCT_LABEL; Summary's Period cells now real Date cells. Includes a
test proving a pre-change frozen snapshot with no `station` key still
renders, the WHR-238 item 7 doc fix, and regenerated samples.

Round 1: code-reviewer FAIL (P1: an integration-test assertion still
expected raw product codes; two P2s: the merged "Excluded from
totals"/header line could overflow the page margin with realistic data,
and Summary's Product filter row still showed a raw code). integrity-
reviewer PASS, same overflow flagged non-blocking.

Round 2 (8865d43) fixed all three: updated the integration assertion;
added `Cursor.paragraph()` wrapping for both overflow sites with a test
asserting every text item stays within PAGE_WIDTH-MARGIN on a fixture
built to reproduce the overflow; mapped the Summary filter row through
PRODUCT_LABEL with its own test. Both reviewers re-reviewed fresh at
8865d43: PASS, zero findings; integrity-reviewer confirmed the wrap drops
no content by rendering a stress fixture.

The branch briefly included a one-line `m4.md` contract note, which
computes as high tier. That was only discovered after two medium-tier
rounds had run, so high tier's plan-before-review couldn't be satisfied
honestly after the fact. Reverted here (`7e03cad`) rather than backfilled;
moves to its own small high-tier PR with a plan written first. No code
file in this diff changed between the reviewed head and now.

`pnpm test:integration` could not run this session — Docker's backend
didn't come up after a restart. Both reviewers verified the one changed
assertion (Groups display labels) by reading the sort/label code instead.
Per Earl's 27 Nov decision, merging now; test:integration runs on the
final head once Docker recovers.
