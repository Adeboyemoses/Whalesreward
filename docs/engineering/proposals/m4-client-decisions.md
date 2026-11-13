# M4 client decision pack — PROPOSAL

WO-spec-4a / WHR-133 · 13 November 2026. For Whales to decide before giveaway setup. This pack recommends choices; it does not approve them, set dates, release held sales or enable photo deletion. The [M4 contract](../contracts/m4.md) defines the engineering rules. Earl's approved build defaults remain in force while client confirmations are pending.

A sale can count in normal recorded spending without qualifying for the giveaway. Giveaway eligibility needs evidence that the purchase happened during the agreed period and that its details and complete photo arrived on time. Finalizing saves a numbered, frozen result. Later accepted changes require a new reviewed result; the earlier one stays available.

## 1. Final checks and proof of complete upload — WHR-54

**Explanation.** Before declaring winners, Whales needs confidence that every relevant review and upload has been dealt with. The server can see sales already received, but cannot see a sale still stored only on a phone. A phone saying “upload done” is not proof that the complete photo arrived. Missing proof must remain unresolved rather than awarding points on an assumption.

**Option A — recommended.** Approve a versioned checklist covering unresolved price/card/date/capture holds, corrections, duplicate decisions, incomplete uploads and uncertain eligibility. Require the first server receipt of details and an immutable server-observed receipt of the complete photo by the upload deadline, including the exact deadline instant. Bind that photo receipt to the bytes later validated. Later validation cannot backdate receipt. A late or unproved upload cannot qualify through an admin's explanation.

**Phone reconciliation under A.** Name a station manager to check every capture phone and originating account for unsent records before confirmation, including offboarded accounts needing authorized recovery. Record which queues were checked and any unavailable device. Any unresolved relevant queue prevents completion. This is an operational checklist item; a tick alone cannot substitute for server checks or prove absent uploads. Engineering must specify how that evidence is recorded before implementing the checklist.

**Option B.** Supply another explicit checklist and complete-photo receipt method. It must still preserve trusted deadlines, validated evidence, unresolved-review blocks and frozen results. A different proof method needs engineering review before it can be used; neither option permits late sales to be silently added.

**Recommendation.** Choose A and name the responsible manager. Handle winner announcements manually after reviewing the saved result. If a later accepted change affects it, review a new numbered result before communicating a correction.

**Default and blocker.** From 13 November 2026 until answered, keep the policy unset and retain the data. Finalization and result revisions stay blocked. Normal sales capture and operational reporting do not wait for this answer. Missing evidence still blocks the affected sale or campaign check after policy approval.

**Register-ready question — WHR-54.** Will Whales approve Option A's server checks, complete-photo arrival proof and manager-led phone/account checklist, including blocking an unresolved or unavailable queue, or provide Option B's replacement? Who owns the checklist and winner communication? Recommend A. Default: no final result or revision until an approved checklist and proof method are implemented and configured.

## 2. Establishing dates and changing them — WHR-55

**Explanation.** Launch is when the loyalty system goes live. Campaign start is when purchases begin qualifying; it cannot precede launch. Cutoff ends qualifying purchases. Grace is extra time to deliver earlier purchases, not extra shopping time. The upload deadline is cutoff plus the chosen number of whole grace hours. These are different facts and must be visible before confirmation.

**Option A — recommended.** Whales supplies launch, start and timezone in writing for controlled, audited setup by an authorized operator. Settings shows those values alongside cutoff and grace. Start and launch are inclusive; cutoff and upload deadline are inclusive at their exact stored instants. Require launch ≤ start < cutoff. Allow reviewed timing changes only before campaign start and before any saved result, preserving every previous configuration. No manager silently extends a running campaign.

**Option B.** Commission a separately specified process for changes after start. Whales must define who approves, how affected customers are treated and notified, and how changed eligibility is reviewed. Earlier saved results remain unchanged. This is extra policy/design work, not an emergency override already included in the product.

**Recommendation.** Choose A for the pilot. Announce exact local times with the timezone. Finalization can happen only strictly after both cutoff and upload deadline and after all checks pass. With zero grace, the two deadlines coincide; finalization at that exact instant is still too early.

**Default and blocker.** From 13 November 2026 until answered, timing changes remain disabled and launch/start provisioning is unapproved. Unknown campaign values stay blank; qualifying preview and finalization remain unavailable. Approval of a policy without supplying the actual values does not unblock setup. Settings cannot invent launch/start from a screen example.

**Register-ready question — WHR-55.** Does Whales approve controlled, audited launch/start setup, exact inclusive boundaries and timing changes only before campaign start and before any saved result (A), or require a separately designed after-start amendment process (B)? Recommend A. Default: timing changes and giveaway preparation remain blocked pending approved policy and actual values.

## 3. Keeping photos versus deleting them — WHR-56

**Explanation.** Saving “keep photos for a chosen number of days” records an intention. It does not turn on deletion. Whales also needs to decide which copies it expects to keep, when the clock starts, what evidence must be protected during reviews, and how backups or older stored versions are handled. A screen label saying “Original + compressed” proves no storage policy.

**Option A — recommended for planning.** Approve a complete retention policy before commissioning removal. Specify compressed-only or original-and-compressed copies, the retention clock's starting event, the period, exceptions for pending evidence and active holds, and backup/noncurrent-copy treatment. Preserve frozen results, source lineage and audit. If deleting photo bytes would prevent that preservation, the removal design must explicitly resolve the conflict before approval. Every deletion needs a recorded outcome.

**Option B.** Defer removal and retain all received photo bytes until a later policy decision. This preserves evidence but does not settle how long it should ultimately remain. It does not promise a raw original that the phone never uploaded.

**Recommendation.** Choose A as the policy-design direction, then approve the detailed rules and a separate removal work order. Choose the actual storage-copy policy based on the evidence Whales needs; no copy mode is silently selected here. M4 can record a positive whole-day retention intention, or leave it blank.

**Default and blocker.** From 13 November 2026 until answered, retain all received bytes and keep deletion disabled. A supplied duration changes intent only. Automatic removal stays blocked until policy, exemptions, stored copies and backup handling are approved and separately implemented. This decision does not by itself prevent ordinary sales or a correctly configured giveaway.

**Register-ready question — WHR-56.** Should Whales approve a complete photo-retention policy covering copies, start event, exceptions, backups and deletion records before a separate removal project (A), or defer removal and preserve all received bytes (B)? Recommend A for planning; default B until approved. Please name the required copy mode and retention start event. No answer here alone enables deletion.

## 4. Actual launch and campaign values — D09

**Explanation.** The product needs real dates and durations, not dates drawn in the example screens. Whales must supply launch, eligible purchase start, purchase cutoff, timezone, upload grace in whole hours and intended retention in whole days. A zero-hour grace is valid; a blank grace is unknown. Retention can remain blank while the giveaway is configured.

**Option A — recommended.** Supply one approved schedule with exact local date/time and timezone for each instant. Set campaign start at or after confirmed go-live. Choose grace based on the station's realistic upload recovery time, then review the derived upload deadline. State a positive whole-day retention intention or explicitly defer it. Confirm all values together before announcing the campaign.

**Option B.** Defer the campaign schedule until go-live is reliable. Keep campaign fields blank and label totals as recorded spending only. This avoids publishing dates that might need changing but postpones the giveaway setup and final result.

**Recommendation.** Choose A when launch is confirmed. No specific launch date, cutoff, grace duration or retention duration is recommended without station input. Africa/Lagos is the current timezone proposal and must be confirmed. The screen examples of December dates, 24 hours and 180 days are not defaults.

**Default and blocker.** From 13 November 2026 until values are supplied, use B: campaign values remain null, campaign preview/finalization are blocked, and operational reports remain available. Unset retention means no deletion. Supplying dates never approves WHR-54 or WHR-55 policy by implication.

**Register-ready question — D09 values.** Will Whales supply an approved schedule now (A), or defer campaign setup until launch is confirmed (B)? If A, give launch, purchase start, cutoff, timezone, whole grace hours and intended retention days (or explicitly defer retention). Recommend A once launch is confirmed; default B with no invented values. Review and approve the derived upload deadline before announcement.

| Value to return | Current default | Required relationship |
|---|---|---|
| Launch date and time | Unset | At or before campaign start |
| Campaign start date and time | Unset | At or after launch, strictly before cutoff |
| Purchase cutoff date and time | Unset | Exact instant, no automatic end-of-day expansion |
| Timezone | Africa/Lagos proposed; confirm | Used consistently in the approved schedule |
| Upload grace, whole hours | Unset | Zero or greater; derive deadline from cutoff |
| Photo retention, whole days | Unset | Positive if supplied; intent only, deletion disabled |

## Existing questions to carry alongside this pack

These are existing register items, not fresh approvals or new question numbers. Rook should attach this pack to WHR-54/55/56 and the existing D09 date discussion, preserving their unresolved state. Their source register was checked on 13 November 2026; the current repo decisions refine older register shorthand. No client material beyond the engineering decisions is reproduced here.

| Register | Question and M4 consequence | Recommendation / default |
|---|---|---|
| Q-528 | Confirm the capped capture interval, including P-23's verified lookup lower bound. Crossing a boundary remains unresolved; the phone clock cannot qualify a sale. | Confirm current build rule; retain it pending answer, no weaker timing proof. |
| Q-555 | Is the proposed 10-minute duplicate window appropriate for the pilot? Flags count until cancelled but relevant unresolved flags block finalization. | Retain the configured pilot rule pending confirmation; no duplicate hold. |
| Q-556 | Accept server-recorded evidence rules for releasing holds? Notes alone cannot prove when a purchase occurred. | Confirm the existing rule; retain current authorized gates, no automatic release. |
| Q-557 | Is a separate two-person path needed for ambiguous holds? This would change scope and trust rules. | Gather frequency/impact before commissioning a separate design. Default: no such path; uncertain relevant sales continue blocking reconciliation. |
| Q-558 | Choose the lost-card verification delivery provider and complete its setup. | Resolve through the existing provider decision; this pack selects none. No verification bypass or M4-wide blocker merely because this provider is unset. |
| Q-559 | Supply and verify each pump meter's display steps, rounding behaviour and historical applicability. | Obtain station measurements and verification; meter correction remains unavailable without approved profiles and runtime activation. Relevant unresolved price holds still block finalization. |

Whales' response should identify the chosen options, actual values, responsible people and approval date. Rook records it; engineering then updates the approved policy and its implementation work order. Until that happens, recommendations remain proposals and the defaults above preserve the existing blocks.
