# Two-person release of a stuck hold

WHR-157 / WO-app-8b-brief · 16 Nov 2026 · proposed screen brief for Rook review and Earl approval. Merging this brief does not approve the screens, commission their build or activate v2. Rook drafts the build work order after approval. No product code or routes are added here.

## Authority and references

Read with [M3 P-29](../engineering/contracts/m3.md#two-person-stuck-hold-release--p-29--wo-spec-3n--whr-139), including both App rows in its downstream table. Its older “awaiting confirmation” wording is superseded for the five choices by Earl's **Option A decisions, 14 Nov**, on [WHR-144](https://linear.app/phaneum/issue/WHR-144), [WHR-145](https://linear.app/phaneum/issue/WHR-145), [WHR-146](https://linear.app/phaneum/issue/WHR-146), [WHR-147](https://linear.app/phaneum/issue/WHR-147) and [WHR-148](https://linear.app/phaneum/issue/WHR-148). Those decisions do not authorize runtime activation.

Server source of truth: [WHR-153, PR #148](https://github.com/Adeboyemoses/Whalesreward/pull/148), branch `core/WHR-153-stuck-hold`, inspected at `a673238c601845842eab7a1f5e3e8fab86d0e7d3` (open). In particular: `src/shared/contracts/held-release.ts`, release HTTP handlers, service, uploads, authority and integration hooks. Recheck its merged head before building. WHR-155's amended scope leaves the installation gate unconfigured until WO-core-12 supplies the real giveaway integration; P-26 meter remains unconfigured under v2 pending a reviewed compatible release. The ordinary v1 path remains available under its existing rules.

Visual references inspected: built captures and components from [PR #116](https://github.com/Adeboyemoses/Whalesreward/pull/116) and [PR #137](https://github.com/Adeboyemoses/Whalesreward/pull/137), [exception-review brief](../briefs/admin-row-05-exception-reviews.md), [meter-correction brief](../briefs/admin-row-05-meter-correction.md), [A14 brief](../briefs/attendant-row-03-held-review.md), and their [review](../../tests/design-parity/reviews/REPORT.md) / [meter](../../tests/design-parity/meter-correction/REPORT.md) fidelity reports. Reuse S02's comparison hierarchy, S03/S06/S07's original/evidence/reason sheets, S04's review then confirm, S09's receipt followed by refreshed current status, and A14's result/summary/reassurance. The supplied inventory has S02, S03, S04, S06, S07 and S09; there is no S05 board to invent.

### Existing server route mapping

All paths below are relative to `/api/admin/sales/:purchaseId`. Use PR #148's strict schemas and `{data,serverTime,requestId}` / error envelopes. These server routes are distinct from the proposed screen states; this brief adds neither. There is no admission preview, global release queue or manual supersede endpoint.

| Method / suffix | Use and exact request shape |
| --- | --- |
| POST `/release-sheet-uploads` | Reserve: `{operationId,target,sha256,bytes,contentType:'image/jpeg'}`; 201 or replay 200 `{uploadId,assetId}`. Reservation expires after 15 minutes. |
| POST `/release-sheet-uploads/:uploadId/upload-url` | `{}`; `{url,expiresAt,assetId,maxBytes}`. PUT bytes directly to the reservation, never the JSON endpoint. URL lasts no more than five minutes or remaining reservation time. |
| POST `/release-sheet-uploads/:uploadId/finalize` | `{operationId}`; `{assetId,state:'validated'}` after actual byte validation. |
| POST `/release-proposals` | `{operationId,expectedVersion,expectedRevisionId,target,sheetAssetId,meterAssetId,facts,outcome,reason}`; 201 or replay 200 `ReleaseProposal`. `facts` is the strict AttestedFacts object in P-29; no inspection/precision/approval boolean is added. |
| GET `/release-proposals` | Query `cursor?`, `limit?`; Page of kind-authorized `ReleaseProposal`, newest proposal time then ID. |
| GET `/release-proposals/:proposalId` | No body; current `ReleaseProposal`. |
| POST `/release-proposals/:proposalId/photo-access` | `{assetId}`; short-lived `{url,expiresAt,assetId}`, bound to that proposal's sheet. Original meter photo uses the existing authorized meter viewer. |
| POST `/release-proposals/:proposalId/decision` | `{operationId,expectedVersion,expectedRevisionId,expectedProposalVersion,outcome:'approve'|'reject',reason}`; `{proposal,decision}`. Approval's linked `decision.result` is the actual sale Decision; rejection's result is null. |

## Entry, authority and boundaries

Start at an existing held sale's price, card, date or capture review after ordinary review cannot settle it. Keep its title and original record. Add a sheet titled **“Records can't settle this”** with: “If a matching shift-sheet or sales-log entry can settle this review, propose a release for another person to check. The sale stays held until a decision is recorded.” Action: **“Propose a release with a sheet photo”**. Opening the form is not a finding that the sale qualifies: the server alone decides structural admission; `evidence_insufficient` from ordinary review does not establish it. See Q1 for the missing guarded preparation data.

| Selected review | Both people need, in a full live admin session | Proposed confirm copy and consequence |
| --- | --- | --- |
| Price | `sales` + `priceReview` | “Confirm captured values” · Only when a real rate boundary defeats v1 and P-26. Preserve captured numbers; never overwrite a later numeric candidate. No sheet-based correction. |
| Replaced card | `sales` + `cardEligibility` | “Confirm valid earlier purchase” · Same original customer/card link valid throughout the supported range, strictly before replacement. Old card stays disabled. |
| Sale date | `sales` + `dateReview` | “Confirm sale date from the entry” · Server derives one supported Lagos day, stored separately from the original timestamp. |
| Capture | `sales` + `dateReview` | “Confirm capture checks from the entry” · Exact complete current set of one or two open authorization/timing blocks; no subset selection. Outside-campaign timing remains excluded. |

Both people must differ from the original attendant and every recorded recovery executor/grant authorizer; approver must also differ from proposer as a **person**, including alternate accounts. Owner has no exemption. Unknown/ambiguous canonical identity denies; the browser never decides identity from names or separate user IDs. Rejection needs the independent reviewer's live authority but not the proposer's continuing grant, evidence sufficiency or active v2. Approval rechecks both people and the frozen context.

No entry action for duplicate flags alone, ordinary numeric corrections, missing evidence/customer/history/settings, unsupported retirement, correction-authorship blocks, late receipt, uniformly wrong captured rate or missing meter configuration alone. Keep the corresponding existing remedy. Original fresh meter evidence is required for confirm **and** cancel. If no eligible second person is available: “This sale stays held until a different authorized person can review it.” No timer or emergency release.

## Screen and state inventory

These are states within the existing review flow, not commissioned URLs. Proposed composition: extend the existing kind page with a sheet/form and a proposal disclosure; preserve sale/customer-filter return context. Do not silently redirect an ordinary one-person confirmation to a release endpoint. A future navigation choice needs approval with this brief.

| State | What is visible / exact primary copy | Actions and result |
| --- | --- | --- |
| R0 · Loading | “Loading release details…” | No enabled mutation. Original sale remains separately labelled if already loaded. |
| R1 · Entry | “Records can't settle this” sheet above | Propose action, or “Keep reviewing” (ordinary path, no write). |
| R2 · New form | “Propose a release” · “This proposal will not credit or cancel the sale.” | Form below; “Review proposal”, “Discard changes”. |
| R3 · Invalid form | “Check the marked fields before reviewing.” plus field errors below | Preserve unsent values; focus error summary, link to fields. |
| R4 · Photo | Empty, chosen/local preview, uploading, checking, validated, failed or expired | Copy and actions in photo table. A validated photo is not an approved proposal. |
| R5 · Review proposal | “Review proposal” · original/entry comparison, photo, selected target/outcome, range/precision, reason, impact | “Confirm proposal”, “Keep reviewing”. No write until confirmation. |
| R6 · Sending | “Sending proposal…” | Freeze request and disable duplicate sends. |
| R7 · Pending | “Awaiting another reviewer” · “This proposal has not released the sale.” | “View proposal”, “Refresh sale”; independent person may review. No edit, withdraw, self-approval or second proposal. |
| R8 · Independent review | “Review release proposal” · “Check the entry and facts independently before deciding.” | “Approve proposal” or “Reject proposal” opens R9; independent reason required. |
| R9 · Decision review | “Review approval” or “Review rejection”; exact submitted outcome/reason and impact | “Confirm decision”, “Keep reviewing”. Sending: “Recording decision…”. |
| R10 · Uncertain send | “We couldn't confirm whether this was recorded. Retry the same request to check its result.” | “Retry same proposal” / “Retry same decision”; edits/new operation blocked until reconciled. |
| R11 · Approved | “Release decision recorded” plus actual loyalty consequence first | Immutable decision, both people/reasons/server times, remaining checks; then refreshed sale. |
| R12 · Rejected | “Proposal rejected” · “This proposal changed no sale values or holds. Check the current sale status below.” | History retained; refreshed current sale; new proposal only after a new explicit review. |
| R13 · Superseded | “Proposal superseded” · “Another recorded action closed this review. This proposal was not approved or rejected.” | Link actual closing event when authorized; no decision controls. |
| R14 · Stale pending | “This proposal needs a fresh review” | Still pending/blocking; reread, independently reject obsolete proposal, then ordinary review or fresh proposal. No rebase/edit. |
| R15 · No history | “No release proposals recorded.” | Ordinary review remains. |
| R16 · Load failure / unavailable | “Release details couldn't be loaded.” / “This sale or proposal is unavailable.” | “Try again” for load failure; “Back to reviews” for non-disclosing unavailable/foreign ID. Never fake empty history. |
| R17 · Policy unavailable | “Two-person release isn't switched on for this station.” | No new release/approval; ordinary review and permitted rejection/history remain. |
| R18 · Access lost / signed out | “You no longer have permission to review this sale.” / “Sign in again to continue.” | Clear protected form, photo and response state; reload session or sign in. No resubmit under another account. |

Only `pending`, `approved`, `rejected`, `superseded` are stored proposal states. Loading, stale, sending and unavailable are view states, never invented server enums. There is one pending proposal **per sale**, including disjoint targets. Rejected/superseded proposals cease to be pending blockers; unresolved underlying reviews remain blockers.

## Propose form: labels, evidence and validation

Read-only **“Original purchase”** retains customer, captured card, station/pump/product, original attendant, original amount/quantity/basis/rate/precision, device-reported capture time, first server receipt, original meter photo and current accepted values where different. Label the latter **“Currently recorded”**; never substitute them for the original. Group locked context under **“Entry must match this sale”**. No customer/card/pump/attendant picker, numeric sale editor or new meter photo.

| Field / label | Control, helper and error copy |
| --- | --- |
| “Record type” | Required choice: “Shift sheet”, “Sales log”; starts unselected. Error: “Choose the record shown in the photo.” |
| “Entry reference” | Required trimmed 1–120 characters. “Use a page and entry reference. Do not enter a link, phone number or email address.” Error: “Enter a reference of 1 to 120 characters without personal contact details or links.” |
| “Sheet photo” | Exactly one JPEG; camera or file selection for admin paper only. Photo rules below. |
| “Amount written in the entry (₦)” | Blank initially; independently transcribed, two decimals maximum. Paired “Not written in this entry” checkbox encodes null. Error: “Enter the amount exactly as written, with no more than 2 decimals.” |
| “Quantity written in the entry (litres)” / “Quantity written in the entry (kilograms)” | Blank initially; exact decimal, original unit and captured precision (0–6), no rounding. “Up to {precision} decimals, as captured.” Null checkbox as above. Error: “Enter a positive quantity with no more than {precision} decimals.” |
| “Rate written in the entry (₦ / litre)” / “Rate written in the entry (₦ / kilogram)” | Blank initially; positive exact money, two decimals maximum, independently transcribed or explicit null. For price confirm: “The written rate must match the captured rate.” Error: “Enter the rate shown in the entry, with no more than 2 decimals.” |
| Numeric fields together | “Copy only values visible in the entry. Do not calculate missing values or change this sale's numbers.” At least amount or quantity is present; the original entered-basis value must match the guarded candidate. Error: “The entry must show the sale's entered amount or quantity. Copy it exactly; do not calculate it.” Mismatches/unknown candidate go to server insufficiency, never suggest new readings. |
| “Time detail shown in the entry” | Required choice “Date only” / “Time range”. “Use the full range the entry supports. Do not guess a time.” See precision rules below. |
| “Sale date in the entry” | Date-only mode. Error: “Enter a real date shown in the entry.” |
| “Earliest supported date and time” / “Latest supported date and time” | Range mode, separate date/time inputs; persistent “Africa/Lagos (UTC+01:00)”. Error: “Enter the full time range supported by the entry. The end must not be before the start.” |
| “Time precision shown” | Range mode choices “Minute”, “Second”, “Millisecond”. Error: “Choose the precision actually shown in the entry.” Do not infer finer precision. |
| “What does the entry say?” | Required radio “Sale recorded” / “Entry marked void or erroneous”. Error: “Choose what the matching entry explicitly records.” |
| “Proposed outcome” | Confirm choice uses the kind-specific label above, available only for Sale recorded. “Cancel this invalid sale” available only for Entry marked void or erroneous. “Cancellation needs a matching entry explicitly marked void or erroneous. A missing entry or uncertain timing is not enough.” Changing finding resets outcome. |
| “Proposal reason” | Required trimmed 1–1000 characters, single paragraph (no control characters). “Explain how the entry supports this outcome. Do not include phone numbers or secrets.” Error: “Enter a reason of 1 to 1,000 characters.” Cancellation reason must explain the recorded invalidity; uncertainty/outside campaign is insufficient. |
| Inspection attestation | Required unchecked checkbox: “I have inspected the sheet photo. The facts and time precision above are legible and faithfully copied.” This is a review requirement, not a new wire boolean. |

Use exact decimal parsing and kobo strings, never floating-point conversion. Reject negative, zero, exponent, malformed, out-of-range or excess-precision numbers without rounding. Display missing fields as **“Not written in the entry”**, never zero or a calculated substitute. No prefilled transcriptions from captured values. Money displays `₦20,000.00`; unit words are litres/kilograms. Internal IDs come from protected server context, never user text or a printed card code converted to an ID (Q1).

Range encoding is a proposed UI decision, using PR #148's millisecond-bounded `from`/`through` instants and fixed timezone; there is no extra precision wire field. Date only encodes the whole Lagos day from 00:00:00.000 through 23:59:59.999 inclusive. A written minute includes its entire minute; a written second includes its entire second; expand the earliest start and latest end at that precision. For example, a lone 10:42 minute covers 10:42:00.000–10:42:59.999, not one exact instant. Review displays the declared granularity and full inclusive encoded range, including seconds/fractions when needed, beside **“Time range from the entry · external attestation”**. Never silently clamp to first receipt or choose an exact minute from a day. Unsupported precision: “The entry doesn't support this time precision. Use the full range it shows.” Server checks date after receipt, intersection with original bounds and every consequence; whole-day evidence may remain insufficient for an intraday boundary.

### Photo states

| State | Exact copy and controls |
| --- | --- |
| Empty | “Frame one entry and the headings needed to read it. Keep other customers and contact details out of the photo.” “One JPEG, up to 8 MiB, 16 million pixels and 6,000 pixels on either side.” Actions “Take sheet photo”, “Choose JPEG”. |
| Chosen | “Sheet photo preview” · “Check that the complete entry is readable before uploading.” Actions “Open full size”, “Use this photo”, “Choose another photo”. Local preview stays in this view's memory only. |
| Existing attached evidence | “Use a retained sheet photo” lists only authorized, same-sale assets from proposal history, not a gallery of other sales. Inspect through that proposal's photo-access call. Otherwise choose/upload new. Never accept an arbitrary asset ID or URL. |
| Sending / validating | “Uploading sheet photo…” / “Checking uploaded photo…” No proposal submission until finalize returns `validated`. |
| Validated | “Photo received · entry still needs review” · “Receiving a photo does not verify its contents or release the sale.” Preview from the selected local bytes until attached; no unimplemented pre-proposal signed-read route. |
| Invalid | “This photo couldn't be accepted. Choose one readable JPEG within the stated limits.” Action “Choose another photo”. Client checks aid selection; server byte validation decides. |
| Upload expired | “This upload expired. Start a new photo upload.” Only after a definitive expiry; never replace an uncertain finalize blindly. |
| Storage unavailable | “The photo service is unavailable. Try again.” Keep unsent data in memory; retry the same reservation/finalize operation when its result is uncertain. |
| Read expired / unavailable | “Photo access expired. Load the photo again.” / “This photo is unavailable. Approval needs both retained photos.” Actions “Load photo again” / “Refresh sale”. Rejection may still proceed. |

Admin file choice is approved; file creation time/EXIF proves no capture time. No whole-page upload or browser crop feature is commissioned. Pick/take an already framed entry; reject unrelated, illegible or ambiguous content. Keep the original meter viewer separate. Both images have keyboard full-size controls, no public link, download/share action or background persistence. Issue short-lived access only on inspection (60-second recommendation, five-minute ceiling); recheck live permissions on refresh. Pilot keeps retained evidence, including rejected/superseded proposals.

## Review, pending and independent decision

R5 shows **“Original purchase”** and **“Facts copied from the entry”** side by side on desktop, paired field by field on phone. Add **“Currently recorded”** if different, rather than hiding later meter/correction values. Rows: station, pump, product, original attendant, customer/card, entry mode, amount, quantity/unit, rate, device-reported time, first server receipt, record type/reference, supported range/precision, finding, target, proposed outcome, proposal reason. Do not label paper time as trusted capture. Show original meter and sheet photo separately; never imply byte checks authenticate paper.

Under **“Impact if approved”** use:

| Outcome | Exact copy |
| --- | --- |
| Confirm price | “A different authorized person must approve this proposal. Only this price review may clear. Captured values stay unchanged; a later numeric revision cannot be overwritten. Loyalty credit still depends on every other check.” |
| Confirm card | “A different authorized person must approve this proposal. Only this card review may clear. The old card stays disabled. Loyalty credit still depends on every other check.” |
| Confirm date | “A different authorized person must approve this proposal. Only this date review may clear. The verified date is recorded separately; the original timestamp stays unchanged. Loyalty credit still depends on every other check.” |
| Confirm capture | “A different authorized person must approve this proposal. All selected open capture checks are reviewed together. Other holds remain. A sale outside the campaign still does not count toward the giveaway.” |
| Cancel | “A different authorized person must approve this proposal. Approval cancels this sale and closes its original holds and capture checks as cancelled. It does not cancel another sale. The original entry and history remain.” |

Always add: “Submitting a proposal does not change loyalty credit.” Server checks all attested ranges together for consistency, without borrowing one target's evidence for another. No client prediction of eligibility, implied rate, new spend/rank or aggregate delta.

R7 appears on the sale and its kind review, and in the review queue (Q2). Keep the sale pill **“Held”** / **“Awaiting price review”** and add explanatory text **“Awaiting another reviewer”**. Show **“Proposed by {name} · {code}”**, **“Proposed at {server time}”**, target/outcome and timeline. Only kind-authorized readers see protected facts/reasons/photo. Sales-only users keep the ordinary held status. Pending is never “Synced”, “Approved” or credited. Disabled second-proposal control explains: “This sale already has a pending proposal. A different authorized person must decide it first.”

R8 retains that comparison and evidence, with the first person's exact protected reason. Both reviewers must inspect the sheet; approval requires a new unchecked **“I have independently inspected the sheet photo. The facts and time precision are legible and faithfully copied.”** A disabled approval explains missing inspection. Rejection remains possible without current photo sufficiency; it is not an attestation that the entry is true. Neither choice edits facts/outcome. Label the independent required input **“Decision reason”**, helper “Explain your own decision. Do not repeat a reason you cannot verify.” Same reason bounds as proposer.

Self view: **“You can't approve your own proposal.”** Helper: “A different person with this review permission must decide it. Signing in with another account does not make you a different reviewer.” Both approve and reject are unavailable to the proposer; same-person aliases and sale/recovery exclusions also deny at the server. Do not display another person's binding information. Missing binding copy is in the error table.

Approval confirmation repeats outcome, both actors, own reason, sheet attestation, original/entry comparison, and relevant impact above. Rejection confirmation: “Reject this proposal. It changes no sale values or holds. The sale may still need review.” **“Keep reviewing”** returns without a write. No edit-proposal route or manual supersede button exists.

### Timeline and recorded results

Protected proposal timeline labels: **“Proposed by {name} · {code}”**, **“Approved by {name} · {code}”**, **“Rejected by {name} · {code}”**, **“Superseded by a recorded sale action”**. Use trusted action times in Lagos (`21 Oct 2026 · 10:42 AM`); no client-generated action time. Proposal GET supplies propose and human-decision times. It supplies no supersession timestamp/event ID: use an authorized linked audit event if available, otherwise “Supersession time unavailable”; do not use refresh time. Show immutable history newest first with “Older proposals” / “Newer proposals” and scoped opaque cursors, default 25, maximum 100. Never imply the first page is complete.

R11 uses S09's immutable receipt, then refreshed current status. Result copy selected from the actual linked decision:

- `creditedAfter=true`: **“Loyalty credit recorded”** · “This decision passed the remaining checks. Current sale status is shown below.” No invented giveaway membership claim.
- Confirm with remaining holds/blocks: **“Still held for review”** · “This decision cleared only the selected review. The remaining checks below still prevent credit.” Render actual remaining reasons.
- Confirm without credit for another gate: **“Decision recorded · not credited”** · “This decision does not confirm loyalty credit. Check the remaining validation and eligibility status below.”
- Cancel: **“Sale cancelled”** · “This sale does not count toward loyalty. The original entry and history are retained.”

If refresh fails: “Decision recorded. Current sale status couldn't be refreshed.” Action **“Refresh sale”**. A same-key replay says “This is the original recorded result. The sale may have changed since then.” Never apply its historical outcome as new current status. R12/R13 alone never imply the sale is now credited or remains held; read current status.

## Errors and request recovery

Use plain copy below, retain an accessible error summary and avoid raw request/evidence details. All unspecified transport/parse failures after a write are uncertain, including malformed success. Freeze actor, path IDs, operation ID, full body and guards at final confirmation for reserve/finalize/propose/decide separately. Retry exactly those bytes/identity, never a changed body under the same key. Acquire upload URLs anew; they are not durable receipts. Requests and photos stay in account-scoped memory, not service workers, IndexedDB or shared storage. Do not carry them into another session. If the view is lost, reread server proposal/history before another attempt; never automatically issue a replacement write.

Creation increments purchase version once. Decision uses a **fresh post-proposal SaleGuard**, not `guardAtProposal`, plus current `expectedProposalVersion`. Once a decision was sent, do not refresh its guards within a retry. Definitive stale/conflict means reread and explicitly review a new request; closing/rejecting an obsolete pending proposal requires the independent reviewer and current guards. Ordinary target closure may supersede it atomically. No timer clears it.

| Code / condition | Exact copy | Next action |
| --- | --- | --- |
| `release_not_required` | “The records can now settle this through the ordinary review. This proposal was not applied.” | “Refresh sale”; independent rejection of obsolete pending proposal if still pending, then ordinary path. |
| `proposal_stale` | “The sale, evidence or permissions changed after this proposal. Refresh and review it again.” | No automatic rebase; pending remains blocking until rejected/superseded. |
| `evidence_insufficient` | “The entry and records don't settle this review. The range may be too broad, the facts may not match, or they may conflict with another recorded decision. Leave the sale held; do not guess or change readings to make them fit.” | Keep unsent draft only; no claim about which subcause failed. |
| `independent_reviewer_required` | “You can't decide this proposal. It needs a different person who was not the sale's attendant or involved in its recovery.” | Self helper above when known; no alternative-account workaround. |
| `independence_unverifiable` | “We can't verify that you're an independent reviewer. Ask an authorized administrator to check staff identity records. This sale stays held.” | No linking/binding editor. |
| `permission_denied` / revoked grant | “You no longer have permission to review this sale.” | Clear protected state; “Reload access”. Never offer an unauthorized retry. |
| `release_policy_unconfigured` | “Two-person release isn't switched on for this station. This sale stays held. You can continue ordinary review.” | No repeated new approval/propose; authorized rejection/history remain possible. No activation control. |
| `proposal_pending` | “This sale already has a pending proposal.” | Refresh and open it; never overwrite. |
| `version_conflict` | “This sale changed while you were reviewing it. Refresh and review again.” | Definitive failure; fresh explicit review. |
| `operation_conflict` | “This request doesn't match its earlier submission. Refresh the recorded history before continuing.” | Do not mint a key and resend automatically. |
| `review_closed` / `hold_kind_mismatch` | “This review is no longer open or does not match this proposal.” | Reread current target and history. |
| `evidence_unavailable`, `evidence_deleted` | “Required evidence is unavailable. This sale cannot be approved from this proposal.” | Refresh; authorized rejection remains. Never ask for a replacement original meter photo. |
| `evidence_pending` | “The photo has not finished validation.” | Retry same finalize/check upload result; no proposal until validated. |
| `evidence_already_validated` | “This photo has already been received.” | Reconcile same finalize operation; never PUT over final evidence. |
| `photo_invalid`, `upload_expired`, `storage_unavailable` | Photo-state copy above | Explicit retry/new selection only as specified. |
| `date_invalid`, `date_after_receipt` | “Enter a real date supported by the entry.” / “The supported sale date cannot be after the server received this sale.” | Correct only from evidence, never clamp/guess. |
| `invalid_request`, `request_too_large` | “This form couldn't be submitted. Check the fields and try again.” | Keep safe unsent input; do not show raw schema errors or body. |
| `unauthenticated`, `password_change_required` | “Sign in again to continue.” / “Change your temporary password before reviewing sales.” | Clear sensitive view and use existing sign-in flow; recovery sessions cannot review. |
| `origin_rejected` | “This request couldn't be verified. Reload the page before continuing.” | Reconcile any uncertain send before starting a new request. |
| `not_found` | “This sale or proposal is unavailable.” | Back to reviews, no foreign-resource disclosure. |
| `rate_limited` | “Too many requests. Wait a moment before trying again.” | Honour Retry-After; explicit same-operation retry for uncertain write. |
| `temporarily_unavailable`, offline, unreadable response | “We couldn't confirm whether this was recorded. Retry the same request to check its result.” | R10 for writes; “Couldn't load this view. Try again.” for reads. Never offline queue admin releases. |

## Queue, giveaway, audit and attendant surfaces

**Review queue and sale detail.** Preserve the existing type filters and table pattern. In an authorized row add “Awaiting another reviewer”, proposed-by/time and **“Review proposal”** linking the same-sale state; phone rows stack those labels. Loading: “Checking release status…”; failed: “Release status unavailable” with “Try again”, never “No pending proposal”. Pending for a different kind still prevents another proposal. Do not expose its protected narrative to a person missing that kind's permission. Complete discovery, safe summary fields and required guard context are build dependencies Q1/Q2, not claims that PR #148 already provides them.

**Giveaway readiness.** Under `reviews_unresolved`, show **“Reviews still need decisions”** and “Unresolved holds and pending two-person release proposals block saving giveaway results, revisions and unchanged reconciliation.” Show existing counts as **“Sales with holds or pending hold releases: {counts.holds}”** and **“Sales with policy checks or pending capture releases: {counts.policyBlocks}”**. Count distinct sales within each union, never sum the two counts or invent a pending-proposal count. With only readiness, do not assert a particular proposal exists. When a kind-authorized sale read confirms one, show “Sale {saleCode} · awaiting another reviewer” and “Review proposal”; otherwise **“Open review queue”** only when `sales` permits. Leaderboard-only users see blockers, no protected facts/photo/people. Stale or deactivated pending proposals still block; unavailable-phone exclusion cannot hide them. Proposal transitions invalidate previews; copy: “The records changed. Refresh readiness and prepare a new preview.” Old snapshots remain frozen; later approved changes require authorized reconciliation/new revision. WO-core-12 must implement and verify these hooks before v2 can become available.

**General audit.** Reuse Audit history list/detail and closed action filters. Four labels: **“Release proposed”**, **“Release approved”**, **“Release rejected”**, **“Release superseded”** for `held_release_proposed/approved/rejected/superseded`. Display server event time, sale reference, target kind, proposed confirm/cancel, transition state, categorical reason and recorded actor. Link related events to show proposer and human approver/rejector as separately labelled actors; supersession is **“System · validation”**, not a human approval. `approverId` is present only for approval; rejection actor comes from its event. If a linked event is inaccessible: “Related actor details unavailable”; do not invent a name. No raw sheet, preview, facts, entry reference, free-text reasons, range, digest, URL or person-binding details. Safe opaque IDs are not proof or evidence-access grants. “Open protected proposal” appears only with the kind grant and `sales`; reauthorize at destination. Audit access by itself never grants paper access.

**A14 / attendant.** Keep the current uploaded held result through pending, stale and rejected proposals: price headline **“Awaiting price review”**, other kinds **“Held for review”**. When the server confirms details and original photo received: “Uploaded: details and photo received. Not counted toward loyalty until an admin reviews it.” Reassurance: “No need to record this sale again. Re-uploading will not clear the review.” Reuse original customer/amount/quantity/unit/sale-code card, **“View details”**, **“Refresh sale”**, history/upload navigation. No proposal badge, actors, reasons, facts, reference, sheet IDs/photo or review links. Once actually resolved use the current server result, not proposal status: ordinary credited/Synced only on confirmed credit, still-held while another check remains, or Cancelled on cancellation. Offline/unavailable: “Can't refresh this sale while offline. Its status may have changed.” Do not cache admin/own-sale protected responses; retain existing local receipt semantics and label any old status as last known.

## Layout and accessibility

Use vendored `wr-` components: PageHead, Sheet, Notice, StatusPill, KeyValueList, TextField, SelectField, Reason, Button, DataTable and the existing protected full-size photo viewer. No new palette/typeface. Proposal lifecycle is explanatory text alongside existing held/pending visual treatment; sale status remains authoritative. Amounts/rates use IBM Plex Sans with tabular numbers; IDs use IBM Plex Mono.

| Surface | Desktop (1440 px reference) | Phone (390 px, verified later at 360 px) |
| --- | --- | --- |
| Entry / form | Existing 248 px sidebar and 40 px page gutters. PageHead/back, held notice, original/evidence two-column grid; full-width proposal sheet below. Form/photo can pair within available space. | Under 900 px use existing admin top bar and one column, 16 px gutters. Order: title/back, consequence, compact original disclosure, original meter, sheet photo, fields, reason, actions. |
| Proposal / decision review | Matched original/entry columns, explicit current-values panel if needed, both images inspectable, full-width impact/reason/confirm sheet. | Pair each original label/value with its attested counterpart vertically. Keep headings repeated so comparisons remain clear. Full-width primary action with secondary below; no compressed two-column values or nested modal forms. |
| Pending / result | Status notice above timeline, both people on separate timeline rows, original/history below. | Consequence first, compact receipt, timeline stacked; preserve all actor/time labels. |
| Queue / giveaway / audit | Existing table/notice layout, safe actor columns and links; no evidence thumbnail in general lists. | Labelled stacked content where supported; table scroll stays inside its wrapper, never the page. No proposal facts in narrow list summaries. |
| A14 | Retain phone-width attendant content, not admin sidebar. | Existing AppHeader, clock ResultBlock, summary, Notice/reassurance, Refresh sale and bottom nav. No extra admin controls. |

Long forms may use the existing sticky action bar with enough bottom padding and safe-area clearance to keep the last input/focus visible. Phone targets 48 px minimum, primary CTA 56 px; admin desktop controls use existing 40 px token. Body 16 px on phone, captions at least 13 px, normal-text contrast at least 4.5:1. No status conveyed only by colour; destructive cancellation states its effect in words.

Use real labelled inputs, fieldset/legend for finding/outcome/precision, named file control and buttons. Required/error/helper text is associated via `aria-describedby`; errors add `aria-invalid` and an error summary with field links. Local validation never erases typed evidence. Focus the review heading after Review, restore triggering control on Keep reviewing, and announce recorded/uncertain/stale results once (`status` for progress, `alert` for errors). During sending disable duplicates without trapping keyboard focus.

Photo alt text describes purpose, e.g. “Sheet entry for sale {saleCode}”, without transcribing sensitive text into DOM metadata. Full-size viewer has labelled zoom/close controls, keyboard pan/zoom alternative, Escape, contained focus and restoration; image is not the only label. Accessible zoom is essential for legibility checks; if an authorized reviewer cannot inspect the entry, leave held rather than approve. Date/time inputs have visible timezone and precision, are keyboard-operable and do not rely on placeholders. Preserve reading order at 200% zoom; no page overflow at phone widths. Clear photos, object URLs and protected data on account/access loss and unmount; never put evidence in browser history, URL query strings, analytics or shared storage.

## Build verification after approval

The later work order should cover each R state across price/card/date/capture, amount/quantity basis and litres/kilograms; both outcomes; full-day/minute/second/millisecond ranges; absent written fields; later meter candidate; invalid original evidence; unrelated sibling holds and mutually inconsistent attestations. Exercise independence aliases/excluded actors/unknown binding, proposer demotion, reviewer permission loss during photo access, deactivation with rejection still possible, every upload stage, races, same-key replay and malformed success. Assert complete queue discovery and giveaway union counts without double counting, all four safe audit transitions, and zero proposal detail in A14. Compare 1440 px admin and 390/360 px phone captures to the built hierarchy; keyboard/screen-reader check form, comparison, confirmation and photo viewer. These are future acceptance requirements, not tests claimed by this documentation PR.

## Open questions for Earl

All defaults below apply to this **reversible brief from 16 Nov 2026** only. No new credit, authorization or runtime behavior is enabled. Settled WHR-144–148 choices are not reopened. Rook review and Earl's screen approval are still required.

1. **How should the build obtain guarded proposal preparation data?** [WHR-159](https://linear.app/phaneum/issue/WHR-159). Option A: commission a protected, kind-authorized preparation projection with original context IDs (including historical card ID), exact capture-block IDs/versions, current candidate/guard and structural admission result. Option B: keep the new form unbuildable until a later contract supplies those values. **Recommend A**, as a core/spec dependency of the build WO. PR #148 has no preparation endpoint; SaleDetail lacks card ID and exact block IDs/versions, and ordinary `evidence_insufficient` is not admission. **Default: B for enabling the form; retain this proposed design pending the contract.** Never infer IDs, reverse-map card codes, or fabricate an eligibility response.

2. **How should all pending proposals be discoverable in the queue?** [WHR-160](https://linear.app/phaneum/issue/WHR-160). Option A: commission a safe server pending-release queue/summary/filter, respecting kind access, including stale proposals and proposals whose underlying ordinary filter no longer finds the sale. Include proposed-by/time for authorized readers. Option B: only per-sale discovery, with giveaway blocked but no complete pending-release queue. **Recommend A**; otherwise staff can miss a blocker. PR #148 lists proposals only under one sale; existing sale rows/filters have no pending-release fields. **Default: keep queue completeness a build blocker; do not claim B meets this brief.** Do not scan every sale or expose protected facts to decorate a list.

3. **Can this written brief serve as the approved screen decision?** [WHR-161](https://linear.app/phaneum/issue/WHR-161). Option A: approve the layouts, exact copy, in-place flow and precision controls here, then Rook drafts a build WO with Q1/Q2 dependencies and later fidelity captures. Option B: require static boards first, then approve those before the build WO. **Recommend A** because it reuses inspected S02–S07/S09/A14 patterns and makes every new state explicit. **Default: await Earl's choice; no UI build or v2 activation.**
