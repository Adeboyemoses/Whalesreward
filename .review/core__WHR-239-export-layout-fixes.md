---
branch: core/WHR-239-export-layout-fixes
linear: WHR-239
tier: high
reviewed_head: 8865d43
rounds: 3
builder: backend-engineer
reviewers:
  code-reviewer: PASS (round 2)
  integrity-reviewer: PASS (round 2)
  security-reviewer: PASS (round 3)
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 6
invariants: [I-29, I-40, I-42, I-43, I-44, I-46]
p1: [fixed in round 2 commit 8865d43]
tickets: []
# escalation: EM mis-tiered this medium at dispatch (tier computed before the
# m4.md contract commit landed, which makes it high). Two rounds ran as
# medium (code-reviewer + integrity-reviewer, both PASS). On catching this
# before merge, re-ran the tier script, added security-reviewer as round 3
# (PASS, zero findings), and recorded here rather than silently treating it
# as satisfied. The high-tier plan: block was not committed before the
# builder's dispatch, because the tier was not yet known to be high at
# that time; Earl acknowledged this gap on 2026-11-28 for this PR
# specifically (a 4-line additive m4.md doc note plus display-only server
# plumbing, with no auth/permission/schema-activation change — confirmed
# by security-reviewer) rather than reopen the branch to backfill a plan
# that would describe work already independently reviewed three times.
---

Fixes WHR-239 defects 1-5 in the report export renderer: PDF section
headings/footnotes overlapping prior content (baseline-direction mismatch
between `Cursor.text()` and `drawTable()`'s row drawing, unified); the PDF
header missing the station name (WHR-240 Option A: additive, nullable,
optional `Report.station`, documented in m4.md, with a test proving a
pre-change frozen snapshot with the key entirely absent still renders);
"Excluded from totals" showing raw state codes instead of one sentence-cased
line; the Excel Groups sheet showing raw product codes instead of
PRODUCT_LABEL display labels; and Summary's Period cells now real Date
cells. Includes the WHR-238 item 7 doc-credit fix and regenerated samples.

Round 1 (medium, as then computed): code-reviewer FAIL (P1: an
integration-test assertion still expected raw product codes after the
Groups-label fix; two P2s: the merged "Excluded from totals"/header line
could overflow the PDF's right margin with realistic data, and Summary's
Product filter row still showed a raw code when a filter was set).
integrity-reviewer PASS with the same overflow issue flagged non-blocking.

Round 2 (commit 8865d43) fixed all three: updated the integration
assertion to the display labels; added `Cursor.paragraph()` wrapping text
against the page's usable width for both overflow sites, with a new test
asserting every text item on every page stays within PAGE_WIDTH-MARGIN
using a fixture built to reproduce the original overflow; mapped the
Summary filter row through PRODUCT_LABEL with its own test. Both reviewers
re-reviewed fresh at 8865d43 and returned PASS with zero findings;
integrity-reviewer additionally confirmed the wrap drops no content by
actually rendering a stress fixture and reading back all four exclusion
buckets.

Round 3: re-running the tier script on the final diff showed `m4.md`
(docs/engineering/contracts/**) makes this high tier, requiring
security-reviewer. Dispatched fresh against the full diff: PASS, zero
findings — confirmed the widened `reportAuthority` SELECT is gated behind
existing permission checks everywhere it's read, the new `station` field
can only ever carry the caller's own station (id from the database, never
from the request), the m4.md note claims nothing beyond what's
implemented, and the frozen-snapshot backward-compatibility path
introduces no auth-bypass surface.

`pnpm test:integration` could not be executed on this machine this
session — Docker Desktop's backend did not come up after a restart
attempt. code-reviewer and integrity-reviewer each independently verified
the one changed assertion (Groups display labels, same sort order) by
reading `reportFromRows`'s sort logic and `buildGroupsSheet`'s label
mapping rather than running it. Per Earl's 27 Nov decision on
WHR-239/WHR-240, merging now; test:integration will be run and reported
on the final head as soon as Docker recovers.
