# Meter reconciliation — PROPOSAL

An admin would read the amount and quantity from the sale’s saved meter photo and record both exactly. The server would check that the pair makes sense at the historical price for the whole possible sale period, allowing only an approved display-rounding difference. If the checks pass, a new revision would replace the sale’s effective numbers and clear its price hold. Other holds could still prevent credit. Unreadable evidence, uncertain price history or unexplained differences would leave the sale held.

**PROPOSAL, not normative.** Revision 1, 11 November 2026. For Earl and Whales Energy under [WHR-112 / WO-spec-3j](https://linear.app/phaneum/issue/WHR-112), developing [WHR-50 Option A](https://linear.app/phaneum/issue/WHR-50). Merge and READY approve no tolerance, permission change or activation. [M3](../contracts/m3.md) remains unchanged; `correct_meter` retains `409 meter_policy_unconfigured`. The recommendations below need explicit decisions, a normative amendment and a separate implementation work order.

## What the admin would record

The admin would inspect this purchase’s retained, available, server-validated final photo at full size. They would transcribe the displayed money, quantity and unit without guessing hidden digits. Money would remain exact integer kobo with currency; quantity would remain an exact decimal string in litres or kilograms. Either or both effective values could change, but the submitted pair must differ from the latest guarded effective pair. Both values would be positive and within existing bounds and the captured product precision.

The reviewer would confirm that both readings belong to the same sale, rather than a cumulative totalizer, unit-price field or another transaction. The form would retain the validated asset ID, evidence references, notes and required reason under M3’s existing bounds. A partial, blurred or contradictory display would be insufficient. A digest or placeholder cannot replace inspectable bytes. Validation of the uploaded file establishes its integrity and binding; it does not independently establish that a human transcribed the display correctly.

The proposed result is an explicit `meter_evidence` revision. It retains the original entry basis, entered value, captured rate/version, precision, photo and attribution beside the new effective amount and quantity. Neither meter value would be calculated from the other. A visible or calculated amount/quantity ratio could help explain the check, but would never become a configured rate. This proposal does not add OCR, new uploads, photo replacement or a general evidence-admission endpoint.

## What must agree with history

Use the existing closed interval I=[L,U]. S is the original capturing sign-in, R the first durable receipt, and U=min(R, original offline expiry). L=max(S,T) only when this purchase has frozen valid P-23 lookup evidence; otherwise L=S. Recovery, new sign-in, retries, phone time, EXIF and an admin’s chosen date cannot replace those bounds. Missing or contradictory history, or L>U, would prevent reconciliation. Q-528 remains a separate client confirmation.

**Recommended temporal rule:** complete price history must show one exact station/product/currency/unit rate r throughout I. Different configuration versions with the same rate are acceptable; precision-only changes do not create a mismatch. The meter pair must pass the numerical check against that historical r. If rates differ anywhere in I, keep the price hold even if the pair fits one rate, or both rates within a generous tolerance. No averaging, majority-of-time rule, nearest-rate selection or convenient subset of history is proposed.

This is deliberately stricter than “matches any rate during I.” A photo can show a plausible sale value but cannot locate capture before or after a price activation. Treating a matching ratio as a timestamp would weaken P-25 without additional evidence. The proposed extension permits a different effective numeric pair when the historical rate is uniform; it does not extend P-25’s time evidence or change `accept_captured` and price-cancellation rules.

**Stale-phone example:** the phone retains ₦1,000.00/litre. Price history shows ₦1,100.00/litre from 10:00 onward, and trusted I is 10:05–10:20 on the same Lagos day. The original amount-led entry is ₦11,000.00 / 11.000 litres; the photo shows ₦11,000.00 / 10.000 litres. The new pair reconciles exactly against historical ₦1,100.00 and could release the price hold after approval and implementation. A later current price of ₦1,200.00 is irrelevant.

If I instead spans 09:55–10:20, the same photo would remain held because history includes both ₦1,000.00 and ₦1,100.00. An activation exactly at U is included and prevents uniformity when the earlier rate differs. An activation at L can establish the new rate throughout I. This proposal therefore resolves uniformly stale captures, not every stale-phone sale. An uncertain capture spanning activation needs separately approved stronger evidence; two people agreeing on the photo would not supply it.

## Tolerance options and worked examples

Let A be the exact displayed amount in naira, Q the exact displayed quantity, and r the historical naira-per-unit rate. The reconciliation residual is D=|A−rQ|, calculated exactly before monetary rounding. Comparing residuals avoids rounding the potentially repeating ratio A/Q. Equivalently, D/Q is the ratio’s deviation from r. Tolerance is an acceptance test, never permission to alter A, Q or r. Every example below is fictional; no illustrated threshold is an approved station setting.

| Option | Exact proposed test | Benefit and limitation |
|---|---|---|
| Exact rounded equality | A=roundHalfUp(rQ, 2 money decimals) | Simple and narrow, but can reject a valid pair when the meter’s quantity display has rounded hidden digits |
| Display-resolution allowance — recommended for approval | D ≤ r×sQ/2+sA/2 | Explains nearest-rounded displays: sQ is the measured quantity display step and sA the measured amount display step; grants no extra commercial discrepancy |
| Business discrepancy allowance | D ≤ min(C, max(F, p×rQ)) | Explicit absolute floor F, relative fraction p and absolute cap C; easier operational acceptance but permits differences beyond display rounding |

The display-resolution formula assumes both displays round a common underlying sale at the same rate to their nearest steps. Its inclusive boundary is conservative, not proof of the physical rounding algorithm. The client must validate that assumption on each supported meter profile. Truncating displays, independent meter calibration errors or unknown display behaviour need another reviewed rule; they cannot silently receive this allowance. Captured app precision is an input bound, not proof of the meter’s display step.

**Liquids:** at ₦1,100.00/litre, a photo shows ₦12,345.67 and 11.223 litres. Then rQ=₦12,345.30, D=₦0.37, and A/Q≈₦1,100.032968/litre (display only). Exact rounded equality fails. With verified sQ=0.001 litre and sA=₦0.01, the display allowance is ₦0.555, so the pair passes. Holding Q fixed, ₦12,345.85 gives D=₦0.55 and passes; ₦12,345.86 gives D=₦0.56 and fails. The comparison never rounds ₦0.555 to ₦0.56.

**Cooking gas:** at ₦1,500.00/kilogram, a photo shows ₦18,520.00 and 12.347 kilograms. Then rQ=₦18,520.50 and D=₦0.50. Exact rounded equality fails. With verified sQ=0.001 kilogram and sA=₦0.01, the allowance is ₦0.755, so the pair passes. At the same Q, ₦18,521.25 gives D=₦0.75 and passes, while ₦18,521.26 gives D=₦0.76 and fails. Litres and kilograms always use separate profiles and totals.

**Wider allowance comparison:** choose illustrative F=₦1.00, p=0.001 (0.1%) and C=₦10.00. For 10.000 litres at ₦1,100.00, expected amount is ₦11,000.00 and the allowance is min(₦10.00,max(₦1.00,₦11.00))=₦10.00. A photo of ₦11,008.00 passes this option but fails the ₦0.555 display allowance. For 2.000 kilograms at ₦1,500.00, the wider allowance is ₦3.00: ₦3,002.00 passes it but fails the ₦0.755 display allowance. These are material differences, not evidence that either meter is correct.

S04’s fictional ₦12,345.67 / 11.200 litres implies approximately ₦1,102.291964/litre. If history is uniformly ₦1,100.00, rQ=₦12,320.00 and D=₦25.67. It fails both the illustrated ₦0.555 display allowance and the capped ₦10.00 wider allowance. The board demonstrates independent editing, not an approved reconciliation threshold. Its apparent successful correction cannot establish that these particular numbers should pass production review.

## T-10 and precision

T-10 keeps half-up for positive halfway monetary rounding until D02 closes, in one shared constant. Ordinary quantity-mode calculation rounds once after multiplying exact quantity by its captured rate: 1.005 litres × ₦1.01/litre = ₦1.01505, yielding ₦1.02. An exact tie is 0.005 kilograms × ₦1.00/kilogram = ₦0.005, yielding ₦0.01. These examples explain arithmetic, not plausible station prices.

Meter reconciliation would preserve A and Q exactly as transcribed. It would not round one into agreement, calculate credited money from rounded quantity, round the residual, or round a threshold before comparison. With sQ=0.001 kilogram and sA=₦0.01, the exact-tie example has D=₦0.005 and allowance ₦0.0055; its displayed pair ₦0.01 / 0.005 kilograms passes. T-10 defines application arithmetic; it does not prove the physical meter uses half-up.

If the photo shows more quantity digits than captured precision permits, the reviewer would not truncate them or increase historical precision. Recommend leaving the hold unresolved and treating that meter profile as unsupported until a separate decision settles exact storage/input compatibility. Ordinary amount-mode history retains exact entered money and its originally derived quantity. P-22 remains numeric-only in the recorded basis; it does not authorize an attendant to edit an independent meter-evidence revision.

## Authority, limits and concurrency

Recommend one full, live admin with current `sales` AND `priceReview` permission for this narrow numerical decision, retaining the proposed Owner-only initial grant. `settings`, role name, `corrections`, recovery authority or a hidden button are not substitutes. Existing station scope, non-disclosing object checks, Origin/CSRF, evidence-read authorization and permission revocation checks would apply. Delegation remains limited by I-10; no new role or permission is implied by this proposal.

A second reader could reduce transcription mistakes but cannot prove capture time or cure a rate mismatch. Recommend no mandatory second person for the constrained first release. The alternative would require two distinct live authorized admins approving the identical immutable values, asset, policy and guarded revision; any edit invalidates the first approval. That needs a separate reviewed workflow, rejection/expiry rules and staffing agreement. Q-557’s broader physical-world attestation path stays undecided and is not implemented through this proposal.

The reviewer could not change rate, price history, original basis, product, pump, customer, card, seller, medium, photo or capture bounds. They could not substitute today’s price, clear another hold, waive a deadline, approve an outstanding correction or cancel merely because reconciliation failed. P-19’s independent recovered-correction review would remain separate, excluding its executor and grant authorizer. Price review cannot bypass that restriction or copy an unapproved proposal into effective values.

The server would compare M3’s SaleGuard and expected hold version before committing. A newer accepted correction or resolution makes a stale form conflict, with no decision or credit change. A fresh review must inspect the latest effective candidate and explicitly assess the same photo again; it cannot blindly replace version fields or restore original amounts. Concurrent reviewers and duplicate submissions must produce at most one successful resolution and one accepted contribution.

The decision, immutable operation receipt, revision, provenance, targeted hold resolution, audit and contribution result would commit together under current security, purchase and policy locks. Same-key replay would check current authority and return its historical result; changed content would conflict. Other holds and validation gates still run. With no accepted revision, the meter pair remains a durable candidate until all gates pass; subsequent date/card/capture decisions preserve it. Finalized snapshots remain immutable, with later changes flagged for reconciliation.

## Failure and provenance

Recommend preserving M3’s existing error vocabulary: absent, inactive or unsupported meter policy gives `409 meter_policy_unconfigured`; invalid/nonpositive/over-precision inputs give the existing input/calculation error; unchanged pairs give `409 no_change`. Unreadable or inconsistent evidence, nonuniform rates or an out-of-tolerance pair give `422 evidence_insufficient`. Unavailable required bytes give `422 evidence_unavailable`; transient storage failure remains `503 temporarily_unavailable`. Existing version, closed-review and permission errors remain intact. Every failed attempt leaves the hold, candidate and contribution unchanged.

The immutable protected evaluation would record purchase/decision IDs, original and evaluated revision IDs, purchase/hold versions, actor, trusted decision time, reason, exact before/after pairs and selected photo ID/digest. It would retain I and its source facts, complete resolved history IDs/versions, historical rate coverage, policy release/digest/configuration revision, meter-profile identity, display steps, exact residual and allowance, conclusion and remaining gates. A human transcription would be labelled as such, without claiming machine recognition or new time evidence.

P-25’s closed resolver registry and bounded, acyclic same-sale provenance would remain the evidence foundation. Referenced histories must derive from original scope, not caller-selected convenient records. A prior approval never becomes an independent witness. Store sensitive notes and evidence details in protected domain storage; general audit uses allowlisted IDs and categorical results. No raw tokens, signed URLs, object paths, photo bytes or unrestricted notes enter logs, health or attendant projections. Existing private-photo access and retention protections remain unchanged.

## Configuration and the existing meter flag

Suggested future release name: `meter-reconciliation-v1`, with immutable reviewed artifact bytes and digest. An approved release would fix the temporal rule, tolerance formula, rounding treatment, precision behaviour and allowed outcomes. Server-only configuration would bind a positive revision, station/environment, supported product/pump meter profiles, exact display steps, release/digest and immutable activation approval. Historical profile applicability must be recorded; a current replacement meter’s settings cannot be applied to an older photo. No arbitrary predicates, scripts or per-sale override are proposed.

Recommend explicit measured profiles for every supported pump/product and quantity precision, with positive exact steps representable under existing types. Missing, malformed, unsupported, unapproved, scope-mismatched or inactive configurations would fail closed, without hidden thresholds or inherited current-price settings. A normative follow-up would specify strict schemas, numeric limits and the relationship to the installed P-25 resolver release before implementation. A valid configuration record alone would not constitute approval or supply absent historical evidence.

Changing a rule or profile meaning would require a new approved immutable release/configuration snapshot. Activation, deactivation and rollback would create higher audited configuration revisions. New decisions would pin and recheck policy and history generations through commit; policy deactivation cannot race acceptance. Replay would preserve the original result rather than reevaluate it. New configuration would not silently release old holds, rewrite accepted revisions or reprice history. Production activation still requires Earl’s separate deployment authorization.

Reuse existing protected `policies.meter`; add no health name. Recommend `configured` only when the approved active evaluator and valid scoped profiles cover the deployment’s supported pumps/products, with required resolver dependencies available. Any coverage gap would report `unconfigured`; health would inspect configuration, never a sale or photo. This does not mean every sale can reconcile. A sale with unavailable evidence remains unresolved even when the policy is configured.

Only a full live admin with current `settings` permission can see individual policy statuses. Public callers retain the aggregate `fullyConfigured` and existing probe fields. No threshold, profile, version, policy digest or failure detail would be exposed. `reviewEvidence` remains separate: its configured state does not enable `correct_meter`. Approval, specification merge and health output grant no operational authority. Until separately implemented and activated, `meter` remains unconfigured and the existing endpoint gate stays closed.

## Register-ready decisions

Owner: Earl and Whales Energy; Rook can copy these questions into the client register. All defaults below apply from **11 November 2026 until explicit approval**, with no timeout-based consent. They are proposal defaults only: meter reconciliation remains disabled. Q-528/Q-556 confirmations and Q-557’s broader attestation question remain separate. WHR-50 stays open; this document supplies decision material rather than settling it.

### MR-1 — Which historical price can justify release?

[WHR-118](https://linear.app/phaneum/issue/WHR-118) · needs:human

**Question:** Must one rate apply throughout I? **Option A:** require a uniform historical rate, then reconcile the photo pair. **Option B:** permit a pair matching any rate during I to clear the hold. **Recommend A:** B treats numeric compatibility as unproved timing and would revisit P-25. **Default:** retain the gate; use A only as the proposed design. Explain to the client that activation-spanning sales remain held, even with clear photos.

### MR-2 — How much mismatch is acceptable?

[WHR-119](https://linear.app/phaneum/issue/WHR-119) · needs:human

**Question:** May tolerance cover only verified display rounding, or also business discrepancies? **Option A:** approve measured nearest-display steps and D≤r×sQ/2+sA/2, with unsupported precision/rounding profiles left held. **Option B:** approve explicit F/p/C business allowances after agreeing acceptable over/understatement. **Recommend A:** test representative meter displays before selecting any steps; no illustrated values become defaults. **Default:** no configured tolerance and no meter release. Exact rounded equality remains a stricter comparison option if the client prefers rejecting display discrepancies.

### MR-3 — What rounding convention should the application retain?

[WHR-120](https://linear.app/phaneum/issue/WHR-120) · needs:human

**Question:** Retain T-10 half-up for application monetary ties? **Option A:** retain half-up once for ordinary quantity calculations, while exact meter fields/residuals are never rounded into agreement. **Option B:** commission a different explicit tie convention after meter validation, with a separate versioned amendment and no historical recomputation. **Recommend A:** it preserves the current technical convention without claiming the meter behaves identically. **Default:** T-10 remains unchanged; no physical-meter assumption or activation follows.

### MR-4 — Is one authorized reviewer enough?

[WHR-121](https://linear.app/phaneum/issue/WHR-121) · needs:human

**Question:** Should exact meter transcription require a second authorized person? **Option A:** one `sales` AND `priceReview` admin, with Owner-only initial allocation proposed and full audit. **Option B:** two distinct authorized admins bound to identical immutable inputs, with edits requiring fresh approvals. **Recommend A:** keep this bounded MVP review operable; retain all existing P-19 restrictions. **Default:** no new two-person authority or workflow; meter release stays disabled. This decision does not answer Q-557 or permit attested capture times.

### MR-5 — How should profiles and activation be controlled?

[WHR-122](https://linear.app/phaneum/issue/WHR-122) · needs:human

**Question:** Must meter policy use explicitly approved historical profiles? **Option A:** versioned server-only releases and measured pump/product profiles with recorded approval, fail-closed coverage and protected `meter` status. **Option B:** introduce a manager-editable tolerance/profile screen with separately specified permissions, bounds, approval and audit. **Recommend A:** avoid discretionary per-sale relaxation; measurements and deployment authority remain explicit. **Default:** no profile assumptions, new settings endpoint or activation; follow-up specification and implementation require separate work orders.

## Verification required before any future activation

These are proposed downstream cases, not implemented tests or claimed coverage:

- Reproduce every exact amount, residual and boundary above using integer/rational arithmetic, including one kobo outside each allowance; never use a displayed ratio as the decision input.
- Exercise uniform old/new rates, same-rate precision versions, changes at L and U, missing history, and crossing rates that both happen to fit tolerance. Only the uniform supported case can reconcile.
- Check blurred/foreign/missing/deleted photos, wrong units, hidden digits, unsupported display rounding/precision and totalizer-versus-sale confusion. Human transcription assurance needs the client’s meter pilot as well as software tests.
- Race corrections, other hold decisions, permission revocation, profile changes and deactivation against confirmation. Test replay and changed-content conflicts; assert one accepted contribution and unchanged originals/snapshots.
- Exercise all hold-resolution orders, retained meter candidates, P-19 exclusions, ordinary P-22 denial on meter-evidence bases, and remaining campaign/deadline gates.
- Validate profile/history provenance, strict configuration failures, deployment coverage, protected health redaction and unchanged `reviewEvidence` behaviour. No prototype success or policy flag substitutes for these checks.

## Sources and design boundary

Read with [M3 price decisions and P-25](../contracts/m3.md#duplicate-and-independent-hold-decisions--s02s07), [historical evidence proposal](evidence-policy.md), [M1 P-23](../contracts/m1.md#signed-lookup-lower-bound--p-23-wo-spec-3d-whr-91), [P-22/P-25/T-10](../decisions/INDEX.md), [invariants](../invariants.md) and [operations health](../contracts/operations.md#get-apihealth). Product inputs inspected read-only: TRD “Price-resolution implementation boundary” and “Calculation implementation refinement”; Admin Sales Screen Decisions; S04-PriceCorrection HTML and PNG. No product-document content or real meter/customer data is copied into this proposal.

S04 establishes independent entry, retained originals, required reason and inspectable evidence; its fixture precision, amounts and simulated totals are illustrative. Current M3/P-25 controls historical proof, independent holds and zero credit while other gates remain. The numerical example’s reconciliation failure and the board’s unconditional contribution wording are recorded design limitations for a future build brief. This proposal changes no board, contract, data model, permission or runtime code.
