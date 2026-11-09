# Admin row08: Attendants and pump assignment
Boards: D01 → D02 → D04 → D03 → F04 → F09 → F10   Feature: F01   Invariants: I-01/I-04/I-05/I-05a/I-07/I-09/I-41; P-16/P-21
Decision notes: product-docs/04 UI Design/Admin Portal/Admin Attendant Screen Decisions.md and Admin Pump and Price Decisions.md; Decisions Since Handoff9Nov; M2 P-21.
Reviewed all seven PNGs/HTML: sidebar/pagehead, toolbar/field/select/table, sheet/two-col, personal kv, warning/success notice and history list.

| Board | Route | Components | Reads (M2) | Writes | States | Permission |
|---|---|---|---|---|---|---|
| D01 | /admin/attendants | search + pump-filter table | POST attendants/search (body not URL), GET pumps; cursor pages | none | list/filtered/empty/loading/error | attendants |
| D02 | /admin/attendants/new | account form, Show/Hide password, pump select/context | GET pumps all selectable pages | POST attendants {operationId,name,username,password,pumpId,expectedPumpVersion} | blank/invalid/duplicate/policy/busy/uncertain/cancel | attendants |
| D04 | /admin/attendants/:id created | receipt notice + profile | authoritative returned Attendant | none | created; password cleared, never shown again | attendants |
| D03 | /admin/attendants/:id | personal account, assignment, history | GET attendant and assignments | none; Change pump assignment, End assignment actions | configured/fresh_sign_in_required/acknowledged/unassigned/denied | attendants; narrow pump-side context uses candidate projection only |
| F04 | /admin/attendants/:id/assign (also pump-side entry) | selected permanent identity, pump select/reason, context | paginated candidates, pumps, assignment history; avoid unauthorized broad profile/search calls for pumps-only | none | editing/previous assignment/null/invalid/keep editing | attendants OR pumps |
| F09 | .../assign/confirm | frozen old/new kv, warning | reviewed attendant + exact assignment + pump version | POST assignment {operationId,expectedVersion,expectedAssignmentId,pumpId,expectedPumpVersion,reason} | review/confirming/uncertain/conflict/denied/cancel | attendants OR pumps |
| F10 | profile/pump result | server receipt, configured handover status and history | returned attendant/change then current reread | none | recorded, fresh sign-in required; no claim every device updated | attendants OR pumps for authorized projection |
| P-21 contract-driven D03/F09 pattern | profile End assignment, review, result | existing sheet/kv/notice pattern, no new board fidelity claim | current permitted assignment/version | POST assignment/end {operationId,expectedVersion,expectedAssignmentId(nonnull),reason} | reason/review/cancel/uncertain/conflict/unassigned/receipt; later reassignment kept distinct | attendants OR pumps; profile read still requires attendants |

## Behaviour
Creation has no extra reason/review beyond D02 (M2), no prefilled/sample/default password. Exact password12..1024, no control characters, no trim; clear on completion/cancel/navigation/authority change, never persist/log/capture in screenshots. Name/username normalization follows shared schema. Server generates permanent ID and initial assignment atomically. No staff phone, Reset password or Disable account controls (P-16), nor pump deactivation. First-password completion is on the attendant phone (WHR-77).
Reassignment keeps identity and original history/queue; new captures use new pump only after fresh online sign-in with the same account. Admin cannot know unsent queue counts: say “Unknown on this device” with retention explanation, never board's sample2. Do not fetch attendant search/profile with a pumps-only grant: use permitted paginated candidates/pump reads and narrow assignment context. Account navigation still requires attendants.
P-21 uses exact active assignment ID plus attendant version frozen at review. Explain immediate server sign-out on all devices and preserved past/queued sales; disconnected devices learn revocation on reconnect, never imply remote deletion. Confirm sends same key/body on uncertainty; reread/new review/key after guard conflict. Display original receipt's ended interval, actor, reason and trusted time, distinct from a newer current reassignment. Opening history actor/reason remain unchanged; no fabricated ending history event.

## Copy
“Attendants”, “Create attendant”, “Create account”, “Personal account”, “Current pump assignment”, “Change pump assignment”, “Review assignment”, “Confirm assignment”, “Keep editing”, “Fresh online sign-in required”. P-21: “End assignment”, “Review end assignment”, “Confirm end assignment”, “Assignment ended”. Unassigned is explicit; no invented Active flag for unassigned staff. Use manager-help message for inability to sign in.

## Contracts needed
Existing station schemas plus M2 AssignmentEndReceipt typed client validation until WHR-80 exports it. Test-only contract fake first; production HTTP never falls back to fabricated success. After core merge, validate against actual endpoint. Neither grant exposes queues nor grants recovery. Old placeholders and prototype credential/queue claims yield to M2/P-16/P-21.

## Behaviour
- Read docs/engineering/contracts/m2.md as the normative API: live server authority, UUIDv7 operation IDs, exact expected versions, same key/body after an uncertain response. Conflict requires reread/new review/new key; never automatic resubmission.
- Use the accepted persistent admin session/layout and client navigation; protected state and credentials stay in memory and are cleared on authority/account/route changes. Healthy background checks preserve drafts. Late callbacks cannot navigate or restore a departed view.
- Loading stays inline with context; empty/unconfigured, disconnected, stale, rate/permission and malformed-response states are explicit. Paginate server cursors, preserving filters; picker completeness must not be limited silently to the first25.
- Use vendored design tokens and wr- classes; table scrolling inside cards, responsive1440/390, real labelled controls/focus and wrapped long text. Server time formatted in Africa/Lagos; exact money through src/shared/money.ts.

## Open questions
None blocking: approved work order, P-16/P-21 and M2 settle behaviour. Product folder Decisions Since Handoff supersedes older prototype caveats. No new permissions or policy invented.
