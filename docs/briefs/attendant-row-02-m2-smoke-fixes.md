# Attendant rows 2, 4 and 7: M2 smoke corrections

Boards: A24 → A06 → A07; A17 warning extended across attendant screens by WHR-92. Features: F01/F02/F03. Invariants: I-02/I-03/I-05/I-06/I-16/I-19/I-23/I-49/I-50.

Read alongside accepted row-02 online sale, row-04 registration and row-07 pump-change briefs. A24/A06/A07/A17 PNG and HTML inspected. Sources: Customer Registration Screen Decisions.md and Sign In and Handover Screen Decisions.md; WHR-92 overrides the Account-only placement of A17.

| Board/state | Route | Components | Reads | Writes | States | Authority |
|---|---|---|---|---|---|---|
| A24 | /attendant/sale | Frame, TextField, Notice, Button | M1 exact code/QR lookup | none | authoritative not-found, invalid format, unavailable, network, offline, finding | originating attendant session |
| A06/A07 | /attendant/register and existing result route | existing registration form/result | existing session and fresh lookup before sale | existing atomic registration only | optional card prefill, existing invalid/offline/conflict/uncertain/success states | unchanged server eligibility |
| A17 warning | every attendant screen through shared runtime | existing warning Notice | current session/configured-assignment | no assignment rewrite or automatic sign-out | changed, offline, pending refresh, fresh sign-in clears | same live capture context |

## Behaviour

- Only authoritative customer_not_found offers Register this customer. Keep the working form route; investigate why the reported result did not reach that state before changing it. Invalid card format displays its validation error and must not imply a lookup established registration is needed. Network and unavailable-card errors retain their own meanings.
- Optional typed/scanned code carry-forward uses account-scoped memory only, cleared on authority/session changes; never put customer drafts in URL parameters or browser persistence. It is a candidate field value, never proof of eligibility. Existing server registration validates active, unassigned, non-retired inventory atomically.
- Extend A17's persistent warning using shared presentation, visible until fresh online sign-in. Preserve current capture context and all queued rows. A newly observed assignment must not overwrite the old pump/product/rate or renew offline access.
- The notice must not navigate, sign out, disable or interrupt a save already in progress. Keep the existing explicit handover path. Guard late asynchronous reads against account/session changes. Reuse existing tokens/classes and phone targets.

## Copy

Register this customer; Enter the seven-character code printed on the card; Your pump assignment has changed; Sign out and sign in online with your own account before using the new pump. Pending sales keep their original details.

The persistent cross-screen A17 placement is an approved WHR-92 addition. Its exact layout has no dedicated board; use the existing warning style at 390 px. No server validation, credit, capture interval or service-worker change is in this slice.

## Contracts needed

Existing ClientError codes, normalizeCardCode, Lookup, Session and ConfiguredAssignment contracts. No new contract proposed.

## Open questions

None. s02 is investigated first; a server-side cause stops this work order with evidence for T1 before implementing these UI changes.
