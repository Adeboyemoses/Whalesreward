# Audit writer reconciliation — WO-spec-3m / WHR-130

Inventoried on 13 November 2026 at staging `fdcf789` (P-27 app refresh merged). This is a source inventory, not an inspection of client data or live audit rows. [M3's amended catalogue](m3.md#audit-queries-and-safe-event-shapes--g01g05-i-41) is normative. No code, database rows, runtime policy, provider or cloud resource is changed here. WO-core-11 / WHR-20 receives the writer fixes below.

## Inventory method and boundaries

Search all tracked `src`, `scripts`, `jobs` and Prisma source/migrations for `audit_event`, audit helpers and their callers. Read all nine insert sites: admin-access/repo, station/repo, sync/repo, corrections/service, reviews/service, duplicates/service and customers/recovery (seven runtime modules), plus the two historical fixture helpers, which are excluded as test writers. No migration trigger or job supplies additional general events. The CLI writes operational rows directly; its immutable records are not `audit_event` rows.

The action tables below inventory domain writers only. `admin_access_event`, `sale_decision`, `customer_identity_change`, `customer_recovery_case`, `review_evaluation`, verification delivery/attempts and policy approval/configuration are separate protected records. Their presence does not prove a general audit event exists. Replay reads, lookup, health and online price refresh do not write audit. `prisma/seed.ts`, `prisma/seed-auth.mjs` and other provisioning paths do not supply a hidden business-event writer.

Source paths below are relative to `src/server/modules/` unless explicitly marked. `A` means exact raw before/after keys emitted today; `∅` means null/empty. Numeric `version` fields are currently JSON numbers except P-21's explicit strings. These raw shapes are not permission to expose them. “Map” specifies the canonical future action, not an assertion that current writers already comply.

## Current writers: access, station, cards and customers

| Source / stored action | Current target and actor | A: exact current payload keys | Reconciliation |
|---|---|---|---|
| `admin-access/service.ts`: `role_created`, `role_changed` | role / admin | `roleName`, `permissions`; creation before null | Names/fields already catalogued; freeze attribution and add envelope metadata |
| Same: `user_created`, `user_access_changed` | admin / admin | `roleId`, `roleName`, `enabled`, `emailVerified`; creation before null | Fields already catalogued; no email value |
| Same: `verification_requested` | admin / admin | before null; after `emailVerified:false` | Existing action/field; requester, not recipient |
| `admin-access/mail.ts`: `email_verified` | admin / system, null actor user | `emailVerified` false→true | system:access identifies recipient-confirmed link flow; no invented admin session |
| Same: `password_reset` | admin / system, null actor user | ∅ | system:access; no password, challenge or address payload |
| `admin-access/sessions.ts`: `password_changed` | admin / authenticated admin | ∅ | Already catalogued |
| `auth/first-password.ts`: `password_changed` | attendant / authenticated attendant | ∅ | Fix M3's former admin-only target mapping; preserve attendant identity |
| `station/service.ts`: `pump_created` | pump / admin | before null; after `name`, `productId`, `version` | All three keys previously outside fields; name becomes safe immutable subject, productId added, version→pumpVersion |
| Same: `attendant_created` | attendant / admin | before null; after `staffCode`, `username`, `name`, `version` | Raw keys outside fields; safe identity belongs in immutable target context, version→attendantVersion; no credential |
| Same: `assignment_changed` (creation and reassignment) | attendant / admin | `assignmentId`, `pumpId`, `version`; before null for initial/new-after-gap assignment | version→assignmentVersion; add exact committed effectiveFrom and operation/time metadata |
| Same: `assignment_ended` | attendant / admin | `assignmentId`, `pumpId`, `effectiveUntil`, `attendantVersion`, `authVersion` | Five fields already match P-21; operationId and occurredAt=T supplied. Add common snapshots/envelope without changing these values |
| Same: `price_activated` | product / admin | `priceVersionId`, `version`, `rateKobo`, `quantityPrecision`; first before null | version→priceVersion; add currency and committed effectiveFrom/occurredAt. P-27 adds no read/adoption event |
| `cards/service.ts`: `batch_generated` | card_batch / admin | before null; after `status`, `version` | status→batchStatus, version→batchVersion |
| Same: `batch_status_changed` | card_batch / admin | `status`, `version` | generated→printed maps `batch_printed`; printed→active maps `batch_activated`; no other transition is inferred |
| Same: `batch_export_requested` | card_batch / requesting admin | before null; after `exportId`, `format`, `cardCount` | New canonical `export_requested`; exportId added, format→exportFormat, cardCount→recordCount |
| `cards/exports.ts`: `batch_export_prepared` | card_batch / creator's user ID | before null; after `exportId` | Map `export_prepared`; actual executor system:export, preserve creator in protected export provenance; add exportFormat |
| `customers/service.ts`: `customer_registered` | customer / registering attendant | before null; after `customerCode`, `category`, `cardId`, `stationId` | customerCode→target.code, stationId→envelope, category→customerCategory; cardId added; no phone persisted here |
| `customers/recovery.ts`: `phone_changed` | customer / admin | before null; after `phoneChanged`, `verificationMethod` | Existing safe fields; add identityChangeId, categorical transition without phone values |
| Same: `card_replaced` | retired old card / admin | before null; after `oldCardCode`, `newCardCode`, `customerId`, `replacementCardId`, `verificationMethod` | Former field list admitted card codes but target list disagreed. Remove codes, use oldCardId/newCardId and identityChangeId; retain customerId; canonical target stays old card |
| Same: `manager_case_recorded` | manager_case / intake admin | before null; after `caseId`, `verificationMethod` | Fields match; fixed reason “Customer recovery intake”; protected case notes remain separate |

`station/repo.ts` accepts arbitrary before/after objects and sanitizes only reason; it supplies no actor snapshot. `admin-access/repo.ts` enforces access-values fields but lacks event-time actor snapshots and operation IDs. The customer-recovery helper snapshots its actor, but uses an unconstrained values object. Export success currently attributes the worker to its requesting user; terminal failure updates export state without an audit insert. Both ordinary render failures and exhausted/expired-lease cleanup paths need the same fenced terminal event rule.

## Current writers: purchases, corrections, decisions and duplicates

For current correction/review payloads, `C` is exactly `amountKobo`, `quantity`, `currency`, `unit`, `basis`, `medium`, `rateKobo`, `priceVersionId`, `revisionId`, `credited`, `correctionState`. All those names were already in M3, but `correctionState:null` was not explicit. Basis stays amount/quantity. Ordinary corrections on a meter-evidence revision remain forbidden. Add the missing calculation field (captured_rate/meter_evidence) to future effective-value audit snapshots, preserving P-26 through later date/card/capture decisions without changing capture basis.

| Source / stored action | Current target and actor | A: exact current payload keys | Reconciliation |
|---|---|---|---|
| `sync/service.ts` via `sync/repo.ts`: `purchase.cancelled` | purchase / uploading user | before `{}`; after `reason:'customer_not_found'` | Map only this categorical reason to `sale_cancelled_unmatched`; system:sync is executor, original seller remains separate; canonical state/credit fields replace payload reason |
| `sync/settle.ts` via `sync/repo.ts`: `purchase.credited` | purchase / uploading user | before `{}`; after `revisionId`, `assetId`, `reasons`, `campaignEligible` | Map `sale_credited`; system:validation; assetId→photoAssetId, explicit typed gate/contribution snapshots replace reasons/campaignEligible |
| Same: `purchase.held` | purchase / uploading user | Same four keys | New `sale_held`; revisionId here is a proposed original, not an accepted pointer: map to candidateRevisionId, leave accepted revisionId null |
| `corrections/service.ts`: `correction_received` | purchase / submitting attendant | C; before correctionState null; after pending_validation | Existing fields; immutable effective values, not proposal spend |
| Same: `correction_applied` | purchase / system:validation | C | Automatic acceptance already identifies validator separately from original seller |
| Same: `correction_rejected` during automatic validation | purchase / system:validation | C; pending_validation→rejected | No sale_decision exists for automatic rejection; retain categorical validation reason, no invented deciding admin |
| Same: `correction_approved`, `correction_rejected` | purchase / deciding admin | C | Add decisionId/outcome; retain prior contribution on rejection, including stale-base rejection |
| `reviews/service.ts` + `reviews/audit-actions.ts`: `duplicate_cleared`, `duplicate_cancelled` | purchase / deciding admin | C | Add calculation, exact pair/flag state and decision/guard result; no review-policy projection for duplicate decisions |
| Same: `price_accepted`, `price_cancelled`, `price_corrected` | purchase / deciding admin | C plus conditional policy fields below | Actions already catalogued; common writer exists, but P-25 explicitly refuses price cancellation and meter correction is not installed at this head |
| Same: `card_eligibility_confirmed`, `card_eligibility_cancelled` | purchase / deciding admin | C plus conditional policy fields | Preserve before/after, add typed decision/gates and policy projection |
| Same: `sale_date_verified`, `capture_confirmed`, `capture_cancelled` | purchase / deciding admin | C plus conditional policy fields | Add verified date or capture gate changes and decision identity; no copied evidence notes |
| `duplicates/service.ts`: `duplicate_flagged` | lower sorted purchase ID / system, no snapshot | before `{}`; after `flagId`, `purchaseIds` | Existing action, two previously unlisted keys. Add pair/flag fields and duplicateState; system:validation; no photo digest |

With a successful P-25 evaluation, the review writer additionally emits `reviewPolicy:{release,digest,revision}`, `reviewConclusions:string[]` and `reviewEvaluationId` (the decision ID). All three outer keys were outside M3's original field catalogue; digest is prohibited by this amendment. Flatten only release/revision to the closed fields; validate conclusion tags; retain evaluation identity. Never expose the whole evaluation or use a generic JSON passthrough. Decisions without an evaluation must not acquire a fabricated policy identity.

Sync's raw `reasons` array is not identical to `policyBlocks`: it includes price/card/campaign/authorization diagnostics. Map only documented typed holds/blocks from the committed outcome; do not blindly rename it. `campaignEligible` is not `credited` or general qualifying spend. A held event's proposed revision cannot become accepted merely through an audit adapter. Historical values must come from retained event-time evidence; if insufficient, omit the unavailable change under schemaVersion=0.

The correction/review writers already snapshot actor and original seller, unlike most M2/sync writers. Automatic correction validation already passes a null user ID and snapshots system:validation for accepted/rejected outcomes. Preserve this distinction; transition to awaiting_review writes no additional general event today. A review decision must retain its actual deciding admin. The audit migration cannot alter the original capturing account, reviewer exclusions, operation receipt, first receipt, accepted revision or contribution.

## Gaps without general audit writers

| Catalogue action or requested coverage | Present implementation | WO-core-11 obligation / boundary |
|---|---|---|
| `sale_received` | Original intake persists purchase/receipt, no audit call | Add once with first durable original intake, including its operation/actual executor; retry emits none |
| `sale_credited`, `sale_cancelled_unmatched`, `sale_held` | Writers exist under purchase.* aliases | Normalize new writes, preserve safe historical alias mapping |
| `batch_printed`, `batch_activated`, `export_prepared`, `export_requested` | Writers exist under batch_* aliases | Normalize new writes; aliases are not missing business events |
| `export_failed` | No audit on terminal render failure, expiry/exhaustion cleanup or blocked terminal failure | Exactly one fenced terminal event in the state-change transaction; transient retry is not terminal failure |
| `recovery_authorized`, `recovery_item_received`, `recovery_revoked` | No general audit writers; queue-recovery domain flow not yet implemented | Keep contract entries; require hooks when that flow is built. WO-core-11 must not invent the recovery flow to produce rows |
| `review_evidence_approved`, `review_evidence_configured`, `review_evidence_deactivated` | No runtime/helper/trigger audit insert. `scripts/ops/review-evidence.mjs` applies approval/configuration rows only | Add atomic operator events, system:operations, closed IDs and policy metadata; dry runs/rollbacks have none |
| `card_verification_issued`, `card_verification_verified` | `customers/recovery.ts` writes durable delivery/challenge and attempt state, no event call | Add issued at durable intent commit, verified only at successful verified transition; no duplicate on replay |
| `price_corrected` / meter evidence | Action dispatch slot exists, but current `meter()` returns meter_policy_unconfigured; no successful meter writer today | P-26 implementation must supply typed meter provenance projection with successful decision; WO-core-11 does not install/activate reconciliation |
| `price_cancelled` | Dispatch slot exists but active P-25 rejects this outcome | Retain action for historical/approved future implementations; no enablement or fabricated success |
| P-27 online price refresh | Read-only server/session/lookup projection and local draft adoption | No new action; augment activation event only, preserving captured originals |
| `assignment_ended` | Implemented five-field writer with operation and exact boundary | No missing action/field; apply common snapshots/privacy validation only |

This table exhausts canonical actions without an exact-name usable writer at the inspected revision. Every other action appears in the current-writer tables. M2's `verification_requested` is an email request, not card OTP issuance. Card replacement, challenge verification, policy approval and runtime activation are distinct facts. No settings-edit, campaign, giveaway, retention or export-of-audit writer is invented: those implementations and policies are outside this work order.

## Historical adapters

All existing rows project as schemaVersion=0, including recognized canonical names; new compliant rows use schemaVersion=1. Immutable historical data remains untouched. Verify station scope, target identity and each value independently. Drop prohibited keys before search/output. Never join current staff names, current price or current purchase state to fill an event-time gap. When a stable writer alias cannot be verified, use M3's empty `legacy_event` projection.

| Stored action/shape | Explicit historical mapping |
|---|---|
| Recognized canonical name with supported target | Same canonical action; typed safe subset only. Snapshot absence is null, not inferred from today's account |
| `purchase.cancelled` with reason customer_not_found | `sale_cancelled_unmatched`; state cancelled, credited false and zero contribution follow this terminal event; arbitrary cancellation reasons do not map |
| `purchase.credited` | `sale_credited`; validated IDs and immutable accepted outcome only; never infer current campaign totals |
| `purchase.held` | `sale_held`; proposed revisionId→candidateRevisionId; accepted revisionId null and credited false for this original-settlement writer |
| `batch_status_changed` | `batch_printed` only for generated→printed; `batch_activated` only for printed→active; invalid/unknown transitions use legacy_event |
| `batch_export_requested`, `batch_export_prepared` | `export_requested`, `export_prepared`; rename only typed export fields |
| Per-writer `version`, `status`, `format`, `cardCount`, `category` | Map only the source-specific fields shown above; never globally rename arbitrary JSON keys |
| `card_replaced` on card | Keep old-card target; customerId and replacementCardId→newCardId only when validated. Omit card codes; no current-card lookup |
| Historical `card_replaced` on customer | Preserve customer target under schemaVersion=0; safe typed IDs only. Never pretend the original event targeted a card |
| `reviewPolicy` | Select validated release/revision only; discard digest and any extra keys; safe conclusion tags/evaluation ID may survive |
| Unknown names, including resolver-recognized `card_linked`, `card_replacement`, `attendant_disabled`, `settings_changed`, `campaign_configured`, `settings_updated` without an explicit verified adapter | `legacy_event`; resolver vocabulary is not the public audit catalogue and proves no current writer |

Known system-executed aliases may use a fixed system service only when the writer semantics establish it (sync settlement/cancellation, export preparation). Preserve an existing event-time human snapshot when it records a human action; never recast an unknown user as system. A stored user ID without an immutable display snapshot cannot fabricate a full AuditActor; use null in historical projection. Protected provenance and raw immutable rows remain the authoritative historical record.

P-25's protected `domain_audit` evidence reader is separate from the public history serializer. New target/field normalization must update it compatibly: accept newCardId plus explicitly supported historical replacementCardId/replacedByCardId, use authoritative card/link history, and preserve exact price/assignment boundaries. Never feed a lossy public legacy projection into evidence evaluation or allow an unknown audit action to become sufficient proof. No alias mapping itself proves eligibility or clears a hold.

## Writer fixes handed to WO-core-11 / WHR-20

| ID | Fix | Required downstream verification (not executed implementation tests here) |
|---|---|---|
| AU-01 | Implement strict action-specific persistence and independent list/detail serializers; add schema version, station/correlation IDs and immutable safe actor/seller/target snapshots to all seven insert modules | Reject unknown fields/actions/targets/enum values before persistence; exact action-field matrix tests; later identity edits leave history unchanged; no raw JSON fallback |
| AU-02 | Normalize sync aliases, add sale_received, system executor attribution and faithful state/hold/block/contribution/candidate snapshots | Lost response/replay and rollback produce no duplicate/applied event; held original never displays accepted/credited; mixed holds and prior revisions stay intact |
| AU-03 | Add calculation mode, duplicate pair/flag shape and per-decision identity/outcomes/gates; preserve automatic correction attribution; project P-25/P-26 IDs/releases/revisions/tags without digests | Pair insertion/restart/clear/cancel races; three matching sales; pending/rejected correction retains spend; meter-before-date order retains candidate, basis and calculation; denied P-25 outcomes emit no success |
| AU-04 | Add card issue/verify events; replace printed card codes with IDs; add identityChangeId and old-card target semantics | Durable intent versus failed delivery, wrong/expired code, replay, phone/card changes, permission revocation, same-key conflict, atomic replacement rollback; no phone/code/HMAC in audit |
| AU-05 | Add transactional review-evidence approval/configuration/deactivation events to operator apply; keep protected authorization attribution outside audit | Activation writes two linked events; inactive writes one; higher revision/rollback, stale apply, dry run, database-identity mismatch and configuration-insert failure; no false admin actor or runtime-enabled claim |
| AU-06 | Normalize M2 batch/assignment/price fields; capture exact boundaries/operation metadata and immutable safe subjects; keep P-21's five changes | Precision-only activation, concurrent activation/lookup, initial/reassigned/end assignment and receipt replay; no refresh audit/repricing; old assignment opening stays unchanged |
| AU-07 | Normalize export request/prepared actions; system executor on worker completion; add fenced terminal export_failed on every terminal path | Crash/lease expiry/reclaim, render failure, retry exhaustion, revoked creator, configuration block and replay; one terminal event; no artifact URL/key/digest |
| AU-08 | Implement historical adapters and legacy_event, with station-scoped search over safe projected fields only | Canary phones/codes/digests/URLs/notes absent from list, detail, labels, search matches and logs; unknown actor/target handling; no current-state reconstruction or row rewrites |
| AU-09 | Preserve protected evidence-resolver compatibility while new card/price/assignment writers adopt canonical fields | P-25 works with historical and new row shapes; unrelated/foreign events fail; lossy public projection never supplies proof; boundary timestamps match authoritative records |
| AU-10 | Track unbuilt recovery hooks and P-26 meter projection as dependencies, not invented runtime scope | Tests and hooks land with their implementation work orders; audit history retains historical entries without claiming missing policy or recovery is active |

Rook should fold AU-01–AU-09 into WO-core-11's writer/query scope and record AU-10 dependencies. No follow-on is started here. The catalogue supersedes older conflicting public-audit field/target wording only; protected source records, approved policy semantics, M1/M2 error mappings and permissions remain unchanged. General audit work authorizes neither provider activation nor a new deployment.

## Verification record

Specification checks: exhaustive current writer/action comparison, exact field and alias tables, missing-writer classification, relative links and paragraph limit. Code/security/integrity verdicts and EM gates are recorded in the branch's `.review` file and WHR-130. No new runtime audit coverage, board parity, policy activation, export or retention behavior is claimed.

## P-29 / WHR-139 two-person release inventory amendment — 14 Nov 2026

This is an additive **specified writer gap**, not a claim that the historical inventory or current runtime already implements v2. The approved Q-557 principle and five pending recommendations are separated in [M3 P-29](m3.md#two-person-stuck-hold-release--p-29--wo-spec-3n--whr-139) and [the decision table](../proposals/evidence-policy.md#v2-recommendations-for-earl). No raw paper content enters general audit.

| Specified action / owner | Current source status | Required writer and projection |
|---|---|---|
| held_release_proposed / future core reviews | No proposal, sheet-purpose upload or writer exists | One event with pending proposal/content commit; proposer is actor. M3's closed proposal/target/outcome/sheet/proposer/policy fields only |
| held_release_approved / future core reviews | Existing reviews/service and audit contracts have no held_release kind or two-person provenance | Independent approver is actor; link immutable proposer event/decision, both actors in protected history. Atomically emit one approved event and V/G result, never a duplicate old-kind event or raw facts/reasons/digest |
| held_release_rejected / future core reviews | No writer exists | Independent rejector is actor, append transition and receipt once; keep underlying holds/values/credit. No fabricated sale_decision or approved conclusion |
| held_release_superseded / target-closing review/validation mutation | No supersession hook exists | system:validation, linked actual target-closing event; preserve proposer content and audit chain. Not a human rejection |
| review_evidence_approved/configured/deactivated / future v2 operator | Current operator and policy schemas recognize only v1 | Accept exact v2 release in unchanged closed operational shapes; immutable higher revision/approval, correct persisted database-comment scope identity; no dry-run event or automatic activation |

WO-core-11 / WHR-20 must extend strict action/field/filter serializers, Id links and safe v2 policy-release enum; it must not implement the missing release domain just to manufacture audit rows. Core release work supplies the atomic events and protected proposal/transition/review evaluation. `review_evaluation` retains full I/J distinction, source closure, v1 structural denial, both persons/reasons/times/photo, pin and guarded result; general audit contains only M3's allowlisted projections and fixed reasons. Unknown legacy rows cannot be promoted to sheet-attested conclusions. Audit-only access confers no sheet/facts access; per-kind sales permission remains required.

Readiness and preview invalidation require giveaway integration in the same activation package. Keep every proposal transition (including rejected/superseded) with retained meter/sheet assets under pilot keep-all policy; no new deletion writer/job is commissioned. Required downstream evidence is SR-01–SR-08 in M3; runtime coverage is not claimed by this spec.
