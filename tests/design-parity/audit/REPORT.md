# G01–G05 audit fidelity — 13 November 2026

Independent checker: test-engineer. Built code: `65e04b6` plus `ab9f384`; tests: `7b608dd`. All five built PNGs were opened and visually compared with the matching read-only product PNGs at 1440 CSS px / device scale 2. Production build, real local PostgreSQL, real API, authenticated audit-only account; no mocked audit responses.

| Board | Match | Differences | Severity |
|---|---|---|---|
| G01 | Pass with specified differences | Added target UUID filter and inclusive Lagos helper text; current-page count/cursor position replaces fictional totals. Permission-scoped sidebar shows audit only. Native date input follows browser locale. Real catalogue action wording replaces prototype captions. | note |
| G02 | Pass with specified differences | Actual immutable IDs add target ID/kind rows and longer codes. Actual batch version replaces invented cards-available change. No inferred effect narrative; original-seller absence is explicit. Blue reason panel, status pills, table and hierarchy match. | note |
| G03 | Pass with specified differences | Actual canonical correction snapshot shows all typed fields and related event link. Separate original seller replaces inferred effect narrative. Exact ₦10,000.00/₦12,000.00 and 10/12 litres render correctly. Status uses canonical Accepted rather than prototype Approved. | note |
| G04 | Pass with specified differences | Attendant correction submission uses canonical Correction received; automatic application is a separate system event under amended contract. All projected changes are shown, rather than inventing an attendant-applied event. Seller is explicit. | note |
| G05 | Pass with specified differences | Actual system executor stays separate from Grace Okon; actual Received/Cancelled/zero contribution changes replace prototype-only narrative/fields. Dark system badge and cancellation pill match. | note |

Initial visible drift was routed to the frontend builder and fixed in `ab9f384`: blue reason panel, spacing between stacked panels, status pills and sentence-case labels naming the displayed naira values. Final captures have no remaining blocking or fix-level differences. Read-only buttons, native focus ring, Manrope/Plex typography, whale palette, rounded sheets and table rhythm were inspected. No phones or edit/delete/export controls appear. Longer canonical fields make details taller than sample boards; this preserves every projected field.

Fixtures retain fictional Ada Williams, Grace Okon, BATCH002, S004/S011/S012 and representative amounts. Unique safe subject markers isolate concurrent test runs; raw phone/token canaries exist only in an unsupported legacy fixture and never appear in output. Permission-only navigation intentionally differs from the owner prototype.

Verification: audit real-stack suite **6 passed, 0 failed** (desktop and Pixel 7 projects, 13.4 seconds), including search/area/actor/target, cursor next/previous, Back state, date-range error and actual Lagos day-boundary checks, snapshots, related links, legacy privacy, sales/customer denial and live revocation. Final fidelity capture **1 passed, 0 failed** (13.5 seconds). Typecheck and focused ESLint passed. EM owns final-head full gates.

Reproduce with an isolated local database migrated and fictional fixtures seeded, `DATABASE_URL` set to that database, and Chromium available:

```sh
pnpm test:e2e audit-history --workers=1
pnpm exec playwright test --config tests/design-parity/audit/playwright.config.ts --workers=1
```

Host Chromium was blocked by the macOS sandbox bootstrap permission. The successful run used the existing local Playwright v1.64.1 Linux container with source copied into `/work-whr21`, excluding `.git`, `.env*`, product docs, dependencies, build outputs, worktrees and test results. Linux dependencies were copied inside that workspace root because Turbopack rejects dependencies outside it. Set `COPYFILE_DISABLE=1` for macOS tar to avoid resource fork files. The local DB was `whr21_e2e`; no deployed data or services were used. The EM's local MinIO proxy supports the broader suite; audit itself uses no object storage.
