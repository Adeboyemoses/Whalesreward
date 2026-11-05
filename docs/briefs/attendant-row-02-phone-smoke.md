# Attendant rows 02, 03 and 06: phone-smoke fixes

Boards: A02 → A03 → A04; A05 → A08; A16. Features F01/F04/F05. Invariants I-03, I-06, I-09, I-22, I-23, I-26, I-29, I-49. Work order WO-app-3b (WHR-65).

Read with the existing row 02, row 03 upload-sync and row 06 briefs. All six PNGs and HTML inspected on 5 November 2026. Behaviour source: Attendant Sale Screen Decisions and Attendant Connected Flow Notes, including their 4 November hi-fi sections. Earl's 5 November work order adds sale references to the older boards.

| Board | Route | Components | Reads | Writes | States | Permission |
|---|---|---|---|---|---|---|
| A02/A03 | /attendant/sale | Frame, TextField, segmented controls, camera, Button | local session/window, captured price, lookup | atomic original sale and photo | local checking; active empty/filled; offline; expired/revoked; invalid amount; saving/error | originating valid capture context |
| A04/A16 | /attendant/sale/:operationId/recorded | ResultBlock, KeyValueList, Button | own original and authoritative SaleStatus | background status refresh | loading; saved; credited; held; cancelled; gas Cylinder | originating account only |
| A05 | same receipt route | Notice, KeyValueList, Button | own durable original/photo | none before next capture | pending/offline; reference pending; expired | originating account only |
| A08 | /attendant/uploads | ListRow, Notice, StatusPill | own queue and authoritative SaleStatus | existing retry protocol | pending; partial/failed; uploading; held; cancelled; empty; offline/expired | existing same-account upload authorization |

## Behaviour

- Measure staging before application edits. Save-to-receipt and next-sale-to-form must take at most 2 seconds in controlled 3G and offline conditions, after the shell is installed. Local durable save remains the prerequisite for a saved receipt.
- Validate the durable local window first; revalidate online in the background. Keep the original 24-hour anchor, monotonic/time-rollback safeguards, expiry, known revocation and context/account checks. Successful delayed revalidation must not unlock a locked context or replace a newer sign-in. No server changes.
- Generic attendant navigation falls back to the precached shell after a short, documented deadline. Never cache API/customer/auth responses or swallow authoritative access rejection.
- The Online/Offline pill responds to browser events and request outcomes within about 2 seconds. Connectivity is not authorization or proof of upload/credit.
- Add “Sale reference” in the existing receipt summary using the authoritative server sale code, in mono text. A saved-on-phone receipt says “Reference after upload”. Upload rows show the assigned server code when available. Never substitute operation IDs or fabricate a reference; status/credit wording stays authoritative.
- Amount input formats on blur as `20,000.00` while retaining its exact raw decimal value for calculation and save. Reject excess decimals without rounding. Editing, focus, blur, switching and next-sale reset must preserve existing semantics; quantity mode and T-10 stay unchanged.

## Copy and board deviations

“Reference after upload” and “Sale reference” are additions explicitly requested by Earl in WHR-65. Keep existing result/loyalty text, fields and 48px actions. Amount grouping matches A03. No unrelated typography, quantity display or history changes.

## Contracts and verification

Use existing M1 Session, OriginalSale, OutboxRow and SaleStatus.saleCode through the typed client. No new contract needed. Tests must cover exact submitted values, PMS/gas receipts, pending/assigned upload references, delayed revalidation and navigation, concurrent upload, expiry, revocation and account isolation. Independent test-engineer checks the changed UI against the boards and records the approved reference addition.

## Open questions

No product ambiguity. Authenticated staging measurement is pending a fictional attendant session; timing/root-cause claims remain pending that run.
