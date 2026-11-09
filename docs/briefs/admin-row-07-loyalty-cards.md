# Admin row 7: Loyalty cards

Boards: B06, K01, K04, K02, K05, K06, K03 in flow order. Feature: F03. Invariants: I-07/I-09, I-16–I-20, I-41, I-49/I-50. Decisions: P-06, T-18.
Decision note: product-docs/04 UI Design/Admin Portal/Admin Loyalty Cards Decisions.md. All HTML and PNGs inspected before dispatch.

| Board | Route | Components (src/ui) | Reads | Writes | States | Permission (plus cards) |
|---|---|---|---|---|---|---|
| B06 | /admin/cards | persistent shell, lifecycle, batch table, generation entry | card-batches with status/cursor | none before review | pages/filter/empty/loading/error, narrow grants | cards |
| K01/K04 | /admin/cards/generate[/confirm] | form/sheet, read-only review | current session | POST card-batches {operationId,name,count} | edit/review/keep editing/cancel/confirm/uncertain/success/refusal | cardGenerate |
| K02/K06 | /admin/cards/:batchId | state panel, inventory/history/export tables | batch/cards/history/exports with cursors | none on GET | Generated/Printed/Active; Unassigned/Linked/Retired; hidden customer projection | cards; exports cardExport; customer identity customers |
| K05 | /admin/cards/:batchId/mark-printed; activation analogous | original/status review, reason/print reference | reviewed batch/version | POST mark-printed or activate {operationId,expectedVersion,reason} | reason/edit/review/confirm/cancel/stale/replay | cardPrint or cardActivate |
| K03 | /admin/cards/:batchId/print-preview | proof header/notice, protected PDF viewer | prepared export and authorized file | explicit export preparation only | pending/ready/failed/expired/unconfigured/no printable cards/denied | cardExport |

## Behaviour
- Existing APIs/shared schemas only. Count integer 1–1000; server reserves codes and records fixed creation reason. No required reason for generation despite general work-order shorthand. Freeze reviewed body/key, preserve across client route transitions, reject double submit; uncertain retry same key/body; stale version requires reread/new review/key. A historical applied receipt is labelled separately from a current reread.
- Only Generated to Printed, then separate Printed to Active. K05's prototype forward link to K06 is not a shortcut. Both transitions need reason, exact reviewed version and explicit confirm. Cancel mutates nothing. Active does not restore retired/link states. No suspend/reverse/delete/replace controls.
- Batch counts and eligibility come from the server; keep inventory state separate. cards-only linked rows show customer detail unavailable rather than inventing identity; retirement reveals time only. All lists/history/export pages preserve server cursors and ordering.
- Export preparation is explicit, freezes expectedVersion/format/key and returns immutable snapshot metadata. Bounded polling may observe readiness, never start new preparations automatically. Deliberate same-key preparation retry remains same snapshot; new export is explicit. Ready/failed/expired have distinct states and no false download/print claim.
- Download performs same-origin authenticated fetch with no-store and validates expected binary content before handing the blob to browser. No storage bearer URL, client-generated register/PDF, external CDN/viewer or customer PII. Recheck session/epoch/route before browser download/preview and revoke ephemeral object URLs on leaving/authority changes. The server remains the authority on each stream.
- Print preview uses the same protected prepared PDF bytes (native in-app PDF viewer is an implementation choice), never a second inventory-derived print rendering. Show snapshot count/status/time distinctly from live batch. Exporting/previewing leaves status/codes unchanged. Empty PDF inventory and missing physical layout have safe notices; independent Excel stays usable.
- Keep all admin state in memory under live account/permission epoch; no SW, IndexedDB or local/session storage. Preserve accepted no-reload navigation and existing access/station flows.

## Copy and declared board differences
Generated, Printed, Active; Unassigned, Linked, Retired; Review batch; Confirm new batch; Keep editing; Mark as printed; Confirm status change; Export PDF print sheet; Export Excel register; Preview print sheet. Replace K01's demo 1–20 capacity and prototype labels with contract bounds. Do not hardcode dimensions/eight-per-A4 or imply D08 physical approval. K03 keeps outer proof layout and uses actual protected PDF content/real QRs rather than placeholder QR squares. Export history records preparation, not downloading or printing; keep lifecycle history separately. Server history order replaces illustrative board chronology.

## Contracts needed
createBatchSchema/batchSchema, inventoryCardSchema, batchEventSchema, createExportSchema/cardExportSchema, pagination schemas and binary attachment endpoint. Existing Core #81 implements these; T-18 dependencies remain server-side, no new runtime dependency requested.

## Open questions
None blocking. D08 physical layout/phone policy remain server configuration gates; local fixtures may configure explicit fictional print layout. No cloud/staging changes or physical print acceptance.
