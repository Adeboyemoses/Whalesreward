# Attendant row 4: Register a customer

Boards: A06-Register, A25-RegisterDuplicatePhone, A07-RegisterSuccess; A24 entry integration. Feature: F02/F03. Invariants: I-02, I-06, I-14–I-19, I-49/I-50.
Decision note: product-docs/04 UI Design/Attendant Mobile/Customer Registration Screen Decisions.md. HTML structure and PNGs inspected before dispatch.

| Board | Route | Components (src/ui) | Reads (contract) | Writes (contract) | States | Permission |
|---|---|---|---|---|---|---|
| A06 | /attendant/register | AppHeader, TextField, Button, BottomNav | own ready session | POST /api/attendant/customers | empty/filled, category selection, camera scan/typed code, offline, invalid, submitting, uncertain retry, expired/revoked | own online ready attendant |
| A25 | same page | Notice danger, invalid phone, action bar | POST /api/attendant/customers/lookup, current card lookup | none while duplicate | duplicate, lookup pending/failed, usable/unusable/no active card, phone edited | same |
| A07 | /attendant/register/:customerId/done | ResultBlock, LoyaltyCard, KeyValueList | immediate registration receipt; current card lookup before sale | none | success, historical replay, missing receipt after reload, register another | same originating account |
| A24 | /attendant/sale | existing sale customer notice/link | existing card lookup | none | unknown card entry to Register, return after fresh lookup | existing capture rules |

## Behaviour
- Online only; name/phone/fixed category/card are one atomic server registration. Six categories map to the closed contract enum. The selector uses six large labelled options. No OTP, recovery, number change or replacement flow.
- Use strict typed HTTP response parsing from the existing browser-safe shared schemas. Card scan uses the existing live camera scanner; no demo fill or gallery. Typed and scanned sources use the shared card parser. Do not use sale-card lookup as a registration eligibility preflight: an unassigned eligible card has no customer yet.
- Freeze the submitted normalized content and operation ID in memory under the current account/session generation. Double-click guard; uncertain response permits deliberate same-body/key retry, never automatic new-ID submission. Edits after an uncertain send must not silently create a second operation; retain clear retry/discard guidance. Definitive conflicts require new review/input after reread.
- Duplicate error supplies no existing identity. Obtain A25 details only through separate exact-phone lookup; an unsuccessful lookup cannot invent a customer. The candidate card remains unassigned by the failed atomic operation; no global claim about later unrelated linkage.
- Receipt is historical. Before either existing/new customer enters sale, fresh card lookup must return the matching current customer and usable card. Never authorize from a receipt, name, cached phone lookup or old card. Null/unusable card directs to a manager.
- PII drafts/searches/receipt live only in memory, not URL parameters, Dexie, local/session storage, SW or logs. Clear on completion when leaving the result, Register another, logout, authority denial, session/account switch and unmount. No receipt reconstruction from route ID or another account. Use a safe missing-receipt state after reload.
- Preserve original outboxes, sign-in windows and capture context; registration cannot refresh the 24-hour anchor. Restricted first-password sessions cannot enter registration. A definitive auth refusal uses the existing access-lock path, retaining original queues/photos while hiding PII.
- Generic route shells may be precached so offline Register shows Connect to register. Never cache API responses or customer-bearing RSC/HTML. Preserve the existing SW denylist/partition rules.

## Copy
Register customer; Internet required; Fixed at registration; One account per phone number.; Register and link card; Connect to register; This phone number already has an account.; Card linked; Register another customer. The success sentence states the next-sale consequence, never claims a purchase was credited. Category display labels follow the board: Car owner, Commercial bus, Three-wheeler, Bike, Keg buyer, Cooking gas.

## Contracts needed
Existing registrationSchema/registrationReceiptSchema, phoneLookupSchema/customerLookupSchema, categorySchema and M1 card lookup; UUIDv7 operation ID. Names/phones travel in POST bodies with no-store, never query strings. All required APIs are merged through Core #81; no contract changes needed.

## Open questions
None blocking. D08 numbering is a server configuration gate: display phone_policy_unconfigured safely; use fictional local policy for tests, never configure staging/production. Dedicated uncertainty/revocation/scanner states use existing components and are declared additions in parity.
