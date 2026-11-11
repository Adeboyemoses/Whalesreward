# Evidence admissibility — approved proposal (historical)

**Status: approved; superseded by m3.md.** Earl chose Option A for EP-1–EP-5 on 11 November 2026 (WHR-105–WHR-109). [WO-spec-3i / WHR-110](https://linear.app/phaneum/issue/WHR-110) makes [M3 review-evidence-v1](../contracts/m3.md#duplicate-and-independent-hold-decisions--s02s07) normative and records P-25. Client confirmation remains pending in Q-556; Q-528 remains separate. Q-557 is undecided and adds no two-person path. Runtime implementation and activation remain separate from specification approval.

The revision-1 text below is preserved as proposal history. Its future-tense recommendations and former defaults are superseded by M3; they are not competing rules or evidence that Earl's decision is still pending.

## For Earl and the client

- Let an admin decide only from facts the server can check and connect to this sale. A written explanation remains necessary, but is not proof.
- A stored photo can show meter readings. It does not, by itself, prove the sale date, the customer or the attendant's authority at capture.
- Use the existing earliest/latest possible capture times. Accept a conclusion only when it is true throughout that interval; never choose a convenient instant.
- Some reviews will remain unresolved. In particular, this first policy cannot rescue an interval that crosses a price, replacement, assignment or campaign boundary without stronger, separately approved evidence.
- This is a proposal for approval, not a rule change. Merging it enables no decisions, changes no balances and does not settle the separate meter-correction policy.

## Status and authority

Proposal revision 1, 11 November 2026. Part of [WHR-103 / WO-spec-3h](https://linear.app/phaneum/issue/WHR-103). Suggested future policy identity: `review-evidence-v1`. No version is approved or active through this document. The recommendations below describe a possible evaluator, not existing functionality or permission to deploy it.

The current [M3 contract](../contracts/m3.md#duplicate-and-independent-hold-decisions--s02s07) remains normative and unchanged. Unknown or insufficient review evidence continues to return `422 evidence_insufficient`, preserving holds, blocks and contribution. [WHR-50](https://linear.app/phaneum/issue/WHR-50) still gates `correct_meter` with `409 meter_policy_unconfigured`. Earl's later approval would commission a normative amendment and a separate core implementation work order; neither follows automatically from READY or merge.

Sources: M3 review/evidence and decision guards; [M1 P-23](../contracts/m1.md#signed-lookup-lower-bound--p-23-wo-spec-3d-whr-91); [P-19–P-24](../decisions/INDEX.md); [health contract](../contracts/operations.md#get-apihealth); invariants I-05a, I-07, I-22, I-25–I-28, I-31, I-33–I-35, I-41, I-45a–I-46 and I-48. Product inputs are F&R F04/F05 and confirmed price/card/date reviews, the corresponding TRD refinements, and Admin Sales Screen Decisions. Board placeholders and simulated approvals establish no evidence. Q-528's client confirmation remains pending.

## Shared admission rules

Keep M3's `ReviewEvidence={assetId,notes,referenceIds}` and maximum 20 reference IDs. Proposed reference names below are internal resolver categories, not new request fields or arbitrary table identifiers. The server resolves each opaque ID through a closed registry, checks its type and provenance, and derives the conclusion itself. The selected asset must be this purchase's retained, server-validated final photo. Notes explain the decision; they never fill a missing fact.

Admission would require an immutable source, trusted recording time, original purchase/context binding, relevant station/product/account/card scope, and complete historical coverage. Shared price or campaign records need not belong exclusively to one purchase, but their applicability must be derived from this purchase's original context. Reject unrelated, ambiguous, unsupported or contradictory references without disclosing another record's existence. User-supplied IDs confer no read or decision authority.

| Reference category | What it can prove | What it cannot prove |
|---|---|---|
| Original purchase and first-receipt record | Submitted original values, identities and immutable first durable receipt R | That a client field was true, or that receipt equals capture |
| Capturing context | Original sign-in S, original expiry, account/station/pump context | Continuous authorization after assignment ending or revocation |
| Frozen successful P-23 verification | Bound server lookup time T and historical card/customer link; composition lower bound under P-23's app-integrity assumption | Exact capture, present card validity or upload authority |
| Price activation/configuration history | Exact rate, product, currency and effective interval; captured precision version | Which side of an activation a sale occupies without capture bounds; meter correctness |
| Card link/replacement history | Historical customer, old-card linkage and trusted replacement time E | Physical card possession or when the sale occurred |
| Assignment/revocation history | Who was authorized for this pump/product during each interval | Capture at any particular instant; current assignment cannot repair history |
| Campaign configuration history | Applicable period, timezone, deadline and version | A sale's date, or a deadline extension |
| Allowlisted domain audit event | The server action, actor, target and trusted event time, cross-checked against its authoritative record | Truth of free text or client fields stored in the event |
| Validated purchase photo | Immutable validated bytes/digest, purchase binding and inspectable visible content | Authentic time, historical authorization or customer identity; digest alone cannot show readings |
| Previously admitted derived evidence | Only a typed conclusion already supported by traceable allowed source records for this purchase | New facts, stronger precision or proof merely because an admin once approved it |

The last category is deliberately narrow. A derived record would retain its source IDs, policy version, asserted fact type and precision, evaluated interval and purchase/revision binding. Every dependency must terminate in the allowed original server facts. No self-reference, dependency cycle, unrelated sale or decision citing itself is admissible. A prior decision is not an independent witness. Legacy decisions without reproducible provenance provide history only. This proposal creates no general evidence-admission endpoint or discretionary admission permission.

V1 would admit no new physical-world time observation. An external receipt transcribed into an audit note stays an assertion. A photo's printed timestamp, EXIF time, phone clock, UUID time, upload completion time or an admin-selected date cannot narrow capture. Previously admitted evidence may reuse valid original conclusions, but cannot manufacture stronger bounds. Missing source history or inconsistent bounds means insufficient evidence, not permission to infer an answer.

### Capture interval used by every kind

Use closed interval I=[L,U]: S is the original capturing sign-in, R the first durable receipt, and U=min(R, original offline expiry). L=max(S,T) only with this purchase's frozen, valid P-23 verification; otherwise L=S. Preserve the original facts through recovery, reauthentication and retries. A newly supplied or freshly reverified lookup token cannot narrow an old purchase retrospectively. Missing P-23 evidence falls back to S under M1; it is not evidence of an invalid sale.

Evaluate every instant, including events at either endpoint. Missing history, L>U or conflicting records prevents a sufficient conclusion. Price-only precision changes create no mismatch. A valid date resolution records a day separately; it does not narrow I for price, card or authorization decisions. Existing settled rules retain their own meanings: receipt decides upload deadlines and correction midnight, while capture evidence decides purchase-period eligibility. Nothing here changes automatic validation for an ordinary sale.

### Common minimum and transaction boundary

Every sufficient combination below includes the original purchase, its capture-context/receipt facts, the selected available validated photo, complete applicable histories and an authorized reasoned decision. Reusing a derived reference requires its full source closure; reference count or a nonempty note is never a threshold. If required source content or photo bytes are unavailable, do not substitute a digest or placeholder. Distinguish unavailability from insufficient proof using existing M3 errors.

Current full admin authority, `sales` plus the kind's permission, maker restrictions, SaleGuard, hold/block versions and replay rules remain mandatory. Evaluate against one consistent policy/history snapshot and recheck authority and relevant versions through commit. The immutable decision, evidence conclusions, audit, targeted resolution and contribution result commit together. A successful decision can still have `credited=false`. It clears only its permitted target; all other gates rerun against the latest guarded candidate. Never restore old amounts over an accepted correction or rewrite finalized snapshots.

## Price decisions

**Admissible references:** the common minimum plus captured price/version and precision, complete station/product price activation history, and corresponding allowlisted activation audits. Frozen P-23 verification may establish L. These prove what rate applied throughout I. The photo supplies visible corroboration; it does not establish temporal price validity. A prior admitted rate conclusion is reusable only with the same underlying history, scope and precision.

**Minimum for `accept_captured`:** the captured rate equals the applicable historical rate at every instant in I, with complete consistent history and no newer effective numeric revision that would be overwritten. Preserve captured exact values and settings; a version change affecting precision alone is not a price mismatch. This establishes temporal rate validity only. It does not authorize independent meter reconciliation or clear capture/card/date conditions. A review can confirm an open hold only through the authorized decision, never automatic reevaluation.

**Cancellation and correction limit:** v1 proposes no sufficient price-only cancellation recipe. A price mismatch proves a pricing problem, not necessarily an invalid underlying sale. The admissible sources above cannot settle arbitrary visual disputes. Leave `cancel` unavailable for this kind until a separately approved invalidity criterion exists; this limits evidence sufficiency, not M3's outcome enum. `correct_meter` remains entirely subject to WHR-50, including amount/quantity reconciliation. Neither a readable photo nor approval of this proposal activates that outcome.

**Insufficient examples:** today's price plus yesterday's phone time; a screenshot of a rate sheet; a known price version with no effective-time history; I crossing an activation with different rates; photo plus “I remember charging the old rate”; an older captured revision that would overwrite a newer accepted correction. A uniformly different historical rate also cannot justify `accept_captured`, and is not by itself grounds for cancellation under v1.

## Replaced-card decisions

**Admissible references:** the common minimum plus immutable old-card/customer linkage history, the exact replacement event and its domain audit. These prove who historically owned that card and when replacement disabled it. P-23 can support the original lower bound and link identity; it does not waive replacement review. Current new-card ownership, an OTP record or the replacement actor's statement cannot establish when this purchase happened.

**Minimum for `confirm_earlier`:** linkage to the same historical customer is valid throughout I, and U<E, strictly before replacement. Verify that E is the replacement responsible for this hold and occurred at/before R. Preserve the old card, customer and original attribution; never attach the sale to a replacement card or reactivate the retired card. This resolves card eligibility only; the other checks for a valid purchase remain independent.

**Minimum for `cancel`:** the same bound old card and trusted replacement event, with L>=E, establish that every possible capture was after that card ceased being usable. This proposed invalidity criterion needs client approval below. An interval spanning E proves neither valid earlier use nor uniformly invalid later use. Other retirement reasons are excluded under WHR-39. Equality at U=E is insufficient for earlier confirmation; without L>=E it is also insufficient for cancellation.

**Insufficient examples:** replacement time plus a photo with a handwritten date; current “retired” status without historical linkage; “the customer confirms it”; an OTP proving present phone control; a receipt for another card/context; I from 09:00 to 11:00 with replacement at 10:00. A lookup before replacement alone gives no upper bound before E. Ambiguity leaves the hold and zero credit unchanged.

## Date decisions

**Admissible references:** the common minimum, approved station timezone, and the resulting original interval; a traceable prior same-purchase date conclusion may corroborate only its calendar-day precision. Sign-in and receipt establish bounds, not alternative sale dates. Campaign history explains how a date affects eligibility but cannot prove the date. Photo content and audit notes cannot supply an otherwise missing day.

**Minimum for `verify_date`:** every instant of I falls on the same real Africa/Lagos calendar day D, using the configured station-timezone rule; the submitted day equals D and D is no later than R's Lagos day. Store D separately from the original timestamp and receipt. Preserve effective numeric values and clear only the date hold. This does not establish a within-day instant, historical assignment, campaign eligibility, upload timeliness or a renewed correction window.

**Insufficient examples:** R's day alone; admin confidence plus a photo; a device date earlier than receipt; I crossing Lagos midnight; a verified day used to resolve an intraday campaign cutoff. A date from a prior decision with no allowed source chain is insufficient. V1 has no new source that resolves a genuinely multi-day interval and no date-cancellation outcome. Such records stay held; uncertainty is not invalidity.

## Capture decisions

**Admissible references:** the common minimum plus complete original assignment/revocation history and applicable versioned campaign history. P-23 and traceable prior derived facts may support only their original scope. Assignment events establish authorization intervals; campaign events establish eligibility boundaries. Neither proves a capture instant. A photo, verified calendar day or new online session cannot repair an old uncertain assignment or narrow an intraday boundary.

**Minimum for `confirm`:** establish a sufficient answer for every open capture block together. For `capture_authorization_unresolved`, the original account/context must be authorized for the recorded station/pump/product at every instant in I, accounting for assignment ending and revocation. For `capture_time_unresolved`, every instant must give the same campaign membership answer under the applicable configuration. Missing campaign configuration cannot establish that answer. Record each evaluated conclusion without inventing an exact timestamp.

Uniformly outside the campaign is a resolved timing answer, not campaign eligibility. Confirm can resolve that block while campaign contribution remains excluded. If both blocks are open, evidence sufficient for only one cannot partially confirm. Existing P-19 independence rules remain in force; capture review is not correction approval. These combinations can settle an open review whose uncertainty is resolved by admissible existing facts, but do not promise rescue of an interval that still crosses a material boundary.

**Minimum for `cancel`:** complete assignment/revocation history proves the originating account/context was unauthorized for the recorded pump/product at every instant in I. This proposed invalidity criterion also needs client approval. A partly authorized interval stays unresolved. A uniformly outside-campaign sale is not an invalid sale and cannot be cancelled for that reason. Cancellation terminally closes original validation blocks with its own decision reference; it never records them as confirmed.

**Insufficient examples:** current pump assignment; a manager's note asserting an earlier shift; a recovery grant; a fresh login after expiry; one resolved block with another unknown; I crossing a revocation or campaign boundary; missing campaign settings; an admitted calendar day used as an exact time. No safe inference follows from the mere absence of a contradictory audit entry. Incomplete history cannot prove uniform authorization or uniform invalidity.

## Versioning, configuration and health

Proposed configuration identifies an immutable policy release (`review-evidence-v1`), its content digest, a positive configuration revision, station/environment scope, activation state and approved activation reference. It maps supported kinds/outcomes to fixed server evaluators, not client predicates, scripts or arbitrary reference types. Reject malformed, unknown, unsupported or inactive releases. An entry in configuration alone is not approval. The normative amendment would define the exact strict schema before implementation.

Persist the policy release/digest, configuration revision, evaluated kind/outcome, source record IDs/versions, capture bounds, typed conclusions and remaining conditions with each successful decision. Keep sensitive evidence/provenance in protected domain storage; general audit carries only allowlisted IDs, policy identity and categorical conclusions. Never store raw lookup tokens, signed URLs, object paths or unrestricted notes in audit. No evidence decision or policy change grants broader photo, identity or history access.

Changing an admissibility rule creates a new immutable release; changing deployment activation creates a new audited configuration revision. Pin the active snapshot for a decision and check it remains current at commit, so deactivation cannot race acceptance. Same-operation replay returns the immutable original result after current authority checks; it never reinterprets evidence under a newer policy. A new decision uses current policy and current guards. Preserve old policy definitions and provenance for audit. Upgrade, rollback or deactivation never silently reevaluates sales, clears holds or rewrites snapshots.

**Proposed health name: `reviewEvidence`.** Add it later to the protected closed allowlist in [operations](../contracts/operations.md#get-apihealth), making twelve names after `duplicateWindow`. Do not reuse `meter`, `timing` or `reconciliation`: they govern different decisions. One status is appropriate because this proposal activates one inseparable four-kind release. If partial activation is later desired, it needs a new reviewed contract rather than misleadingly marking the aggregate configured.

`configured` would mean an approved active release and valid configuration plus all four installed evaluators, including explicit deny behavior for unsupported outcomes such as price cancellation. It does not mean every outcome is enabled or every sale has sufficient evidence. Missing/malformed/inactive/unsupported policy or evaluator returns `unconfigured`; fullyConfigured includes this status. WHR-50 remains independently represented by `meter`. Health checks no purchase, photo, external source or provider and causes no writes.

Use the existing public `{ok,version,db,fullyConfigured}` projection. Only a full live admin with current `settings` permission sees `policies.reviewEvidence`, as `configured|unconfigured`. Expose no policy versions, reference types, thresholds, source IDs, reasons or configuration values. Preserve no-store, Vary: Cookie, database-probe HTTP meanings and authority fallback. Approval of this document changes neither the allowlist nor runtime health; the later normative and implementation work must add them together.

## Explicit exclusions and activation sequence

- Notes-only proof, client booleans/assertions, device/UUID/EXIF timestamps, photo timestamps and unverified lookup receipts.
- Arbitrary external URLs, object paths, uploads, replacement photos, scans or transcribed external documents. No new upload or admission flow.
- WHR-50 independent meter interpretation/reconciliation, numerical tolerances and `correct_meter` activation; P-22 ordinary correction scope remains separate.
- WHR-39 other retirement reasons, identity recovery/OTP policy, new permissions, photo-retention changes, retrospective date-amendment endpoints and routine approval of ordinary sales.
- New physical-world time evidence, silent narrowing of I, automatic historical reevaluation, policy activation, migrations, app code, m3.md changes and production/cloud actions.

Recommended sequence: Earl and the client answer the questions; Rook commissions the normative amendment with exact resolver/configuration schemas and accepted outcomes; independent reviewers approve it; a separate authorized core work order implements evaluator and protected health together. Before any activation, verify per-kind positive and negative combinations, boundary equality, incomplete/contradictory histories, same-sale binding, circular evidence rejection, permission revocation, stale guards, replay across policy versions, policy deactivation races and mixed holds. Existing production denials remain until that reviewed activation is expressly authorized.

## Register-ready questions for Rook

These are proposed choices, not approval records. Owner: Earl and Whales Energy; Rook records the answers. Default from **11 November 2026 until explicit approval**: retain current runtime denials, unresolved holds and zero credit. Silence or a target date never activates policy. Existing Q-528 remains the upstream app-integrity/capture-bound confirmation; these questions do not replace it.

### EP-1 — Scope of acceptable proof

Register issue: [WHR-109](https://linear.app/phaneum/issue/WHR-109).

**Question:** May the first review policy use only the server records and traceable derived facts listed here, accepting that genuinely ambiguous cases stay held?

- **Option A:** Approve that closed reference set; any new physical-world evidence source needs a later reviewed policy and admission flow.
- **Option B:** Defer the review evaluator until the client specifies additional independent evidence sources and their verification process.
- **Recommend:** A. It gives a checkable boundary without treating saved notes as proof.
- **Default:** B for runtime activation; draft A only. Applies from 11 November 2026 until explicit approval.

### EP-2 — Price outcomes

Register issue: [WHR-105](https://linear.app/phaneum/issue/WHR-105).

**Question:** May the first price evaluator confirm captured values only when the captured rate is valid throughout I, while leaving price cancellation and WHR-50 meter correction unavailable?

- **Option A:** Approve this limited sufficient combination; uncertain or uniformly mismatched rates remain held.
- **Option B:** Defer price decisions until invalidity and independent meter-reconciliation criteria are also approved.
- **Recommend:** A. Do not equate a price mismatch with proof that no valid sale occurred.
- **Default:** B; current evidence denials and WHR-50 gate remain. Applies from 11 November 2026 until explicit approval.

### EP-3 — Replaced-card outcomes

Register issue: [WHR-106](https://linear.app/phaneum/issue/WHR-106).

**Question:** May the evaluator confirm only when the entire capture interval precedes replacement, and cancel only when the entire interval is at/after replacement for the same old card?

- **Option A:** Approve those two criteria, retaining review for any interval spanning replacement and excluding other retirement reasons.
- **Option B:** Permit only earlier confirmation; keep cancellation unavailable until a separate invalidity policy is agreed.
- **Recommend:** A, with complete linkage/replacement history and all other gates preserved.
- **Default:** Neither outcome activates; existing holds remain. Applies from 11 November 2026 until explicit approval.

### EP-4 — Calendar-day verification

Register issue: [WHR-107](https://linear.app/phaneum/issue/WHR-107).

**Question:** May a single Lagos day containing the entire trusted capture interval be sufficient to verify that sale date, without claiming an exact time?

- **Option A:** Approve same-day interval proof; leave multi-day intervals and within-day questions unresolved.
- **Option B:** Require a separately approved independent dated evidence source even for a single-day interval.
- **Recommend:** A, subject to the existing Q-528 confirmation. Keep the verified day separate from original time and receipt.
- **Default:** No date decision activates. Applies from 11 November 2026 until explicit approval.

### EP-5 — Capture authorization and timing

Register issue: [WHR-108](https://linear.app/phaneum/issue/WHR-108).

**Question:** May capture review use complete history over I to confirm uniform authorization and campaign answers, and cancel only uniformly unauthorized capture?

- **Option A:** Approve these criteria for every open capture block together; outside-campaign alone excludes campaign credit and never justifies cancellation.
- **Option B:** Allow confirmation only; defer capture cancellation until a separate invalidity policy is approved.
- **Recommend:** A, preserving Q-528, P-19 independence and every other hold.
- **Default:** No capture decision activates; unresolved blocks retain zero credit. Applies from 11 November 2026 until explicit approval.
