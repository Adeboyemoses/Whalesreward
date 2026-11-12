# Attendant row 02: Online price adoption and draft notices

Boards: A02-Sale, A03-SaleFilled; related A15-GasSale (row 06), A27-SaleOffline (row 03).
Feature: F04/F05, P-27. Work order: WHR-128 (WO-app-6e).
Invariants: I-03, I-06, I-22/I-23, I-28a/I-28b, I-29, I-31/I-32, I-49/I-50.
Decision note: `product-docs/04 UI Design/Attendant Mobile/Attendant Sale Screen Decisions.md`, including its hi-fi flow and in-progress capture sections.

HTML and PNG for all four boards inspected 12 Nov 2026. The normative implementation contract is M1's “Online price refresh — P-27” and its verification table; core merged in PR #125. Existing row briefs continue to govern unrelated capture, sync and correction behavior.

| Board | Route | Components | Reads | Writes | States | Permission |
|---|---|---|---|---|---|---|
| A02 | `/attendant/sale` | Frame, TextField, SegmentedControl, Notice, PhotoCapture, Button | current account window, session, lookup/priceRefresh | latest applicable window price; new draft on composition | empty, finding, not found, rate updated, precision updated, malformed response, persistence failure, expired/locked | active originating attendant context |
| A03 | `/attendant/sale` | same, resolved customer and photo preview | frozen draft plus latest adopted window price | atomic original/photo save | composed, retained price/precision warning, saving, failed save/retry, explicit discard | same; save revalidates context |
| A15 | `/attendant/sale` | same, read-only Cylinder | acknowledged gas context and per-kilogram price | same draft/save path | amount/kilograms, empty/composed update notice, camera/storage errors | same |
| A27 | `/attendant/sale` | same plus existing offline Notice | last adopted window price and original expiry | local immutable original/photo save | offline cached/uncached, composed warning, pending upload, expired | original offline window; no renewal |

## Behavior

- Consume only already-needed session reads and user-driven lookup responses. Send the P-27 header now that core is merged. Accept the four exact strict legacy/receipt/refresh/both shapes; absent extensions normalize to null. Malformed/unknown data cannot update price or lookup state. Preserve WHR-90 build-mismatch messaging and safe reload rules.
- One transaction rechecks active account, request generation, capture context, station, assignment, pump, product, expiry and lock/logout state. Compare with the latest persisted version. Adopt greater versions as whole snapshots, ignore lower versions, no-op identical equal versions, reject conflicting equal versions. Preserve all timing checkpoints and authorization fields.
- Do not freeze a draft on mount, card typing/scanning or automatic defaults. Selecting a resolved customer, entering an amount/quantity, choosing a medium or starting the meter photo starts composition. An empty form's online lookup must persist its refresh before customer selection freezes the draft. Registration handoff uses the same path.
- An open composed draft keeps every captured fact, entered value, selected receipt, photo and timestamp. Current-window price updates never recalculate that draft. A save/refresh race saves its frozen snapshot. A failed save retains that snapshot for retry. Never reprice saved/queued/settled/corrected records or migrate their payloads.
- Offer an explicit discard/start-new action for an unsaved draft; clear values, photo and selected evidence, then obtain ordinary lookup selection/fresh photo for the new sale. Retain existing context safeguards and update handover protection during draft composition and unsent outbox work.
- Preserve the four liquid media, automatic gas Cylinder, Amount default and exact arithmetic. Precision-only changes affect future drafts; current drafts retain precision. Offline capture uses the last adopted rate inside the original window.
- No polling, refresh-specific retries, new reconnect/resume fetch or API/SW caching. Price timestamps are never capture evidence and never clear a hold.

## Copy and layout

- Empty form, rate adoption: “Price updated to ₦X per litre” or “Price updated to ₦X per kilogram”. Format both amounts to exactly two decimals with shared exact money helpers.
- Composed draft: “Price updated to ₦X per litre for new sales. This sale keeps ₦Y per litre. Check the meter before saving.” Use per kilogram for gas. Keep visible while the rate differs, including repeated refreshes.
- Precision-only adoption: “Quantity precision updated for new sales”. For a composed draft, append “This sale keeps its original quantity precision. Check the meter before saving.” Keep the warning while precision differs.
- Initial sign-in, null/absent refresh and repeat versions show no new notification. Publish notices only after persistence. On a newer version in the active view, show at most one update notice for that version; warnings reflect current-vs-draft facts.
- Existing rate row, calculation, offline notice and save status remain. Put the accessible update Notice in the Purchase section near the rate; use vendored tokens/classes and 48px actions. Preserve 390/360 layout, readable wordmark/footer, and camera/input interaction.
- P-27 adds notice/discard states absent from the older boards. It supersedes their static price distribution example while retaining their hierarchy and captured-price behavior. No client policy is invented.

## Contracts and ownership

Use the merged strict P-27 schemas where practical; keep the client decoder strict, legacy tolerant and no-store. No server/shared/schema change is planned. Offline builder owns client types/API, transactional window adoption, draft primitives and their unit tests. Frontend builder owns sale page/runtime, UI notices, composition boundary and discard behavior; agree the client interface before implementation. Independent test-engineer owns browser/regression fixtures and fidelity, never production fixes.

## Open questions

None blocks implementation. P-27's approved keep-and-warn recommendation governs this work order. Q-528/Q-559 and physical phone acceptance remain separate; this work changes no settlement or meter policy.
