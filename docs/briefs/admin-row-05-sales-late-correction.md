# Admin row 5: Sales and late correction review
Boards in scope: B03, B04, S01. Other exception screens belong to WO-app-8.
Feature: F05/F06. Invariants: I-07, I-29, I-37, I-39, I-41, I-48, I-49.
Decision note: product-docs/04 UI Design/Admin Portal/Admin Sales Screen Decisions.md. Normative amendments: M3 P-19/P-22.

| Board | Route | Components (src/ui) | Reads | Writes | States | Permission |
|---|---|---|---|---|---|---|
| B03 | /admin/sales | Sidebar, DataTable, TextField, StatusPill, Notice | salePageSchema via saleFilterSchema POST | search only | loading, empty, error, all status/day/query/customer filters, cursor pages, whole-filter summary | sales |
| B04 | /admin/sales/:saleId | KeyValueList, StatusPill, Notice | saleDetailSchema, paged revisions/corrections/decisions/duplicateFlags; fresh photoAccessSchema | photo access only | loading, error, original/effective values, flags/holds/proposals, pending/deleted/unavailable/validated evidence | sales |
| S01 | /admin/sales/:saleId/late-correction | KeyValueList, TextField, Button, Notice | guarded sale and proposal, current/proposed values, history, photo | correctionDecisionSchema | pending validation, awaiting review, unverified recovery, reason/confirmation, approved/rejected, stale base, closed review, permission refusal, unavailable evidence | sales AND corrections; recovered independent maker |

## Behaviour
- Reuse persistent in-memory portal/session state and client navigation. Fence responses by live admin identity/permissions; no storage persistence. Exact customerId remains in URL/navigation until explicitly cleared. Query searches no phone fields.
- B03 summary is server-provided over the entire filtered set; keep currency and product/unit groups separate. Credits, duplicate flags and correction proposals are independent facts.
- B04 retains original capture context and values alongside effective revisions and complete paginated history. Re-request photo access for each view, no caching/referrer leakage; revoke in-memory blobs on cleanup.
- S01 shows recorded and requested values, unchanged captured rate, originating seller, receipt and cutoff. Require reason then explicit confirmation; Keep reviewing performs no mutation. Freeze decision body and operationId for uncertain retry. Version/base conflicts require fresh review, never blind guard replacement.
- P-19 recovered proposals visibly retain unverified authorship and submittedBy. Server refuses executor and grant authorizer; UI also refuses known executor and explains independent authority. Both approve and reject require the permission conjunction.
- Only server receipts declare outcomes and credit; rejection leaves recorded values. Approval does not promise other holds clear or eligibility.

## Copy and board differences
- Preserve Sales, Purchase details, Meter evidence, Back to sales, Late correction request, Decide on this correction, Decision reason, Approve correction, Reject request, Keep reviewing.
- Omit B03 Export and B04 Correct sale, Mark as duplicate, Cancel sale: no M3 endpoints. No substitute mutations.
- Replace fixture photo placeholders with real evidence or explicit unavailable state. Do not fabricate customer totals/ranking changes absent an endpoint.

## Contracts needed
Use existing src/shared/contracts/sales.ts and live admin session permissions. No shared contract or endpoint additions.

## Open questions
None for this scope.
