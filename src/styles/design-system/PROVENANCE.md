# Design assets

CSS and eight WOFF2 font files vendored unchanged from product-docs/04 UI Design/Design System on 4 November 2026; CSS has an added source/date header. Font CSS references the adjacent fonts, bundled by Next.js. Manrope and IBM Plex fonts use the SIL Open Font License. Mark: product-docs/04 UI Design/Brand/Logos/whales-rewards-mark.svg. Fixture meter SVG is original fictional artwork for the development gallery only and is not photographic evidence. Lucide icons use the lucide-react package (ISC license included in package).

Font license notices are adjacent to the binaries: Manrope-OFL.txt, IBMPlexSans-OFL.txt and IBMPlexMono-OFL.txt, retrieved from the corresponding official google/fonts `ofl/<family>/OFL.txt` sources.

Tailwind 4.3.4 and its PostCSS adapter (MIT), PostCSS 8.5.32 (MIT), and lucide-react 1.68.0 (ISC) are exact pinned build/runtime dependencies. Tailwind integration follows https://tailwindcss.com/docs/installation/framework-guides/nextjs and https://tailwindcss.com/docs/theme. It imports utilities only, not the default palette or preflight; aliases map colour/spacing/font/radius/shadow utilities to the existing design tokens without self-referencing CSS variables.

App overrides: responsive phone width, wrapping long identity values, phone 48px controls (including segmented buttons and small admin controls below900px), accessible focus/hidden table caption, and actual photo image sizing. Source preview gradient is deliberately replaced with a labelled fictional meter illustration; preview price-notice copy uses unresolved captured-price wording per the newer decision note. Source styles are never hand-edited.
