# Design system gallery implementation brief

Work order: WO-app-0 (WHR-33) · Consumer: WO-app-1 · Scope: component inventory and preview requirements only; no admin screen implementation.

Sources: `docs/engineering/design-system.md`, product design-system README, each `components/<Name>/README.md` and `preview.html`, and attendant boards A01/A02/A03/A04/A05/A08/A12/A13/A14/A15/A16/A18/A23/A24/A26/A27. Product sources stay read-only. The build vendors CSS/fonts into `src/styles/design-system/`; typed React wrappers live in `src/ui/`. These notes extract only the implementation contract needed in this repository.

## Gallery structure

Expose every wrapper and its documented states in a development/fixture gallery; WO-app-1 chooses the preview route (not a new production route here). Use fictional data; no authentication or credit claims from previews. References below are relative to `product-docs/04 UI Design/Design System/`. The component CSS is `bundle.css` (not a JS bundle). `Cover/preview.html` is the design-system cover, not a React component to add.

Every preview runs under `wr-root`; show attendant width 390px and minimum 360px. For admin-only components also show `.wr-admin` at 1440px and below 900px. Keep tokens unchanged, Tailwind mapped to tokens and component appearance from wr- classes. Self-host Manrope, IBM Plex Sans and IBM Plex Mono including latin-ext; verify ₦ on amounts in Plex Sans, never Manrope. One primary CTA per example screen. Phone targets 48px standard /44px floor; primary CTA 56px. Keyboard and TalkBack checks accompany visual comparison. Do not turn small admin variants into sub-floor phone actions.

## Component inventory

Classes listed are those used in component preview markup, excluding shared `wr-root`. Consult its README and stylesheet for full modifier behavior.

| Wrapper | Classes | Semantics and ARIA | Reference |
|---|---|---|---|
| AppHeader | `wr-brand`, `wr-brand-name`, `wr-context`, `wr-dot`, `wr-header`, `wr-header-top`, `wr-mono`, `wr-online`, `wr-page-title`, `wr-pill`, `wr-sm` | header landmark and page h1; connection word as text; decorative brand icon hidden; label icon-only actions | `components/AppHeader/README.md`; `components/AppHeader/preview.html` |
| BottomNav | `wr-badge`, `wr-nav` | nav landmark with accessible name; five links; aria-current="page"; badge aria-label with pending count | `components/BottomNav/README.md`; `components/BottomNav/preview.html` |
| Button | `wr-btn`, `wr-btn-cta`, `wr-btn-danger`, `wr-btn-ghost`, `wr-btn-link`, `wr-btn-primary`, `wr-btn-secondary` | button type=button/submit for actions; anchor href for navigation; native disabled and adjacent reason; labelled icon-only action; visible focus | `components/Button/README.md`; `components/Button/preview.html` |
| DataTable | `wr-amount`, `wr-btn-link`, `wr-held`, `wr-mono`, `wr-pending`, `wr-pill`, `wr-right`, `wr-sm`, `wr-sub`, `wr-synced`, `wr-table`, `wr-table-cap`, `wr-table-wrap` | real table with caption, th scope=col, td; scroll container accessible; row action name contextual; no layout table | `components/DataTable/README.md`; `components/DataTable/preview.html` |
| KPI | `wr-attn`, `wr-attn-arrow`, `wr-attn-n`, `wr-attn-s`, `wr-attn-t`, `wr-kpi`, `wr-kpi-foot`, `wr-kpi-label`, `wr-kpi-value`, `wr-kpis` | label/value/basis as readable text in order; no colour-only information | `components/KPI/README.md`; `components/KPI/preview.html` |
| KeyValueList | `wr-card`, `wr-kv`, `wr-kv-row`, `wr-mono`, `wr-total` | dl with dt/dd pairs; preserve DOM order; no action inside dl | `components/KeyValueList/README.md`; `components/KeyValueList/preview.html` |
| ListRow | `wr-action`, `wr-failed`, `wr-list`, `wr-list-amount`, `wr-list-foot`, `wr-list-main`, `wr-list-meta`, `wr-list-row`, `wr-pending`, `wr-pill`, `wr-sm`, `wr-synced` | one anchor for a linked row; no nested interactive links; readable amount, metadata, status and action | `components/ListRow/README.md`; `components/ListRow/preview.html` |
| LoyaltyCard | `wr-accent`, `wr-code`, `wr-loyalty-card`, `wr-pill`, `wr-sm`, `wr-sub`, `wr-synced` | member, code and category as text; status word; QR if present has text code alternative; never phone number | `components/LoyaltyCard/README.md`; `components/LoyaltyCard/preview.html` |
| Notice | `wr-danger`, `wr-inverse`, `wr-notice`, `wr-success`, `wr-warning` | persistent readable text and decorative icon; link helper to relevant field; errors announced without repeated alerts | `components/Notice/README.md`; `components/Notice/preview.html` |
| PhotoCapture | `wr-btn-link`, `wr-photo`, `wr-photo-bar`, `wr-taken` | real camera button with accessible label; taken image descriptive alt; Retake button; no gallery input; announce camera errors | `components/PhotoCapture/README.md`; `components/PhotoCapture/preview.html` |
| ResultBlock | `wr-card`, `wr-pending`, `wr-result`, `wr-result-icon` | heading and loyalty consequence text; decorative icon hidden; focus/announce result after save without duplicating speech | `components/ResultBlock/README.md`; `components/ResultBlock/preview.html` |
| SegmentedControl | `wr-cols-4`, `wr-input`, `wr-segment`, `wr-segments` | labelled group of buttons with aria-pressed true/false; preserve focus; never use for read-only Cylinder | `components/SegmentedControl/README.md`; `components/SegmentedControl/preview.html` |
| Sidebar | `wr-brand`, `wr-brand-name`, `wr-count`, `wr-navlist`, `wr-sidebar`, `wr-sidebar-foot` | nav landmark labelled Admin; anchors with aria-current; labelled count and sign-out link | `components/Sidebar/README.md`; `components/Sidebar/preview.html` |
| StatusPill | `wr-failed`, `wr-held`, `wr-offline`, `wr-online`, `wr-pending`, `wr-pill`, `wr-sm`, `wr-synced` | plain text status; decorative dot/icon hidden; no interactive pill; status changes announced politely when needed | `components/StatusPill/README.md`; `components/StatusPill/preview.html` |
| TextField | `wr-btn`, `wr-btn-secondary`, `wr-error`, `wr-field`, `wr-help`, `wr-hint`, `wr-input`, `wr-input-lg`, `wr-invalid`, `wr-label`, `wr-mono`, `wr-prefix`, `wr-row` | label for/input id; input type/inputmode/autocomplete; aria-invalid and aria-describedby helper/error; password visibility button labelled | `components/TextField/README.md`; `components/TextField/preview.html` |
| Attention | `wr-attn`, `wr-attn-n`, `wr-attn-t`, `wr-attn-s`, `wr-attn-arrow` | one anchor to filtered list; count/title/consequence readable together; decorative arrow hidden | `components/KPI/README.md`; `components/KPI/preview.html` (shared guideline/preview) |

## Required examples

- AppHeader: context with station/pump/product/account, Online/Offline, long username. BottomNav: Sale/Register/History/Uploads/Account, each active and zero/nonzero pending count. Hidden on sign-in/access-expired screens. Match A02/A12/A18.
- Button: primary, secondary, ghost, danger, link; default/CTA/small; hover/focus/pressed/disabled/loading. Phone small variants must still meet touch floor. TextField: empty/filled/invalid/helper, mono card input, prefixed amount/quantity, password visibility and select. Use real labels, inputmode and helper association. Match A01/A24/A03.
- SegmentedControl: Amount/Litres and Amount/Kilograms; four liquid media; selected/disabled/focus. Switching clears typed number with visible helper. Cylinder is a disabled/read-only field plus readable value, not a choice. Match A02/A15.
- StatusPill: Synced (`wr-synced`), Saved on phone/Uploading (`wr-pending`), Awaiting price review/Held (`wr-held`), Photo upload failed (`wr-failed`), Offline/Online, neutral; small and plain variants where documented. Copy remains fixed; text carries meaning.
- Notice: info/default, warning, success, danger, inverse; persistent message. KeyValueList: receipt with code/ID mono and total; longest text wraps. ListRow: pending/failed/synced/held, metadata and whole-row details navigation; no nested link. Match A04/A05/A08/A14.
- PhotoCapture: empty live-camera action, taken actual fixture image with capture time and Retake, camera denied and upload failed retaining photo. Do not copy dark “Meter photo” placeholder into app. ResultBlock: success/pending/held/failed with loyalty consequence in first sentence. Match A03/A04/A05/A14/A18.
- LoyaltyCard: fictional name/code/fixed category/status, never phone number; generated QR must resolve same printed code when implemented. Sidebar: active item/count and responsive top bar; DataTable: caption, primary/subtext/amount/status/action columns, horizontal overflow with no type shrink; KPI: label/value/basis; Attention: count/title/consequence/link. These are inventory previews only; admin routes remain out of scope.

## Data and contracts

Gallery data is fixture-only and needs no live endpoint. Show explicit props for label, value, state, reason, action and accessibility labels, not undocumented business policies. **TODO-CONTRACT**: any future live session, price, customer, sale or queue props must reconcile with WO-spec-1 `docs/engineering/contracts/m1.md`; no contracts or endpoints are approved by this brief. Monetary examples are formatted exact kobo strings with currency and quantity examples are decimal strings with units. No runtime product-docs imports.

## Conflicts and open questions

Repo rules override design-guide routes/vendoring/tap targets and outdated Q-520 flags. All added boards are approved. There is no standalone Attention source folder: use KPI's shared guideline and preview. Gallery route and automated screenshot harness are implementation choices for WO-app-1, not unresolved product policy. Brand values remain tokens/swappable assets pending sign-off. No new client policy is settled here.
