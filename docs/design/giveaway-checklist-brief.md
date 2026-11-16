# Giveaway checklist: design brief

WHR-23 / WO-app-11 · Stage 1 · 16 November 2026. Proposed screen design for Rook review and Earl approval. Merging this brief does not approve Stage 2, certify phones, activate policy or save a giveaway result.

## Basis and boundaries

Read E01-Leaderboards, E02-LeaderboardFinalization, E04-FinalizationReady and E03-FinalizationRevision (HTML and PNG), and “Admin Leaderboard Screen Decisions.md” in the read-only product folder. The boards supply the admin shell, notices, sheets, key/value checks, ranking table, reason and explicit confirmation pattern. They do not draw P-30 evidence collection. No new board parity is claimed here.

Engineering references: [M4 leaderboards and giveaway](../engineering/contracts/m4.md), including P-28, P-30 and the giveaway-screens downstream impact row; [invariants](../engineering/invariants.md) I-09/I-11/I-26/I-28/I-35/I-40–I-46/I-48/I-49; [WHR-147](https://linear.app/phaneum/issue/WHR-147). Earl chose Option A in both [WHR-158](https://linear.app/phaneum/issue/WHR-158) and [WHR-162](https://linear.app/phaneum/issue/WHR-162) on 16 November. Their comments supersede M4's older “needs Earl”/Option B default paragraphs. Actual people remain Q-576.

Runtime source of truth is WHR-22, PR #153, merge `b4dcc7ba736df6e1a3fc43853e50954b3d1b6896`: [phone schemas](../../src/shared/contracts/giveaway-phones.ts), [HTTP](../../src/server/modules/giveaway/phone-http.ts), [writes](../../src/server/modules/giveaway/phones.ts), [reads](../../src/server/modules/giveaway/phone-reads.ts), [phone readiness](../../src/server/modules/giveaway/phone-readiness.ts), [readiness](../../src/server/modules/giveaway/readiness.ts), [preparation/confirmation](../../src/server/modules/giveaway/mutations.ts), [history](../../src/server/modules/giveaway/history.ts). This brief changes none of those endpoints. Where they lack a projection, show unavailable information honestly and raise a dependency below.

Reuse [Settings timing](../../src/ui/admin/settings-giveaway.tsx), [Settings](../../src/ui/admin/settings.tsx), [reviews](../../src/ui/admin/reviews.tsx), their API adapters and session store: original values read-only, required reason, review before explicit confirm, receipt-backed result, immutable in-memory pending request, account/session epoch checks. Phone mutations have no separate server review endpoint: their comparison step is a local review of fetched evidence; only the final POST saves. Snapshot preparation is a server mutation that saves reconciliation/preview, not a final result. Do not call it a side-effect-free review.

## Placement, navigation and shared layout

Proposed child views of the existing giveaway flow, not a new sidebar area:

| View | Proposed UI location | Return |
|---|---|---|
| Readiness / nine checks | `/admin/leaderboards/finalize` (E02) | Back to leaderboards, preserving category |
| Manager | `/admin/leaderboards/finalize/manager` | Back to finalization checks |
| Census and inspection | `/admin/leaderboards/finalize/phones` | Back to finalization checks |
| Unavailable proposal | `/admin/leaderboards/finalize/phones/:phoneId/unavailable` | Back to phone census |
| Independent decision / history | `/admin/leaderboards/finalize/exclusions/:exclusionId` | Back to phone census |
| Frozen preview | Existing E04 confirmation state | Keep reviewing returns to checks |
| Saved result / revision | Existing E03 state | Earlier snapshots remain selectable |

Paths are design proposals; route inventory alignment is checked before Stage 2. Direct entry without the requisite local draft says “There is no reviewed change to confirm.” with “Back to finalization checks”. Fetching a saved exclusion by ID is supported; never require another person's browser draft to review it.

**Desktop, 1440 px:** existing admin sidebar and page header; full-width consequence notice. Two sheets below: wider evidence/content sheet left, narrower campaign context/actions right. Context shows campaign name, initial/revision kind, predecessor number/ID, manager locator, launch/start/cutoff/upload deadline, timezone and server as-of time. Census and exact-sale lists occupy full width below. Table columns remain readable; a review uses original/proposed columns like Settings. Required reason and primary confirm sit after all evidence, with secondary Keep reviewing/Cancel. Do not bury exclusions in the ranking table.

**Phone, 390 and 360 px:** reuse the existing responsive admin shell/navigation. One vertical column: title/back link, notice, campaign context, evidence, reason, review/actions. Census rows become labelled phone cards; each has label, inventory ID, all account partitions, state and actions. Exact-sale comparison becomes one card per purchase with the same fields as desktop, no hidden columns. Long IDs wrap in mono text; full reasons wrap without clipping. Paginated lists have explicit Previous/Next controls and an incomplete-loading notice. Full-width action buttons stack, primary first; no fixed footer covering the last row or keyboard. Desktop tables may scroll within a labelled region, never force whole-page horizontal scrolling.

Use vendored tokens and `wr-` components: PageHead, Sheet, Notice, KeyValueList, DataTable, TextField/Reason, Button and existing status styles. State text and icon accompany colour; no new palette or typography. Controls have 48 px targets at phone widths (44 px absolute floor), visible token focus, semantic labels and described-by errors. Focus the error summary on refusal; announce loading/success through a polite live region. Confirmation never auto-submits on selection. Do not store phone inventory, reasons, purchase evidence or drafts in localStorage, IndexedDB, service worker caches or URLs.

Exact copy below uses `{…}` only for validated server values or explicitly labelled local draft values. Production never imports board sample people, dates, ranks, spend or reasons. Audit/actor times use Africa/Lagos (`21 Oct 2026 · 10:42 AM` style); campaign boundaries also show selected campaign timezone, offset, exact seconds/fraction and UTC instant as Settings does, so minute formatting cannot move a deadline. Litres and kilograms remain separate; money uses exact kobo formatting, e.g. `₦20,000.00`.

## Authority and manager designation

| Person / action | Required live authority as merged |
|---|---|
| Read rankings/readiness/saved results | `leaderboards` |
| Read census, required attendants, exclusions, phone checks/entries | `leaderboards` AND `sales` |
| Designate manager | Current Owner AND `settings` AND `sales`; target enabled admin/role, password changed, verified canonical person, `sales` + `leaderboards` + kind-specific action grant |
| Save census, propose unavailable, certify complete phone check | Named manager, verified person, `sales` + `leaderboards` + `giveawayFinalize` for initial or `giveawayRevise` for revision |
| Approve/reject unavailable | Same three grants for proposal kind, verified canonically different person from proposer; proposer must remain current authorized manager |
| Prepare/save result | `leaderboards` + relevant finalize/revise grant; this does not itself confer phone access or manager authority |

Owner status supplies no checklist or independent-approval bypass. Finalize never grants revise. Do not infer independence from different account IDs/names/emails; canonical person IDs stay private and server-enforced. No new Manager role preset. Session/permission changes remove protected content and drafts through the existing epoch guard; server authorizes reads, writes and replay.

Manager sheet title: “Campaign station manager”. Empty: “No campaign station manager is designated. An Owner must designate an authorized admin before phone checks can be recorded.” Existing: “Designated manager: {authorized name or admin ID}”. If identity detail is not authorized/available, use “Admin {ID}”; no invented name. Non-Owner explanation: “Only an Owner with settings and sales permissions can designate the campaign station manager.” Read-only context is allowed only through authorized endpoints.

Form labels: “Campaign station manager”, “Reason for designation”. Help: “Choose the person responsible for the complete phone census. Designation does not grant permissions.” Review title “Review manager designation”; show current manager / proposed manager and reason, with warning “Changing the manager makes existing phone checks and pending unavailable-phone proposals unusable.” Buttons: “Review designation”, then “Confirm designation” / “Keep reviewing” / “Cancel”. POST `reconciliation/manager` sends operationId, expected campaign version, managerAdminId, reason. Success: “Campaign station manager designated. Review the phone census before recording a new phone check.”

No eligible target: “No eligible manager is available. An Owner must arrange the required permissions and verified person identity.” `manager_invalid`: “This admin cannot be designated for this campaign action. Refresh the admin details and choose an eligible manager.” `owner_required`/permission refusal: “Your current permissions do not allow this action.” Selection discovery depends on authorized directory reads; do not enumerate users through failed POSTs. Missing identity/grant discovery is question Q3 below.

## Complete phone census, including leavers

Title “Phone census”. Intro: “List every physical phone used for campaign sales and every attendant account used on it, including leavers, disabled accounts and replacement phones. Server records cannot discover sales that are still only on a phone.” Subtitle “Unsent sales on phones: unknown until inspected.” Never render an unknown queue count as zero.

Load every page of `reconciliation/phones` and `reconciliation/required-attendants`; compare their census ID/version and data version. The merged required list is conservative: all station assignment and purchase history, not just currently active staff or a browser-filtered date range. Retain all returned accounts. Include additional relevant phones known to the manager; one account may appear on several phones and one phone may have several account partitions. IDs identify inventory/accounts, not device credentials or remote origin proof.

Census table/card fields: “Phone label”, “Inventory ID” (new row: “Assigned when saved”), “Attendant accounts”, “Inspection status”, “Actions”. Account chips show an authorized staff code/name when available, otherwise full account ID; an ID-only required-account response does not prove active/leaver status. If an existing directory supplies it, retain “Assignment ended”/“Disabled” as context, never as a filter. Help: “Use a station label such as ‘Pump 1 handset’. Do not enter a phone number, IMEI, serial number or secret.” No customer phone numbers appear.

Form actions “Add phone”, “Add attendant account”, “Remove draft row”, “Review census”. Each phone needs 1–100 account IDs; 1–100 phone rows; labels 1–80 characters, required privacy-validated reason 1–1000 characters. Enforce uniqueness within a row and saved phone IDs. Do not prevent the legitimate same account on multiple phones. No silent truncation or chunked certification past the 32 KiB HTTP body limit. Empty inventory cannot be certified by the merged schema; show “Add every phone used for sales. An empty census cannot be recorded.”

Coverage summary: “{N} required accounts covered” only after all pages load and every required ID is covered; otherwise “Census incomplete. Add a phone for every missing account.” Missing IDs listed in full. Extra/erroneous/duplicate rows must be deliberately reviewed, not discarded automatically. Replacement review shows retained, added, changed and removed rows and the reason; warning “This replaces the current census and requires a new phone check. Earlier evidence is retained.” Removing a saved row is proposed replacement, never a delete call or a way to evade required-account coverage.

Review title “Review phone census”; local attestation text “I have included every relevant phone and account partition, including phones used by staff who have left.” This is an explicit local confirmation of the human inspection scope, not a server `complete` flag. POST `reconciliation/censuses` sends the complete phones array and the schema's kind, reason, census version and CampaignGuard. Success “Phone census recorded. Inspect every listed phone or obtain independent approval for its unavailability.” No census/check mutation until server time is strictly after upload deadline; local form may be drafted beforehand. Before then: “Phone checks can be recorded after the upload deadline: {exact deadline}.”

## Per-phone inspection and certification

| Server / local state | Exact visible copy | Action and consequence |
|---|---|---|
| `unchecked` | “Pending inspection” · “No current phone check covers this phone.” | Manager: inspect all listed partitions or Propose phone unavailable |
| Local inspected draft | “Checked on this phone census · not recorded” | May edit before submitting the complete check; never display as saved |
| `empty` with overall current complete check | “Checked · nothing remains unsent” | Show manager and checkedAt from phone-check read; view evidence |
| `unavailable_pending` | “Phone unavailable · awaiting independent decision” | View proposal; blocks certification and preparation |
| `unavailable_approved` | “Phone unavailable · exclusion approved” | View exact decision; still requires a current complete phone check |
| Rejected proposal | “Phone unavailable proposal rejected. Inspect this phone or submit a new proposal.” | Retained history, phone returns to pending inspection |
| Superseded/stale evidence | “Earlier evidence is stale. Review this phone again.” | History stays read-only; never reuse an old approval automatically |

Overall phoneCheck.state (`missing`, `stale`, `complete`) controls current certification, even if a row still reads approved. Show “Approval recorded; current phone check required” when appropriate. `empty` means no unsent originals, photos or corrections remain in every relevant account partition, including leavers; it does not mean the phone had no sales. Inspect physically using authorized access. This UI grants no cross-account outbox access, sign-in impersonation or recovery authority. Use the existing recovery process separately when authorized.

Manager selection labels: “Inspected · nothing remains unsent” or “Unavailable · approved proposal {ID}”. Pending/rejected/superseded proposals cannot be selected as approved. If uploads remain: “Sales or photos remain unsent. Resolve them through the authorized upload or recovery process, then inspect again.” No checkbox can waive server-known work.

Bottom review: “Review complete phone check”; show every phone and every account partition, result and exact exclusion link; required “Phone-check reason”. Buttons “Record complete phone check”, “Keep reviewing”, “Cancel”. POST `reconciliation/phone-checks` submits all entries atomically (phoneId, expectedPhoneVersion, result empty/unavailable, exclusionId null/approved ID), common guards/kind/reason. No individual per-phone save endpoint exists. Explain “Inspection selections are a draft until the complete phone check is recorded.” A pending exclusion anywhere prevents save. Success “Phone check recorded. Run the finalization checklist to review a snapshot.” Refresh readiness from server; do not label reconciliation passed yet.

## Phone unavailable: exact proposal and independent decision

Manager entry “Propose phone unavailable”. Title “Phone unavailable”. Warning: “This proposal does not cancel or delete sales. A different authorized person must approve it. Other reviews still block finalization.” Show phone label/ID, complete account list, action kind, census version, timing/deadline, predecessor and current manager. Required “Why is this phone unavailable?” Help “Explain why the phone cannot be inspected. Do not include phone numbers, credentials or private customer information.”

Two separate sections:

1. “Sales still only on the phone” — “The number and value are unknown. Approval leaves these unsent originals out of the future campaign result; it creates no sale records.” Do not enter estimates or a manufactured zero.
2. “Exact incomplete sales received by the server” — select exact purchase IDs and expected versions through authorized sales lookup/detail, not an account-wide exclusion. No accepted revision and no trusted complete-byte observation may exist. Sales must originate in a listed account partition; phone attribution is the manager's attestation checked by the second person. Do not claim the server proves device origin. Empty list copy: “No server-known incomplete sales are listed in this proposal.” This does not assert that none exist.

Each selected sale shows full purchase ID/version, originating attendant ID, current state, details received time, exact amount/currency, quantity/unit, and “Phone attribution: attested by the manager”. Desktop uses a table; phone uses labelled cards with all fields and remove-from-draft control. Show “No accepted revision; no trusted complete-photo receipt” only when supported by returned evidence; otherwise “Eligibility for this exclusion will be checked by the server.” Existing sales detail alone must not be treated as proof of an absent receipt observation. At most 100 exact sources and 100 accounts within body bounds; no partial list approval or silent omissions.

Review title “Review unavailable-phone proposal”. Render the full frozen phone/account/source list and reason, not just a count. Consequence: “If approved, only the unfinished-upload obligation for these exact incomplete sales is suppressed. Holds, corrections, duplicates, eligibility reviews and two-person release proposals still block. Accepted sales cannot be excluded.” Buttons “Submit for independent approval” / “Keep reviewing” / “Cancel”. POST `reconciliation/phones/:phoneId/exclusions` with common guards, expectedPhoneVersion, partialSources of purchaseId/expectedPurchaseVersion. Server response is authoritative; receipt detail supplies immutable attendant snapshots and all source fields. Success “Phone unavailable proposal recorded. A different authorized person must approve or reject it.” Pending remains blocking.

Independent detail must be reachable from the phone census's “Unavailable-phone proposals” list, loading every page of `reconciliation/exclusions` (no pending-only server filter). Detail GET `reconciliation/exclusions/:exclusionId` is the source of reviewed content. Header “Review unavailable-phone proposal”; read-only phone/account snapshots, exact incomplete sources, kind, predecessor, proposal ID/version, proposer/name/time/reason, and relevant pins. Do not rebuild from the latest census or current staff labels. History shows proposer and deciding actor, both reasons and trusted times; undecided fields say “Not decided”, not an invented approver. General audit links remain permission-gated and do not expose protected phone evidence.

Decision label “Decision”; choices “Approve phone unavailability” / “Reject proposal”; required “Decision reason”. Help “Review the phone attribution and every listed incomplete sale. A different account belonging to the same person cannot approve or reject.” Buttons “Review decision”, then “Confirm approval” or “Confirm rejection”, with Keep reviewing/Cancel. Final POST `reconciliation/exclusions/:exclusionId/decision` sends frozen operationId, expected exclusion version, decision, reason. No CampaignGuard is added to this strict request.

Approve success: “Phone unavailability approved. Record a current complete phone check before preparing the result.” Reject success: “Proposal rejected. This phone still needs inspection or a new proposal.” Same-person/unbound refusal: “A different verified person with the required permissions must decide this proposal.” Stale: “This proposal no longer applies. Review the current phone census and submit a new proposal if needed.” If already terminal, show the recorded outcome and both actors/reasons; no further decision buttons. A new proposal after rejection is a new explicit request, never editing history. No notification, email or automatic reassignment is implied.

## Nine checklist outcomes and honest readiness

Heading “Finalization checklist”. Intro “These checks use server records and the manager's recorded phone evidence. A reason alone cannot pass a check.” These are outcomes, not nine user-tickable boxes. Display all nine rows at desktop and as labelled stacked rows on phone. Each has outcome, explanation and authorized resolution link. `Blocked` means returned blocker; `Not separately reported` means the API does not distinguish it. Never turn absence of a granular count into a reported zero or claim to have fetched an internal reconciliation record.

| Check | Exact clear/preparation-success explanation | Blocked or unavailable copy / destination |
|---|---|---|
| `timing` — Campaign timing | “Purchase cutoff and upload deadline have passed.” | “Campaign values are not configured.” → Settings; “Purchase cutoff has not passed.” / “Upload grace period is still open.” → show exact bounds; “Campaign timing policy is not configured.” → Owner/support |
| `holds` — Held sales | “Held-sale checks passed during preparation.” | “Held sales or related release proposals need review.” → Sales; counts.holds is a union, not a count of ordinary holds alone |
| `corrections` — Corrections | “Correction checks passed during preparation.” | “{count} sales have unresolved corrections.” → Sales late-correction queue |
| `duplicates` — Possible duplicates | “Duplicate checks passed during preparation.” | “{count} sales have unresolved duplicate flags.” → Sales duplicate queue; accepted flagged sales still count live |
| `two_person_proposals` — Two-person release proposals | “Two-person release checks passed during preparation.” | “Unresolved release proposals block this result, including stale proposals and proposals under inactive policy.” → existing release review/discovery; separate count “Not separately reported” |
| `uploads` — Incomplete uploads | “Upload checks passed during preparation, including approved exact exclusions.” | “{count} server-known sales need upload or photo-evidence resolution.” → Sales incomplete queue; not an estimate of phones' queues |
| `complete_photo_deadline` — Complete-photo deadline | “Complete-photo deadline checks passed during preparation.” | “Complete-photo receipt and unfinished uploads are reported together. Review the affected sales.” → Sales; separate count “Not separately reported” |
| `eligibility` — Campaign eligibility | “Campaign eligibility checks passed during preparation.” | “Campaign eligibility remains unresolved.” → relevant Sales review; counts.policyBlocks is not an independent eligibility-total count |
| `phone_census` — Phone census and checks | “Current phone census and inspection/exclusion checks passed.” | “Record the complete phone census and check.” / “Phone evidence is stale.” / “{count} unavailable-phone proposals await a decision.” → phone census |

The merged readiness response has five counts (holds, corrections, duplicateFlags, uploads, policyBlocks), blocker codes, phoneCheck, canPrepare/canConfirm and policy version. It does **not** expose the stored nine-check array, separate P-29 count or separate complete-photo count. Before successful preparation, granular rows without direct proof show “Not separately reported”; a grouped `reviews_unresolved` notice stays visible even when the five visible counts seem clear. Do not sum overlapping counts into “outstanding sales”. Missing reconciliation policy: “Finalization checklist policy is not configured. An Owner must arrange configuration; no check can be certified.” Health configuration is not a per-campaign pass.

After a successful new preparation, its atomic success guarantees all nine checks passed for that preview/unchanged receipt. Show the clear explanations as “Passed during preparation”, bound to returned reconciliationId, phoneCheckId and sourceDataVersion; no fabricated checked counts. On reopening a frozen preview, label those as historical preparation outcomes, not fresh readiness. If the product needs separately reported blocked/checked outcomes before preparation, Q2 requires a core follow-up; Stage 2 must not invent that endpoint.

For any intended contribution, details receipt and trusted complete-byte receipt must each be at or before the deadline; validation may finish later. Later validation/PUT acknowledgement/client time is no substitute for byte receipt. Missing proof stays unresolved; proven late originals remain retained and excluded after other reviews clear. Approved exact incomplete exclusions waive only their upload obligation, never human blockers or evidence for included sources.

`reconciliation_required` alone: “Server reconciliation must be run for the current records.” Respect canPrepare: it may be true while canConfirm=false. Button “Review final snapshot” (initial) / “Prepare audited revision” (revision) sends preparation with required reason and current guards. Do not disable solely for the dirty marker. Before preparing, show full exact campaign timing and current phone evidence. No browser countdown enables actions. A readiness response is not a final confirmation guarantee.

## Stale evidence, retries and E04/E03 transitions

| Event | Copy and next action |
|---|---|
| Loading/read failure | “Loading finalization evidence…” / “Finalization evidence could not be loaded. Retry.” No sample data or passed checks; preserve only authorized in-memory drafts |
| Read pagination generation changes | “Records changed while this list was loading. Refresh the complete list before reviewing.” Discard the page chain and local certification choices; reload all pages |
| New data, manager, census, timing/policy, predecessor or targeted sale/evidence change | “Evidence has changed since this review. Refresh and review again.” Keep earlier evidence read-only; clear derived current-pass claims and require explicit new review/guards |
| Phone check missing/stale | “A current complete phone check is required.” / “Phone evidence is stale. Recheck every phone against the current census.” No automatic reuse based on row colour |
| Recovered phone | “This phone is available again. Record a new census and phone check.” Normal authorized upload/recovery and validation apply; old decisions/results stay frozen |
| `census_incomplete` | “The census or phone check is incomplete. Cover every required account and every listed phone.” Return to relevant fields, never assume missing means empty |
| `exclusion_source_invalid` | “A listed sale cannot be excluded. Review its current version, originating account and evidence.” Remove only after explicit review; no blanket exclusion |
| `exclusion_pending` / `phone_exclusion_pending` | “An unavailable-phone proposal is awaiting a decision.” Open the retained proposal |
| `phone_check_stale`, `exclusion_stale`, `version_conflict`, `snapshot_superseded` | “This review is out of date. Refresh the evidence and review again.” Never silently substitute latest versions |
| 413 | “This evidence is too large to record in one request. Nothing has been certified by this attempt. Contact support.” No chunking, truncation or invented success |
| Definitive permission/session refusal | “Your current permissions do not allow this action.” Clear protected state via session handling; sign in again when required |
| Network failure, malformed success, 429/503 after POST | “The result of this request is uncertain. Retry the same request before starting another change.” Retain exact body/key in session memory, disable conflicting edits and duplicate submissions |
| `operation_conflict` | “This request ID was used for different content. Stop and reload the recorded result before making another change.” Never auto-generate a replacement key to repeat an uncertain effect |
| 404 | “This record is unavailable.” No existence/other-station detail |

Every mutation freezes its request immediately before sending and retries the same key/body on uncertainty. Navigation within the same authorized session retains pending state like Settings; sign-out/account or authority change clears protected state. After reload or another account, do not recreate a lost pending request from guesses: re-read saved evidence/history and resolve any uncertainty before starting a new change. A matching authorized replay displays the historical receipt as historical, then separately refreshes current readiness. A replay is not a new current certification.

E04 shows “Snapshot preview · not saved”, frozen rows/totals/exclusions, reason, creator, expiry, timing, predecessor and evidence IDs. `canConfirm` and exact matching owned preview are necessary; preview cannot be consumed by a second admin. “Keep reviewing”/Cancel saves no snapshot. Preparation itself already recorded reconciliation; copy must not claim it saved nothing at all. Confirm label “Confirm and save snapshot”; revision label “Confirm and save revision”. On preview_stale/expired/used/mismatch or finalization_blocked: “This preview can no longer be confirmed. Refresh the checks and prepare a new preview.” Retain the uncertain frozen request until resolved before taking this definitive-refusal path.

A successful unchanged revision preparation says “Reconciliation recorded. The saved result is unchanged; no new snapshot was created.” Link to currentSnapshotId. Do not render E04 confirm for this receipt. A successful snapshot receipt says “Snapshot {number} saved.” E03 shows its immutable names, ranks, sources and lineage; selecting an older result never re-filters it using the current census. Later source changes require new authorized revision preparation; even identical money can require a new result when accepted revision lineage changes. A new predecessor requires fresh census and independent exclusion approval for unavailable phones. No prize allocation or announcement action is added.

## Open questions for Earl and Rook

All recommendations below are proposals dated 16 November 2026. No answer is assumed from merging this document. Stage 2 remains stopped until Earl approves the brief.

| ID | Question and alternatives | Recommendation / safe default |
|---|---|---|
| Q1 (Q-576; WHR-158) | Which real verified people will be campaign manager and independent approver? A: Whales names two different people with required kind-specific grants; B: defer operational certification until names are supplied. | Recommend A before pilot. Default B: no seeded names, no bypass, keep certification blocked while people/bindings are missing. Record identities through authorized administration, not public repo text. |
| Q2 | Is grouped readiness with nine named rows and explicit “Not separately reported” acceptable, or must all nine blocked/checked outcomes be separately inspectable before preparation? A: accept truthful grouped presentation against b4dcc7b; B: commission a core projection for the stored checks and granular unresolved outcomes. | Recommend B for full operational clarity. Default A only as a proposed layout in this brief; do not claim granular evidence exists. Earl must choose before Stage 2 acceptance criteria are finalized; no endpoint change in WHR-23. |
| Q3 | How should limited-permission staff select managers, historical accounts and exact incomplete sources when existing authorized directories do not expose eligibility/receipt facts? A: use permitted directory/sales reads, ID fallback and server validation; missing prerequisites block the form. B: commission narrow eligible-manager/account/source projections in a core follow-up. | Recommend B so entry is usable without extra directory grants and source absence is not guessed. Default A in the proposal: no broader permissions, failed-POST enumeration, remote phone-origin claim or fabricated eligibility. Assess each existing projection during Stage 2 planning. |
| Q4 | Does approval of this written responsive design authorize building the added P-30 states, or are additional hi-fi boards required? A: approve this brief's exact copy/layouts for E02/E04 extensions; B: obtain added boards before implementation. | Recommend A with 1440/390/360 verification against this brief and existing shell. Default: no Stage 2 build until Earl explicitly approves A or supplies B. Existing E01–E04 fidelity remains required separately. |

## Stage 2 verification handoff (not executed by Stage 1)

Use real-stack tests for Owner/manager/approver permutations, revoked authority and alias-person refusal; leavers/disabled/multiple phones and partitions; incomplete/duplicate/missing rows and pages; pending/rejected/superseded exclusion; exact partial IDs, accepted/complete-byte source refusal and retained other blockers; request bounds without truncation; unknown phone-only totals; P-29 inactive/stale blockers; deadline equality and new-data races; missing/stale checks and guard conflicts; same-key replay/uncertain result/navigation; unchanged reconciliation versus changed lineage; immutable historical results and recovered phones. Test direct URLs, keyboard/error focus and layouts at 1440, 390 and 360 px. These are future build obligations, not claims of passing tests or new board parity.
