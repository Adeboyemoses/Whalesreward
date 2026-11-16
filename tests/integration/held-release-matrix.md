# WHR-153 SR evidence matrix

This is the clause-level evidence for WHR-153’s staged delivery. Earl approved WHR-155 Option A on 16 November 2026 and amended WHR-153: the tested blocker/generation hooks ship here; actual SR-06 finalization, revision and unchanged-reconciliation verification belongs to WO-core-12 (WHR-22). This does not claim end-to-end giveaway verification. `held-release-service.test.ts` mocks only `assertReleaseV2Installation` to exercise the dormant protocol against PostgreSQL. It writes fictional scoped approval/configuration rows; no deployment is activated. The actual gate is tested separately and must remain closed while giveaway integration is missing. Unit checks are not substituted for required real-Postgres transaction tests.

## Evidence suites

- Service: `tests/integration/held-release-service.test.ts` (real PostgreSQL, dormant gate mock).
- Foundation: `tests/integration/held-release.test.ts` (real PostgreSQL; explicit non-superuser role for immutability).
- Input: `src/shared/contracts/held-release.test.ts` (unit).
- Consistency: `src/server/modules/reviews/release-consistency.test.ts` (unit).
- Photo: `src/server/modules/reviews/release-photo.test.ts` (unit with real JPEG decoding).
- Audit: `src/server/modules/audit/contract.test.ts` (unit normative field matrix).

## Clause mapping

Parameterized names below expand `%s` with the listed cases. Service, policy and follow-up suites isolate only the installation gate; they do not demonstrate a deployable v2 installation.

| Obligation | Executable evidence / exact test name | Limit |
|---|---|---|
| SR-01 ordinary sufficiency all kinds | `SR-01 %s v1-sufficient target refuses the exception route` (card, price, date, capture) | None |
| SR-01 temporal admission and negative inputs | `SR-01 card material boundary admits only its independently valid paper range`; price equivalent; `SR-01 %s missing customer or incomplete settings never becomes paper admission`; `SR-04 %s missing original meter or sheet bytes cannot approve paper evidence`; `SR-01 a uniformly wrong captured rate cannot be rescued by paper attestation`; `SR-01 %s missing historical price audit cannot be rescued by paper` (all four) | Uniform wrong rate returns ordinary-route required where P-26 can settle it |
| SR-01 source closure and phone proof | `SR-01 caller %s cannot narrow server source closure or rescue phone time` (referenceIds, appCapturedAt, sourceIds); `SR-01 rejects caller supplied source subsets and decision authority` | Strict boundary denial; device time supplies no alternative proof |
| SR-02 disjoint J, wrong entry/numeric values | `SR-02 %s disjoint paper interval and mismatched entry cannot produce an attestation` (all four); strict reversed-range unit test | Empty intersection tested through disjoint I/J |
| SR-02 assignment/replacement/price endpoints | `SR-02 %s paper interval touching the material upper boundary remains ambiguous` (card, price, capture); `SR-08 capture %s structural denial retains the exact boundary source` (assignment_end, context_revocation) | Exact source ID/version and microsecond change boundary asserted |
| SR-02 campaign and midnight boundaries | `SR-02 campaign %s exact endpoint preserves inclusive membership and source boundary` (purchase_start, purchase_cutoff); `SR-02 date paper range spanning Lagos midnight remains ambiguous`; `SR-02 whole-day paper precision cannot select one side of an unresolved midnight` | Cutoff change point is inclusive endpoint plus one microsecond |
| SR-02 outside campaign | `SR-02 capture outside-campaign attestation retains an outside-membership conclusion` | Protected conclusion only; giveaway runtime remains absent |
| SR-02 void/absence/uncertainty | `SR-02 %s cancel requires void-marked paper and preserves terminal zero contribution` (all four); `SR-02 %s paper finding never supplies cancellation authority` (sale_absent, uncertain) | Invalid findings rejected before writes |
| SR-02 exact target and P-19 | `SR-02 selected card target cannot clear sibling timing or P-19 authorship blocks`; disjoint same-sale cases retain sibling hold | No automatic sibling proof |
| SR-02 precision | `SR-02 unsupported paper submillisecond precision returns evidence_insufficient without proposal` | None |
| SR-02a joint ranges both orders | `SR-02a disjoint same-sale card and price attestations deny the second proposal in card_first order`; price_first equivalent | Follow-up ordinary closure/correction race tests below |
| SR-02a malformed retained provenance/contribution | `SR-02a corrupted retained %s removes SQL contribution and denies later consistency checks` (sourceIds, predicates, interval); `SR-02a frozen lookup composite source remains valid protected provenance` | SQL contribution and TS domain check both exercised |
| SR-02a overlapping contradictory predicates/compatible constraints | `SR-02a overlapping ranges cannot carry contradictory day or campaign predicates`; `SR-02a compatible intersection retains decision versions and leaves original interval unchanged`; `SR-02a missing provenance and duplicated decisions cannot fabricate consistency` | These three are pure certificate units; real PostgreSQL `held-release-consistency.test.ts`: `SR-02a overlapping retained %s contradictions deny SQL and later contribution checks` (day, campaign), including valid own-purchase lookup source before contradiction |
| SR-03 grants, identity, recovery | `SR-03 same-person alias and attendant alias cannot approve`; `SR-03 proposer cannot approve own proposal and unknown reviewer binding denies`; `SR-03 recovery %s stored by admin ID is excluded by canonical user identity` (proposer, reviewer); `SR-03 sales-only and audit-only authority cannot read paper proposals or images`; `SR-03 first-password sessions and unrelated resource IDs cannot expose paper evidence` | No private disclosure |
| SR-03 proposer changes | `SR-03 proposer disablement makes approval stale but permits independent rejection`; `SR-03 proposer binding revision makes approval stale even when canonical person is unchanged`; `SR-03 proposer demotion prevents approval but independent rejection remains available` | None |
| SR-03 live revocation and upload scope | `SR-03 reviewer revocation during slow evidence read aborts approval`; `SR-04 revoked reviewer cannot receive a sheet URL after slow storage read`; upload `SR-03/SR-04 revocation during private storage prevents validated evidence commit`; `SR-03 cross-station scope cannot replay a retained reservation`; `SR-03 original attendant alias and rebound uploader cannot reserve or replay`; upload parameterized authority negatives | Real PostgreSQL and deferred storage |
| SR-04 bytes/digest/dimensions/purpose | upload `SR-04 actual %s violation refuses final evidence and leaves sale unchanged`; `SR-04 %s storage condition leaves validation absent and retry safe`; `SR-04 sheet purpose and purchase scope reject original meter asset and foreign purchase IDs`; `SR-04 different authorized uploader cannot sign or finalize another person's reservation` | Actual JPEG bytes/decoding |
| SR-04 immutable source and URLs | upload `SR-04/SR-05 sheet reserve/finalize replay retains immutable bytes and leaves purchase guard unchanged`; `SR-04 reservation expiry and signed PUT expiry never exceed their ceilings`; `SR-04 photo access is per-kind, bound to proposal and expires within sixty seconds` | Source overwrite adversary is exercised |
| SR-04 privacy | `SR-08 %s approval reason stays out of ordinary sales detail and history`; `SR-08 %s cancellation reason stays out of ordinary sales detail and history`; `SR-08 protected proposal detail and list retain facts while general audit omits them`; audit contract exact action field matrix | No UI/SW changes; protected service never emits public URLs |
| SR-05 receipts and changed-key payload | `SR-05 %s approval and lost response replay apply one immutable decision`; `SR-05 changed facts under the same proposal operation conflict without a second event`; `SR-05 changed sheet, outcome and guards cannot reuse a successful proposal operation`; upload `SR-05 changed reserve target or bytes and cross-upload finalize key conflict durably`; `SR-05 simultaneous lost-response reservation retries return one immutable asset and receipt` | Four kinds |
| SR-05 races | `SR-05 simultaneous proposers create only one immutable pending proposal`; `SR-05 opposing approvers have one winner under the same purchase and proposal guard`; upload `SR-04/SR-05 invalid JPEG and simultaneous finalize never create competing validations` | Follow-up exact race tests below |
| SR-05 originals | `SR-08 %s approval preserves original evidence and exact protected people provenance` (all four) | Compares immutable purchase columns and all retained bytes; mutable verified date excluded |
| SR-06 stale rejection/supersession | `SR-06 independent rejection works after deactivation and retains the hold`; `SR-06 unrelated purchase change cannot silently rebase frozen approval`; `SR-06 missing sheet evidence permits rejection and retains immutable source history`; `SR-06 ordinary target closure supersedes pending proposal with linked audit and retained photos` | None |
| SR-06 giveaway initial/revision/unchanged reconciliation, preview generations, frozen snapshots | No executable giveaway service exists at base | Transferred to WO-core-12 (WHR-22) by Earl’s WHR-155 Option A decision; helpers and installation mocks are not end-to-end acceptance evidence |
| SR-07 pins/activation/dependency | service `SR-07 %s configuration cannot admit a release proposal`; policy `SR-07 future approved v2 activation remains unconfigured without reevaluating held sales`; `SR-07 %s approval reference cannot satisfy the exact v2 persisted pin`; `SR-07 mixed installed release fails closed even with a matching persisted v2 approval`; `SR-07 valid v1 meter package becomes unconfigured with v2 dependency without relabeling provenance` | Gate remains closed |
| SR-07 serialization/replay | `SR-07 deactivation serializes behind a pinned decision transaction and then denies the old pin`; `SR-07 deactivation during approval photo inspection prevents commit and preserves pending zero credit`; `SR-07 historical approval receipt after %s switch preserves original result and checks live reviewer` (v1, v2) | Real configuration rows and locking |
| SR-07 no reevaluation | `SR-07 approval/configuration upgrade and deactivation never auto-release pending proposals or holds` | None |
| SR-08 provenance and rollback | `SR-08 %s approval preserves original evidence and exact protected people provenance`; `SR-08 audit failure rolls back approval, receipt, contribution and transition together`; exact boundary tests above | Full original/protected evidence assertions |
| SR-08 pagination/protected reads | `SR-08 protected proposal pagination is bounded, ordered and cursor-scoped`; sales-only/audit-only/first-password tests above | None |
| SR-08 retained history | Foundation `SR-08 non-superuser cannot update or delete retained person-binding history`; `SR-08 non-superuser cannot truncate retained person-binding history`; missing-sheet rejection and supersession cases above | Follow-up non-superuser retained proposal/transition/sheet test below |

## Independent follow-up PostgreSQL evidence

`tests/integration/held-release-followup.test.ts` adds nine passing tests (commit a86fb1a, integrated as 6222660). Exact names:

- `SR-02a later validation rejects missing applied attestation provenance without rewriting original receipt`
- `SR-02a later correction approval rejects corrupt retained attestation and preserves accepted values`
- `SR-05 later valid correction keeps attestation history while accepting exactly one numeric revision`
- `SR-05 card attestation preserves exact retained meter candidate instead of restoring captured numbers`
- `SR-08 non-superuser cannot update delete or truncate retained proposal transition and sheet history`
- `SR-05/SR-06 ordinary target closure supersedes pending paper proposal with linked immutable event`
- `SR-05 concurrent later correction approvals retain attestation and accept one guarded revision`
- `SR-05 ordinary target closure racing stale paper approval has one terminal application`
- `SR-05 correction submission racing paper proposal cannot reuse same purchase guard`

Giveaway integration and its actual SR-06 finalization/revision/unchanged-reconciliation tests remain with WO-core-12 (WHR-22), per Earl’s WHR-155 staged-delivery decision; the real complete-install gate stays unconfigured. The outside-campaign test proves the retained conclusion only, not giveaway filtering. No helper/mocked installation test is counted as initial/revision/unchanged-finalization evidence.

HTTP boundary unit suite `src/server/modules/reviews/release-http.test.ts` covers all eight actions: session/route IDs, safe errors, rate retry, mutating origin checks, 32 KiB JSON ceiling, duplicate query rejection, replay status and purchase URL limit. These units supplement rather than replace domain PostgreSQL tests.

## Retained SR-06 hooks — staged delivery

`tests/integration/held-release-hooks.test.ts` directly exercises `pendingReleaseBlockers` and the PostgreSQL reporting-generation trigger (nine cases):

- `SR-06 hook %s transition removes pending blocker and advances generation with dirty reconciliation` (approved, rejected, superseded).
- `SR-06 hook stale pending and deactivated policy remain blocking without generation reinterpretation`.
- `SR-06 hook %s rollback restores generation dirty bit blocker history and receipts` (proposal, approval).
- `SR-06 hook upload reservation alone does not dirty campaign advance generation or add blocker`.
- `SR-06 hook blocker union counts each purchase once by kind and excludes other stations`.
- `SR-06 state trigger alone advances exactly one station generation and rolls back with its transition`.

These tests use real PostgreSQL, with only the dormant installation gate mocked. Snapshot rows are fixtures used to assert dirty-generation propagation and retained bytes; no finalization, revision or unchanged-reconciliation endpoint is implemented or verified. Those actual SR-06 workflows remain with WHR-22.
