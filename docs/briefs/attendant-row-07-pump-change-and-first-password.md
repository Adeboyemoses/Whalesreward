# Attendant row07: Pump change, with required access states
Boards: A17 (390px); retained A01/A26/A12/A13 patterns   Feature: F01   Invariants: I-01/I-02/I-03/I-04/I-05/I-05a/I-06/I-09/I-49; WHR-77/P-21
Decision note: product-docs/04 UI Design/Attendant Mobile/Sign In and Handover Screen Decisions.md; newer Decisions Since Handoff9Nov and M2 first-password/P-21 contracts.
Reviewed A17 PNG and HTML plus accepted row01 implementation brief. New first-password/no-assignment states have no dedicated hi-fi board; use the existing static sign-in shell/form and Notice/KeyValueList patterns, with contract-driven behaviour and no invented screenshot match.

| Board/state | Route | Components | Reads | Writes | States | Authority |
|---|---|---|---|---|---|---|
| A17 | /attendant/account | Frame, person card, warning, current/new kv, actionbar | GET configured-assignment; own ready session; own local queue only | sign-out via existing guarded handover | pending/changed/offline/read failure/none; target pump shown without rewriting current session | own live ready attendant |
| WHR-77 restricted | sign-in first-password state or static first-password route | existing labelled/password/show-hide controls;48px phone | sign-in/session discriminated restricted shape with no assignment/capture | POST first-password {operationId,currentPassword,newPassword,confirmPassword},204 | online/offline/policy/mismatch/expired/revoked/uncertain/success requires fresh sign-in | own live restricted cookie only |
| P-21 unavailable | sign-in/account locked state | generic manager-help notice, normal sign-in shell |422 assignment_unavailable or revoked401 on next protected request | no capture or upload | unassigned/revoked/offline detection delayed | server denial; local originals preserved |

## Behaviour
Parse restricted auth separately from ready Session: never persist it, start/renew offline anchor, expose prior-account data, request configuration or allow capture/upload. Reload rechecks restricted cookie online. First-password uses exact no-control current/new fields, preserves spaces/Unicode, new12..1024 and confirmation; no logging/storage/trace. Clear form/visibility on success, cancel, unmount/authority change.204 clears/revokes cookie and returns to fresh online sign-in; never adopt a ready session from completion or resume captures before that sign-in. Stale responses cannot restore another session.
A17 reads configured target independently; shows current acknowledged pump versus configured pump/product, own original queue/count and required same-account online sign-in. Use “Sign out to switch pump” through existing upload-first/preserve-queue handover; failed server sign-out keeps logoutPending and cannot adopt a different account. Original operation IDs/photos/assignment/rate/anchors never change.
P-21 denies unassigned sign-in with generic “Sign-in is unavailable. Ask a station manager for help.” Reveal no username/pump/history/reason on that failure. On observed401, lock capture/uploads/account partition and clear visible personal data, keep all originals/blobs. Offline cannot know immediate remote revocation; do not erase records or add fake authority/recovery. No recovery implementation added.

## Copy
A17 “New pump assigned”, “Sign out to switch pump”, “Pending sales keep their original details”. Restricted “Change your first password”, “Current password”, “New password”, “Confirm new password”; success explains “Sign in online again before recording sales.” Password-help copy must not promise a reset control excluded by P-16; ask a manager for help.

## Contracts needed
M2 restricted response: state=password_change_required, account{id,staffCode,name,username},sessionExpiresAt,serverTime. Ready M1 schema stays unchanged. configured-assignment gives configured,acknowledgedAssignmentId,reassignmentRequiresSignIn. First-password204; P-21 generic422 then revoked cookies401. Keep backwards compatibility in test fakes; no service-worker cache of responses/credentials/admin data. No product or configuration selector per sale.

## Open questions
None blocking; these required states are explicitly approved in WHR-11/WHR-77/P-21. Closest existing design patterns apply where no dedicated board exists; record limitations in parity report.
