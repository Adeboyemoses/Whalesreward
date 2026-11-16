# WHR-153 SR evidence matrix

This is a clause-level inventory, not a claim of complete acceptance. `held-release-service.test.ts` mocks only `assertReleaseV2Installation` to exercise the dormant protocol against PostgreSQL. It writes fictional scoped approval/configuration rows; no deployment is activated. The actual gate is tested separately and must remain closed while giveaway integration is missing. Unit checks are not substituted for required real-Postgres transaction tests.

## Evidence suites

- Service: `tests/integration/held-release-service.test.ts` (real PostgreSQL, dormant gate mock).
- Foundation: `tests/integration/held-release.test.ts` (real PostgreSQL; explicit non-superuser role for immutability).
- Input: `src/shared/contracts/held-release.test.ts` (unit).
- Consistency: `src/server/modules/reviews/release-consistency.test.ts` (unit).
- Photo: `src/server/modules/reviews/release-photo.test.ts` (unit with real JPEG decoding).
- Audit: `src/server/modules/audit/contract.test.ts` (unit normative field matrix).

## Clause mapping and remaining gaps

| Obligation | Exact test name / evidence | Remaining gap |
|---|---|---|
| SR-01 every kind uses ordinary route when v1 sufficient | None yet | Full four-kind ordinary-sufficient matrix |
| SR-01 temporal boundary admission | `SR-01 card material boundary admits only its independently valid paper range`; price equivalent; `SR-05 date approval and lost response replay apply one immutable decision`; capture equivalent | Missing policy/history/customer/settings and uniform-wrong-rate negative matrix |
| SR-01 no reference-subset or phone-time rescue | `SR-01 rejects caller supplied source subsets and decision authority` | Database-level attempted phone-time/source-subset rescue |
| SR-01 captured price throughout J; no numeric correction | Price positive and disjoint-J tests | Boundary-ending equality and numeric-candidate overwrite negatives |
| SR-02 empty/disjoint J | `SR-01 card material boundary admits only its independently valid paper range`; price equivalent include disjoint range denial | Empty interval on date/capture |
| SR-02 exact assignment/replacement/price/campaign/midnight boundaries and whole-day ambiguity | None yet | Full endpoint/whole-day matrix |
| SR-02 outside-campaign timing | None yet | Capture-time-only outside case |
| SR-02 void cancellation; uncertainty/absent entry denial | `SR-02 card cancel requires void-marked paper and preserves terminal zero contribution`; price/date/capture equivalents | Absent-log and mismatched-entry full matrix |
| SR-02 target-only clearing and P-19 | SR-02a cases preserve sibling hold | Explicit P-19 and multi-capture-block cases |
| SR-02 unsupported precision | `SR-02 unsupported paper submillisecond precision returns evidence_insufficient without proposal` | None for this explicit precision case |
| SR-02a inconsistent card/price in both orders | `SR-02a disjoint same-sale card and price attestations deny the second proposal in card_first order`; price_first equivalent | Concurrent ordinary-decision/proposal ordering and later correction/validation/finalization |
| SR-02a contradictory day/membership, missing provenance | `SR-02a overlapping ranges cannot carry contradictory day or campaign predicates`; `SR-02a missing provenance and duplicated decisions cannot fabricate consistency` | Unit-only; database corruption and retained provenance cases |
| SR-02a compatible intersections never supply sibling proof | `SR-02a compatible intersection retains decision versions and leaves original interval unchanged` | Database sibling proof isolation |
| SR-03 missing kind grant, protected reads | `SR-04 photo access is per-kind, bound to proposal and expires within sixty seconds` | Sales grant, audit-only, first-password, recovery, cross-station matrix |
| SR-03 same person/attendant aliases, unknown binding | `SR-03 same-person alias and attendant alias cannot approve`; `SR-03 proposer cannot approve own proposal and unknown reviewer binding denies`; foundation identity tests | Recovery executor/authorizer exclusion runtime cases |
| SR-03 proposer demotion/rebinding | `SR-03 proposer disablement makes approval stale but permits independent rejection` | Grant demotion and binding change separately |
| SR-03 revocation during storage | `SR-03 reviewer revocation during slow evidence read aborts approval`; `SR-04 revoked reviewer cannot receive a sheet URL after slow storage read` | Upload-finalize revocation belongs upload suite |
| SR-04 bytes, digest, decode, overwritten staging | `SR-04 retains validated source, strips display metadata and resists later staging overwrite`; `SR-04 digest mismatch and undecodable source never create final evidence` | Dimension/pixel boundaries and upload endpoint end-to-end cases |
| SR-04 purpose/sale/uploader, deleted/missing photos | Photo access rejects meter ID; photo helper missing/transient test | Complete cross-purpose/uploader/purchase/final-state matrix |
| SR-04 signed-read ceiling and private projections | `SR-04 photo access is per-kind, bound to proposal and expires within sixty seconds`; `SR-08 protected proposal detail and list retain facts while general audit omits them` | Logs/health/SW/attendant canaries and upload URL hard ceilings |
| SR-05 lost response and same-key changes | `SR-05 card approval and lost response replay apply one immutable decision` and other kinds; `SR-05 changed facts under the same proposal operation conflict without a second event` | Reserve/finalize retries and changed photo/outcome/guard variants |
| SR-05 simultaneous proposers/opposing decisions | `SR-05 simultaneous proposers create only one immutable pending proposal`; `SR-05 opposing approvers have one winner under the same purchase and proposal guard` | Ordinary resolution/correction races |
| SR-05 exact meter candidate, original bounds and zero-or-once | Four-kind replay asserts single immutable decision; SR-02a leaves held | Explicit meter candidate and original S/R/expiry/photo byte assertions |
| SR-06 rejection inactive/stale evidence | `SR-06 independent rejection works after deactivation and retains the hold`; `SR-06 unrelated purchase change cannot silently rebase frozen approval` | Missing/deleted evidence rejection |
| SR-06 ordinary closure supersession | None yet | Linked ordinary closure event and atomic supersession |
| SR-06 pending/stale blocker, preview generations, unchanged reconciliation, snapshots | No executable giveaway service exists at base | Dependency-blocked: giveaway initial/revision/reconcile-unchanged runtime; no claim that dormant gate mock proves this |
| SR-07 unknown/partial/bad policy/future/stale/mixed release | `SR-07 actual incomplete installation gate denies even while dormant service tests use a mock` | Runtime configuration/approval negative matrix, meter mismatch; operator suite owned separately |
| SR-07 deactivation serializes approvals; replay current authority | `SR-07 successful approval replays after deactivation without reinterpretation` | Concurrent deactivation/approval and upgrade replay |
| SR-07 no automatic reevaluation | None dedicated | Policy insertion must leave sales unchanged |
| SR-08 provenance I/J/closure/pin/people/results | Successful service rows persist these, but assertions incomplete | Explicit exact provenance and rollback fault injection |
| SR-08 one safe event and no replay duplicates | `SR-05 changed facts under the same proposal operation conflict without a second event`; audit matrix exact fields | All four transition event atomicity and rollback matrix |
| SR-08 bounded scoped pagination/protected reads | `SR-08 protected proposal detail and list retain facts while general audit omits them` | Multi-page cursor traversal/scope tampering/audit-only denial |
| SR-08 pilot retained rejected/superseded photos and immutable history | `SR-08 non-superuser cannot update or delete retained person-binding history`; `SR-08 non-superuser cannot truncate retained person-binding history` | Full proposal/transition/photo retention, rejected/superseded lifecycle assertions |

The installation gate is not eligible to become configured from this evidence. Open matrix cells must be closed or explicitly accepted as dependencies in the work order; passing totals alone are not SR acceptance.
