# Corrections and midnight verification — 9 Nov 2026

WO-core-8 / WHR-14. Backend verification against M3, including merged
WO-spec-3c / P-22. The EM executed the commands and named tests below on frozen source
`3a003d4` (including the prepared dotted-phone fix and merged spec READY
records). Three review rounds are complete; the prepared fix awaits Earl's
explicit exception for one additional round. This is not a READY claim. Correction screens follow in
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

A fresh dedicated PostgreSQL database applied all 13 migrations. These are EM
results on the combined implementation and independently authored tests:

```text
pnpm typecheck                   exit 0
pnpm lint                        exit 0, no warnings
pnpm test                        49 files, 374 passed
pnpm build                       exit 0; Workbox 31 generic assets
pnpm test:integration             21 files, 330 passed (10.79s)
pnpm test:time                    5 passed in UTC; 5 passed in America/New_York
named correction/read integration 3 files, 70 passed (3.70s)
named correction/read units       6 files, 41 passed (251ms)
pnpm test:e2e --workers=2 (Linux) 168 passed, 4 existing staging-only skips (3.1m)
signed-upload browser            1 passed; sequential run, dedicated output directory
```

No backend test was skipped. The primary and independent suites use real
PostgreSQL, real validated JPEG bytes and live authorization, with no disabled
production guards. Test-only receipt triggers set the exact boundary cases;
no HTTP input or production clock override exists. Existing P-20/P-21, auth,
sync, evidence, customer/card and station assertions remain intact.

### Named output

```text
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > reserves receipt and base, then replaces one accepted contribution without rewriting original 116ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > same operation changed material content conflicts before stale version; another pending edit cannot replace it 72ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > rejects unsupported basis changes, replacement evidence and fake recovery provenance 72ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > unavailable retained bytes preserve receipt and original then terminalize after bounded failures 121ms
✓ |integration| tests/integration/sales-reads.test.ts > M3 sales reads and private evidence > reads own accepted sale and denies foreign IDs, wrong kind and restricted sessions 66ms
✓ |integration| tests/integration/sales-reads.test.ts > M3 sales reads and private evidence > uses current accepted exact amounts for filtered whole-result totals and duplicates remain included 88ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > I-37 durable receipt 2026-11-09T22:59:59.999Z decides the exact Lagos midnight boundary 112ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > I-37 durable receipt 2026-11-09T23:00:00.000Z decides the exact Lagos midnight boundary 90ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > rechecks live authority after slow evidence read and does not revive a revoked session 60ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > expired exhausted claim is rejected without inventing a reviewer, and cancellation closes pending causally 114ms
✓ |integration| tests/integration/sales-reads.test.ts > M3 sales reads and private evidence > history and detail share strict privacy projection and exact numeric values 49ms
✓ |integration| tests/integration/sales-reads.test.ts > M3 sales reads and private evidence > an expired capture window does not deny reads or renew it 9ms
✓ |integration| tests/integration/sales-reads.test.ts > M3 sales reads and private evidence > serves only own validated bytes and binds signed access to the selected asset 64ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > I-22/I-39 two devices racing one purchase reserve one proposal and preserve the original 83ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > I-22 same correction operation with changed content conflicts before stale version checks 89ms
✓ |integration| tests/integration/sales-reads.test.ts > M3 sales reads and private evidence > bounds each detail collection and resumes its scoped history cursor without leaking private reasons 75ms
✓ |integration| tests/integration/sales-reads.test.ts > M3 sales reads and private evidence > loads authority after a blocked security boundary and denies a permission revoked before release 21ms
✓ |integration| tests/integration/sales-reads.test.ts > M3 sales reads and private evidence > serializes slow photo I/O with permission revocation and denies the next issuance 64ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > late review approval and lost-response replay replace the contribution exactly once 104ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > I-29 correction above 2^53 keeps exact kobo and captured rate while original remains immutable 128ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > rejects a stale-base proposal with current guards while preserving the intervening accepted revision 118ms
✓ |integration| tests/integration/sales-reads.test.ts > M3 sales reads and private evidence > rejects impossible Lagos day browsing filters with date_invalid 50ms
✓ |integration| tests/integration/sales-reads.test.ts > M3 sales reads and private evidence > reports missing and pending evidence instead of approving the correction window 149ms
✓ |integration| tests/integration/sales-reads.test.ts > M3 sales reads and private evidence > photo/search HTTP is private, no-store and rejects GET search or unknown query fields 29ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > never overwrites a staged resolution candidate; stale proposal rejection leaves it intact 302ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > I-29 quantity correction retains precision 2 and rounds money once 267ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > numeric approval preserves unrelated price hold and zero contribution with its historical validation 130ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > I-29 quantity correction retains precision 3 and rounds money once 118ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > I-37/I-38 a long offline original with a cross-day capture interval cannot reopen automatic correction 72ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > a automatic correction preserves a legitimately resolved price hold and its original history 67ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > a late correction preserves a legitimately resolved price hold and its original history 84ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > I-39 stale purchase and foreign base guards cannot create correction history 88ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > I-09 revocation during slow evidence validation fences the worker and terminates its proposal 58ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > correction audit records exact effective changes, actual operations and immutable executor/seller snapshots without private payloads 127ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > I-52 an expired worker lease can restart without allowing the stale worker to replace credit 70ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > I-52 a fifth-attempt crash with an expired lease reaches a durable terminal result 74ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > rejects private correction reason before audit persistence: Call +2348000000099 78ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > rejects private correction reason before audit persistence: token=fictional-private-value 68ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > I-52 lost storage configuration settles bounded durable work without a status GET 100ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > I-46 a later accepted correction marks reconciliation and leaves the finalized snapshot byte-identical 65ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > rejects private correction reason before audit persistence: OTP: 123456 60ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > rejects private correction reason before audit persistence: OTP 123456 59ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > rejects private correction reason before audit persistence: token fictional-private-value 55ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > rejects private correction reason before audit persistence: Call 080****0099 56ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > P-19 approve requires both grants and an independent reviewer without rewriting authorship 92ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > P-19 reject requires both grants and an independent reviewer without rewriting authorship 90ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > rejects private correction reason before audit persistence: Receipt https://private.example.test/object 58ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > HTTP rejects formatted phone in submit and decision without domain writes: +234 800 000 0099 91ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > I-09/P-19 a reviewer losing a grant during photo I/O cannot approve or consume the proposal 61ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > I-39 two independent reviewers racing approve and reject commit one decision 92ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > HTTP rejects formatted phone in submit and decision without domain writes: +234.800.000.0099 87ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > HTTP rejects formatted phone in submit and decision without domain writes: +1.(000).000.0000 67ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > I-39 cancellation while evidence is in flight closes the proposal and prevents worker credit 68ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > I-29/I-41 accepted original money, captured rate and photo binding are immutable 43ms
✓ |integration| tests/integration/corrections-adversarial.test.ts > M3 independent PostgreSQL correction adversaries > I-25 accepted evidence cannot be rebound to another purchase 77ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > HTTP rejects formatted phone in submit and decision without domain writes: +1 (000) 000-0000 70ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > HTTP rejects formatted phone in submit and decision without domain writes: +44 (0000) 000-000 70ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > HTTP rejects formatted phone in submit and decision without domain writes: 2348000000099 65ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > HTTP rejects formatted phone in submit and decision without domain writes: +234 (800) 000-0099 66ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > HTTP rejects formatted phone in submit and decision without domain writes: (+234)-800-000-0099 64ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > HTTP rejects formatted phone in submit and decision without domain writes: + 2 3 4 (8 0 0) 0 0 0-0 0 9 9 55ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > HTTP rejects formatted phone in submit and decision without domain writes: +234 (0) 800 000 0099 75ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > HTTP rejects formatted phone in submit and decision without domain writes: (080) 000-00099 83ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > HTTP rejects formatted phone in submit and decision without domain writes: 0 (8 0 0) 000 0099 94ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > HTTP rejects formatted phone in submit and decision without domain writes: +234 (80*) ***-0099 57ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > HTTP rejects formatted phone in submit and decision without domain writes: (080) ****-0099 57ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > HTTP accepts numeric operational reasons and redacts formatted phone actor and original seller snapshots 125ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > HTTP decision independently rejects formatted phone with unchanged proposal: +234 800 000 0099 51ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > HTTP decision independently rejects formatted phone with unchanged proposal: +234 (800) 000-0099 56ms
✓ |integration| tests/integration/corrections.test.ts > M3 durable own correction processing > HTTP decision independently rejects formatted phone with unchanged proposal: +234.800.000.0099 64ms
✓ |unit| src/server/adapters/sale-evidence.test.ts > private read-only sale evidence adapter > has no upload/final-write capability and rejects non-final paths 3ms
✓ |unit| src/server/adapters/sale-evidence.test.ts > private read-only sale evidence adapter > checks actual object existence and exact length before allowing issuance 2ms
✓ |unit| src/server/adapters/sale-evidence.test.ts > private read-only sale evidence adapter > signs only GET with no-store and a server-enforced five-minute ceiling 2ms
✓ |unit| src/server/adapters/sale-evidence.test.ts > private read-only sale evidence adapter > preserves bounded read and exposes a safe missing-object error 1ms
✓ |unit| tests/unit/correction-runtime.test.ts > I-52 automatic correction processing lifecycle > opens no resources during build 4ms
✓ |unit| tests/unit/correction-runtime.test.ts > I-52 automatic correction processing lifecycle > opens no resources during no database 1ms
✓ |unit| tests/unit/correction-runtime.test.ts > I-52 automatic correction processing lifecycle > starts durable processing without storage configuration, never overlaps and drains before closing 4ms
✓ |unit| tests/unit/correction-runtime.test.ts > I-52 automatic correction processing lifecycle > drains correction work before invoking the process's previous shutdown listener 3ms
✓ |unit| src/server/modules/corrections/cutoff.time.test.ts > correction authoritative time > proves a day only from original bounded interval, never upload or phone time 2ms
✓ |unit| src/server/modules/corrections/cutoff.time.test.ts > correction authoritative time > classifies actual 23:59:59.999 before and exactly 00:00 late in Lagos 0ms
✓ |unit| src/server/modules/sales/cursor.test.ts > M3 scoped sale cursors > preserves database receipt microseconds and binds actor/filter/collection scope 4ms
✓ |unit| tests/unit/correction-authority.test.ts > P-22 correction input cannot carry authority or capture changes > I-37/P-22 rejects caller-controlled automaticEligible 2ms
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
✓ |unit| tests/unit/correction-authority.test.ts > P-22 correction input cannot carry authority or capture changes > I-29 preserves amount-mode kobo above the JavaScript safe integer limit 0ms
✓ |unit| tests/unit/correction-authority.test.ts > P-22 correction input cannot carry authority or capture changes > I-29 rejects nonpositive, inexact or dual-entry edits: {"basis":"amount","enteredAmountKobo":"0"} 0ms
✓ |unit| tests/unit/correction-authority.test.ts > P-22 correction input cannot carry authority or capture changes > I-29 rejects nonpositive, inexact or dual-entry edits: {"basis":"amount","enteredAmountKobo":"-1"} 0ms
✓ |unit| tests/unit/correction-authority.test.ts > P-22 correction input cannot carry authority or capture changes > I-29 rejects nonpositive, inexact or dual-entry edits: {"basis":"amount","enteredAmountKobo":9007199254740992} 0ms
✓ |unit| tests/unit/correction-authority.test.ts > P-22 correction input cannot carry authority or capture changes > I-29 rejects nonpositive, inexact or dual-entry edits: {"basis":"quantity","enteredQuantity":"0.000000"} 0ms
✓ |unit| tests/unit/correction-authority.test.ts > P-22 correction input cannot carry authority or capture changes > I-29 rejects nonpositive, inexact or dual-entry edits: {"basis":"quantity","enteredQuantity":"-0.001"} 0ms
✓ |unit| tests/unit/correction-authority.test.ts > P-22 correction input cannot carry authority or capture changes > I-29 rejects nonpositive, inexact or dual-entry edits: {"basis":"quantity","enteredQuantity":"1.0000001"} 0ms
✓ |unit| tests/unit/correction-authority.test.ts > P-22 correction input cannot carry authority or capture changes > I-29 rejects nonpositive, inexact or dual-entry edits: {"basis":"quantity","enteredQuantity":"1","enteredAmountKobo":"1"} 0ms
✓ |unit| tests/unit/correction-authority.test.ts > P-22 correction input cannot carry authority or capture changes > I-29 rejects nonpositive, inexact or dual-entry edits: {"basis":"amount","enteredAmountKobo":"1","quantity":"1"} 0ms
✓ |unit| src/shared/contracts/sales.test.ts > M3 strict sale contracts > preserves exact amounts above JS safe integer and rejects an inexact counterpart 3ms
✓ |unit| src/shared/contracts/sales.test.ts > M3 strict sale contracts > allows independently verified meter values while preserving original basis facts 0ms
✓ |unit| src/shared/contracts/sales.test.ts > M3 strict sale contracts > accepts only the selected numeric input and rejects immutable fact edits 1ms
✓ |unit| src/shared/contracts/sales.test.ts > M3 strict sale contracts > rejects admin and recovery narrative fields in attendant projections 2ms
✓ |unit| src/shared/contracts/sales.test.ts > M3 strict sale contracts > rejects impossible calendar dates 0ms
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

The final review-fix browser run used a newly migrated and seeded database
(one role, three users, five pumps), two local workers and a dedicated artifact
directory. A reused diagnostic database had accumulated 91 roles, 481 users and
968 pumps; subsequent loading/pagination timeouts there are recorded in WHR-87.
Reducing workers alone on that old database did not prove a pass, and its
interrupted run is excluded. One diagnostic also collided with a concurrent
Playwright configuration clearing the shared trace directory; the resulting
ENOENT failures were an EM setup error. Final browser and storage checks ran
sequentially. CI's retry policy, test assertions and timeouts remain unchanged.

## Review regressions

Round one reproduced two P1s: immutable original validation reasons incorrectly
prevented corrections after a legitimate price-hold resolution, and correction
audit rows omitted actual reasons, effective before/after values and decision
operation identity. Automatic and late-review regressions failed before the fix
and pass now. Current outstanding holds/blocks and durable resolution evidence
control qualification; original validation history remains unchanged and unknown
history stays blocked.

New correction events store allowlisted exact effective values, the actual
operation/reason, immutable actor and original-seller snapshots, and a system
validation executor for asynchronous events. The additive snapshot columns stay
nullable for unknown legacy identities; no historical identity is invented.
Submission receipt audits retain the prior effective amount until validation.
Privacy regressions reject sensitive reasons before any proposal, decision or
audit write. [WHR-89](https://linear.app/phaneum/issue/WHR-89) tracks separate
function-level gaps in the unchanged legacy access/station redactor; no endpoint
exposure was reproduced for that follow-up.

Round two confirmed the eligibility and audit fixes, then reproduced formatted
international phones entering a new correction audit through authenticated HTTP.
Final regressions first failed for submission, decision and display snapshots.
The local detector now handles normal separators, masks and international phone
shapes without a numbering-policy dependency. HTTP tests verify generic rejection,
no changed proposal/decision/audit state, sanitized snapshots and successful
ordinary numeric reasons. Existing access/station writers remain outside this
change, as WHR-89 records.

The third security review reproduced dotted phones bypassing the detector.
A prepared two-line detector correction includes dotted punctuation in matching
and normalization. Four HTTP/snapshot assertions failed before that correction;
all now pass, alongside the full 330-test PostgreSQL suite. Submission, decision
and snapshot regressions cover dotted Nigerian and international forms. The
review cap is three; this fix remains unreviewed pending Earl's explicit approval
for one additional round. No PR or READY state is claimed before that review.

## Limits

No correction screens, hold/duplicate mutation endpoints, broad recovery intake,
direct admin numeric editing, replacement evidence, cloud operation, manual
staging-data change, main promotion or device acceptance is claimed.
