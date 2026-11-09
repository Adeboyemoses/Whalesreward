# Corrections and midnight verification — 9 Nov 2026

WO-core-8 / WHR-14. Backend verification against M3, including merged
WO-spec-3c / P-22. The EM executed the commands and named tests below on frozen source
`c0940c9`; independent reviews follow separately. Correction screens follow in
WO-app-7. WHR-80 and WHR-12 remain In Review for Earl's batched smoke tests.

## Acceptance matrix

| Contract | Required evidence |
|---|---|
| P-22 numeric correction | Only the original recorded basis and entered value; exact captured-rate calculation; strict immutable fields; retained validated, inspectable photo; no unset correction-policy block |
| Trusted midnight | Immutable first durable receipt before slow validation; strictly before Lagos midnight automatic; exactly midnight, late and unresolved dates reviewed; no later clock or verified date reopens the window |
| Immutable operation | Same-key historical receipt replay; changed-content conflict; original capture and evidence unchanged; one pending proposal; stale purchase/base/proposal guards |
| Independent review | Current sales AND corrections grants; recovered executor and grant authorizer excluded from approve, reject and replay; original authorship preserved |
| Contribution | One current accepted contribution and one transaction count; pending late proposal retains prior values; holds and unrelated blocks remain; cancelled sale closes proposals; frozen snapshots stay unchanged |
| Offline ordering | Original upload and correction remain separate operations; original late receipt does not reopen editing; stale saved correction is not silently rebased |
| Private reads | Own-account and station scope; restricted/wrong-kind denial; bounded detail/history and actor/filter-bound cursors; attendant redaction; exact admin summary and page from one snapshot |
| Evidence access | Purchase-bound validated bytes; live authority after slow I/O; no-store attendant stream; current-grant short-lived private admin URL; no URL or storage key in receipts or audit |
| Restart and revocation | Bounded leased processing; stale worker fenced; live lease protected; expired authority and exhausted/configuration-loss work cannot strand proposals or authorize credit |
| Compatibility | Existing P-20/P-21, auth, registration, cards, sync, evidence and browser suites remain intact |

## EM verification output

A fresh dedicated PostgreSQL database applied all 12 migrations. These are EM
results on the combined implementation and independently authored tests:

```text
pnpm typecheck                   exit 0
pnpm lint                        exit 0, no warnings
pnpm test                        49 files, 374 passed
pnpm build                       exit 0; Workbox 31 generic assets
pnpm test:integration             21 files, 302 passed (30.48s)
pnpm test:time                    5 passed in UTC; 5 passed in America/New_York
named correction/read integration 3 files, 42 passed (2.82s)
named correction/read units       6 files, 41 passed (261ms)
pnpm test:e2e (Linux Chromium)    168 passed, 4 existing staging-only skips (2.3m)
signed-upload browser            1 passed (904ms)
```

No backend test was skipped. The primary and independent suites use real
PostgreSQL, real validated JPEG bytes and live authorization, with no disabled
production guards. Test-only receipt triggers set the exact boundary cases;
no HTTP input or production clock override exists. Existing P-20/P-21, auth,
sync, evidence, customer/card and station assertions remain intact.

### Named output

```text
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > reserves receipt and base, then replaces one accepted contribution without rewriting original 159ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > same operation changed material content conflicts before stale version; another pending edit cannot replace it 110ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > rejects unsupported basis changes, replacement evidence and fake recovery provenance 87ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > unavailable retained bytes preserve receipt and original then terminalize after bounded failures 200ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > rechecks live authority after slow evidence read and does not revive a revoked session 104ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > expired exhausted claim is rejected without inventing a reviewer, and cancellation closes pending causally 119ms
✓ |integration| tests/integration/sales-reads.test.ts > M3 sales reads and private evidence > reads own accepted sale and denies foreign IDs, wrong kind and restricted sessions 90ms
✓ |integration| tests/integration/sales-reads.test.ts > M3 sales reads and private evidence > uses current accepted exact amounts for filtered whole-result totals and duplicates remain included 102ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > I-37 durable receipt 2026-11-09T22:59:59.999Z decides the exact Lagos midnight boundary 140ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > I-37 durable receipt 2026-11-09T23:00:00.000Z decides the exact Lagos midnight boundary 95ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > late review approval and lost-response replay replace the contribution exactly once 103ms
✓ |integration| tests/integration/sales-reads.test.ts > M3 sales reads and private evidence > history and detail share strict privacy projection and exact numeric values 51ms
✓ |integration| tests/integration/sales-reads.test.ts > M3 sales reads and private evidence > an expired capture window does not deny reads or renew it 11ms
✓ |integration| tests/integration/sales-reads.test.ts > M3 sales reads and private evidence > serves only own validated bytes and binds signed access to the selected asset 84ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > rejects a stale-base proposal with current guards while preserving the intervening accepted revision 109ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > I-22/I-39 two devices racing one purchase reserve one proposal and preserve the original 102ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > I-22 same correction operation with changed content conflicts before stale version checks 90ms
✓ |integration| tests/integration/sales-reads.test.ts > M3 sales reads and private evidence > bounds each detail collection and resumes its scoped history cursor without leaking private reasons 83ms
✓ |integration| tests/integration/sales-reads.test.ts > M3 sales reads and private evidence > loads authority after a blocked security boundary and denies a permission revoked before release 15ms
✓ |integration| tests/integration/sales-reads.test.ts > M3 sales reads and private evidence > serializes slow photo I/O with permission revocation and denies the next issuance 68ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > I-29 correction above 2^53 keeps exact kobo and captured rate while original remains immutable 82ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > never overwrites a staged resolution candidate; stale proposal rejection leaves it intact 94ms
✓ |integration| tests/integration/sales-reads.test.ts > M3 sales reads and private evidence > rejects impossible Lagos day browsing filters with date_invalid 36ms
✓ |integration| tests/integration/sales-reads.test.ts > M3 sales reads and private evidence > reports missing and pending evidence instead of approving the correction window 44ms
✓ |integration| tests/integration/sales-reads.test.ts > M3 sales reads and private evidence > photo/search HTTP is private, no-store and rejects GET search or unknown query fields 30ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > numeric approval preserves unrelated price hold and zero contribution with its historical validation 141ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > I-29 quantity correction retains precision 2 and rounds money once 136ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > I-29 quantity correction retains precision 3 and rounds money once 77ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > I-37/I-38 a long offline original with a cross-day capture interval cannot reopen automatic correction 66ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > I-39 stale purchase and foreign base guards cannot create correction history 85ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > I-09 revocation during slow evidence validation fences the worker and terminates its proposal 78ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > I-52 an expired worker lease can restart without allowing the stale worker to replace credit 79ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > I-52 a fifth-attempt crash with an expired lease reaches a durable terminal result 67ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > I-52 lost storage configuration settles bounded durable work without a status GET 114ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > I-46 a later accepted correction marks reconciliation and leaves the finalized snapshot byte-identical 63ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > P-19 approve requires both grants and an independent reviewer without rewriting authorship 91ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > P-19 reject requires both grants and an independent reviewer without rewriting authorship 80ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > I-09/P-19 a reviewer losing a grant during photo I/O cannot approve or consume the proposal 54ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > I-39 two independent reviewers racing approve and reject commit one decision 77ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > I-39 cancellation while evidence is in flight closes the proposal and prevents worker credit 65ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > I-29/I-41 accepted original money, captured rate and photo binding are immutable 45ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > I-25 accepted evidence cannot be rebound to another purchase 89ms
✓ |unit| src/server/modules/corrections/cutoff.time.test.ts > correction authoritative time > proves a day only from original bounded interval, never upload or phone time 2ms
✓ |unit| src/server/modules/corrections/cutoff.time.test.ts > correction authoritative time > classifies actual 23:59:59.999 before and exactly 00:00 late in Lagos 0ms
✓ |unit| src/server/adapters/sale-evidence.test.ts > private read-only sale evidence adapter > has no upload/final-write capability and rejects non-final paths 4ms
✓ |unit| src/server/adapters/sale-evidence.test.ts > private read-only sale evidence adapter > checks actual object existence and exact length before allowing issuance 1ms
✓ |unit| src/server/adapters/sale-evidence.test.ts > private read-only sale evidence adapter > signs only GET with no-store and a server-enforced five-minute ceiling 1ms
✓ |unit| src/server/adapters/sale-evidence.test.ts > private read-only sale evidence adapter > preserves bounded read and exposes a safe missing-object error 0ms
✓ |unit| tests/unit/correction-runtime.test.ts > I-52 automatic correction processing lifecycle > opens no resources during build 3ms
✓ |unit| tests/unit/correction-runtime.test.ts > I-52 automatic correction processing lifecycle > opens no resources during no database 1ms
✓ |unit| tests/unit/correction-runtime.test.ts > I-52 automatic correction processing lifecycle > starts durable processing without storage configuration, never overlaps and drains before closing 2ms
✓ |unit| tests/unit/correction-runtime.test.ts > I-52 automatic correction processing lifecycle > drains correction work before invoking the process's previous shutdown listener 2ms
✓ |unit| src/server/modules/sales/cursor.test.ts > M3 scoped sale cursors > preserves database receipt microseconds and binds actor/filter/collection scope 4ms
✓ |unit| src/shared/contracts/sales.test.ts > M3 strict sale contracts > preserves exact amounts above JS safe integer and rejects an inexact counterpart 3ms
✓ |unit| src/shared/contracts/sales.test.ts > M3 strict sale contracts > allows independently verified meter values while preserving original basis facts 0ms
✓ |unit| src/shared/contracts/sales.test.ts > M3 strict sale contracts > accepts only the selected numeric input and rejects immutable fact edits 1ms
✓ |unit| src/shared/contracts/sales.test.ts > M3 strict sale contracts > rejects admin and recovery narrative fields in attendant projections 2ms
✓ |unit| src/shared/contracts/sales.test.ts > M3 strict sale contracts > rejects impossible calendar dates 0ms
✓ |unit| tests/unit/correction-authority.test.ts > P-22 correction input cannot carry authority or capture changes > I-37/P-22 rejects caller-controlled automaticEligible 3ms
✓ |unit| tests/unit/correction-authority.test.ts > P-22 correction input cannot carry authority or capture changes > I-37/P-22 rejects caller-controlled serverReceivedAt 0ms
✓ |unit| tests/unit/correction-authority.test.ts > P-22 correction input cannot carry authority or capture changes > I-37/P-22 rejects caller-controlled cutoffAtReceipt 0ms
✓ |unit| tests/unit/correction-authority.test.ts > P-22 correction input cannot carry authority or capture changes > I-37/P-22 rejects caller-controlled verifiedSaleDate 0ms
✓ |unit| tests/unit/correction-authority.test.ts > P-22 correction input cannot carry authority or capture changes > I-37/P-22 rejects caller-controlled authorship 0ms
✓ |unit| tests/unit/correction-authority.test.ts > P-22 correction input cannot carry authority or capture changes > I-37/P-22 rejects caller-controlled policyBlocks 0ms
✓ |unit| tests/unit/correction-authority.test.ts > P-22 correction input cannot carry authority or capture changes > I-37/P-22 rejects caller-controlled originatingAttendantId 0ms
✓ |unit| tests/unit/correction-authority.test.ts > P-22 correction input cannot carry authority or capture changes > I-37/P-22 rejects caller-controlled customerId 0ms
✓ |unit| tests/unit/correction-authority.test.ts > P-22 correction input cannot carry authority or capture changes > I-37/P-22 rejects caller-controlled cardCode 0ms
✓ |unit| tests/unit/correction-authority.test.ts > P-22 correction input cannot carry authority or capture changes > I-37/P-22 rejects caller-controlled medium 0ms
✓ |unit| tests/unit/correction-authority.test.ts > P-22 correction input cannot carry authority or capture changes > I-37/P-22 rejects caller-controlled productId 0ms
✓ |unit| tests/unit/correction-authority.test.ts > P-22 correction input cannot carry authority or capture changes > I-37/P-22 rejects caller-controlled pumpId 0ms
✓ |unit| tests/unit/correction-authority.test.ts > P-22 correction input cannot carry authority or capture changes > I-37/P-22 rejects caller-controlled rateKobo 0ms
✓ |unit| tests/unit/correction-authority.test.ts > P-22 correction input cannot carry authority or capture changes > I-37/P-22 rejects caller-controlled priceVersionId 0ms
✓ |unit| tests/unit/correction-authority.test.ts > P-22 correction input cannot carry authority or capture changes > I-37/P-22 rejects caller-controlled quantityPrecision 0ms
✓ |unit| tests/unit/correction-authority.test.ts > P-22 correction input cannot carry authority or capture changes > I-37/P-22 rejects caller-controlled photo 0ms
✓ |unit| tests/unit/correction-authority.test.ts > P-22 correction input cannot carry authority or capture changes > I-29 preserves amount-mode kobo above the JavaScript safe integer limit 1ms
✓ |unit| tests/unit/correction-authority.test.ts > P-22 correction input cannot carry authority or capture changes > I-29 rejects nonpositive, inexact or dual-entry edits: {"basis":"amount","enteredAmountKobo":"0"} 0ms
✓ |unit| tests/unit/correction-authority.test.ts > P-22 correction input cannot carry authority or capture changes > I-29 rejects nonpositive, inexact or dual-entry edits: {"basis":"amount","enteredAmountKobo":"-1"} 0ms
✓ |unit| tests/unit/correction-authority.test.ts > P-22 correction input cannot carry authority or capture changes > I-29 rejects nonpositive, inexact or dual-entry edits: {"basis":"amount","enteredAmountKobo":9007199254740992} 0ms
✓ |unit| tests/unit/correction-authority.test.ts > P-22 correction input cannot carry authority or capture changes > I-29 rejects nonpositive, inexact or dual-entry edits: {"basis":"quantity","enteredQuantity":"0.000000"} 0ms
✓ |unit| tests/unit/correction-authority.test.ts > P-22 correction input cannot carry authority or capture changes > I-29 rejects nonpositive, inexact or dual-entry edits: {"basis":"quantity","enteredQuantity":"-0.001"} 0ms
✓ |unit| tests/unit/correction-authority.test.ts > P-22 correction input cannot carry authority or capture changes > I-29 rejects nonpositive, inexact or dual-entry edits: {"basis":"quantity","enteredQuantity":"1.0000001"} 0ms
✓ |unit| tests/unit/correction-authority.test.ts > P-22 correction input cannot carry authority or capture changes > I-29 rejects nonpositive, inexact or dual-entry edits: {"basis":"quantity","enteredQuantity":"1","enteredAmountKobo":"1"} 0ms
✓ |unit| tests/unit/correction-authority.test.ts > P-22 correction input cannot carry authority or capture changes > I-29 rejects nonpositive, inexact or dual-entry edits: {"basis":"amount","enteredAmountKobo":"1","quantity":"1"} 0ms
```

The full regression suite caught an unshipped migration replacing an existing
transition guard and breaking inherited admin transitions. The migration now
adds a revision-specific guard, preserves the existing global guard and passes
the fresh full suite. Stale-base rejection is allowed with current aggregate
guards, while approval cannot overwrite a newer base. Configuration loss and
exhausted leases terminate through bounded polling without a status GET;
live leases and stale-worker fences remain protected. Recovered review uses
trusted server provenance fixtures; this work introduces no recovery intake.

The Linux container received a git archive of the frozen source and a frozen
lockfile install, with no developer checkout or product docs. Browser retries
were zero. The first full run reported 166 passes and two desktop admin loading
timeouts; both cases passed separately and the complete unchanged six-worker run
then passed 168 tests. Both failures preceded behavior-specific interception in
unchanged admin paths and showed an authenticated shell at Loading. An empty
correction worker takes no security lock. Concurrent load is a hypothesis, not a
confirmed root cause; [WHR-87](https://linear.app/phaneum/issue/WHR-87) records the
investigation. No assertion, timeout or retry setting was changed.

## Limits

No correction screens, hold/duplicate mutation endpoints, broad recovery intake,
direct admin numeric editing, replacement evidence, cloud operation, manual
staging-data change, main promotion or device acceptance is claimed.
