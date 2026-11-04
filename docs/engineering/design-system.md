# Design system and hi-fi boards in code

## Sources

- Brand book and rules: `product-docs/04 UI Design/Design System/README.md` (read it whole once).
- Tokens: `Design System/tokens.json` (with usage notes) and `tokens.css` (CSS custom properties plus one class per type style).
- Components: `Design System/bundle.css` (prefix `wr-`, phone-first with `.wr-admin` overrides) and `components/<Name>/README.md` + `preview.html`. "There is no JavaScript bundle; the classes are the contract."
- Fonts: `Design System/fonts/` and `fonts.css` (Manrope 700/800, IBM Plex Sans 400–700 latin + latin-ext so ₦ renders, IBM Plex Mono 500/600).
- Screens: 106 boards in `Hi-Fi/Attendant/` and `Hi-Fi/Admin/`, each as `<ID>.html` (live markup on the same CSS) and `<ID>.png` (2×). `Hi-Fi/README.md` lists them in flow order, row by row.
- Live versions (Earl's claude.ai artifacts): hi-fi canvas https://claude.ai/artifact/8FMYTJrYeSPX8T4XMwP2o7, design system https://claude.ai/artifact/JZjEfRofVLsR7WDEgXFGzq. The exported files are what you build from.

## Vendoring

`src/styles/design-system/` holds copies of `tokens.css`, `bundle.css`, `fonts.css` and `fonts/`. They are vendored, not imported from `product-docs/`, so CI and production builds don't depend on Earl's machine. The first line of each copied file records the source and date: `/* vendored from product-docs/04 UI Design/Design System/<file>, 2026-11-04 */`.

When the design system changes upstream, a low-tier PR re-copies the files and lists the token diff. Never edit the vendored files by hand; put overrides in `src/styles/app.css` and explain them.

## Tailwind

Tailwind is configured to read the same CSS variables (colours, spacing, radii, shadows) so layout utilities can't drift from the tokens. Don't use Tailwind's default palette; the config replaces it. Component looks come from `wr-` classes, not from strings of utilities.

## Components

`src/ui/` wraps each design-system component in a typed React component that only emits the documented classes and ARIA: `AppHeader`, `BottomNav`, `Button`, `TextField`, `SegmentedControl`, `StatusPill`, `Notice`, `KeyValueList`, `ListRow`, `PhotoCapture`, `ResultBlock`, `LoyaltyCard`, `Sidebar`, `DataTable`, `KPI`, `Attention`. Icons are Lucide, inline SVG, 24 px grid, 1.75 stroke, with the fixed meanings in the brand book.

## The design team's handoff, and where this repo differs

`Hi-Fi/AGENTS.md`, `06 Delivery and Handoffs/Design Build Guide.md` and `Hi-Fi/screens.json` are the design team's binding build rules. Follow them, with these overrides:

- **Routes:** use `screens.json › route_suggestion`; attendant routes get the `/attendant` prefix (T-11). Boards that share a route are states of one page.
- **Vendoring:** the guide suggests `packages/design-system/`; this repo uses `src/styles/design-system/` (same files, unchanged). Put `class="wr-root"` on each surface's root.
- **Tap targets:** 48 px on the phone (`control-h`) as the brand book says; 44 px is the absolute floor.
- **Q-520 is answered:** the added boards are approved; "Clear the flag · keep both" ships without a feature flag; D03-AttendantProfile's two placeholder buttons are left out.
- **Questions:** Linear `needs:human` in team WHR (Rook mirrors them into Earl's register); Codex has no access to the Cowork register.
- **Placeholders that must not ship as drawn:** meter-photo wells (show the captured image), QR squares (generate from the card code), email expiry figures and sender address (D06, client domain), sample rates (prices come from settings).

## From board to route

Each flow row on the canvas becomes one implementation brief (`docs/briefs/<surface>-row-<nn>-<slug>.md`) and usually one work order. The brief maps:

| Board | Route | Components | Reads | Writes | States | Permission |
|---|---|---|---|---|---|---|
| A02-Sale | `/attendant/sale` | AppHeader, TextField, SegmentedControl, PhotoCapture, Button | session assignment, price version, card lookup | outbox row | empty, card not found (A24), filled (A03), offline (A27) | attendant session |

Rules:

- The board's HTML is the reference for structure and copy; the PNG for appearance; the decision note for behaviour. Where they disagree, the newer decision note wins, then F&R, then the board.
- The 23 boards marked "added" are approved scope (Earl, 4 Nov 2026, Q-520).
- Two boards are placeholders to leave out: the Attendant profile's **Reset password** and **Disable account** buttons (D03-AttendantProfile) stay undesigned items until a work order covers them.
- Sample data on the boards is fictional. Reuse it in `tests/fixtures/` so design-parity screenshots line up.
- The transactional emails (M01, M02) ship as table-layout HTML with inlined hex values, system-font fallbacks, the wordmark as an image and a plain-text part. Expiry figures (24 hours, 30 minutes) are placeholders until the token policy (D06) is decided.

## Brand status

The product name **Whales Rewards** and the brand are pending client sign-off (Q-516). Keep every brand value in tokens and the logo in one asset folder so a change is a token swap, not a re-skin.
