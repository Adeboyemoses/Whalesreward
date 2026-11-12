# WHR-128 P-27 verification map

Dedicated real flows run against an isolated `whr128_price_*` database with the guarded `tests/price-adoption/playwright.config.ts`. They activate actual station prices through core endpoints and use real authenticated lookup/session responses, local IndexedDB and camera captures. They are deliberately outside default `tests/e2e`: price activation must not alter seeded rates used by unrelated full-suite cases. All accounts, pumps, stock and customers are fictional and unique per fixture.

The small default CI regression set uses real authenticated lookup responses but projects controlled `priceRefresh` versions; it never activates shared rates. Ordering and malformed-response cases explicitly control transport responses. These are client tests, not additional core consistency claims. Core evidence is `tests/integration/p27-verification.md`.

| Contract row | Executed browser evidence | Complementary offline-builder unit / existing core evidence |
| --- | --- | --- |
| PR-T1-01 | Actual capability header and negotiated lookup; fallback shapes covered by units | Four exact strict wire shapes and independent headers |
| PR-T1-02 | No new malformed-candidate browser case; decoder/adoption units own this matrix | Full malformed IDs/rate/version/time/key matrix; persistence failure |
| PR-T1-03 | Real activation → lookup/session → new draft → immutable saved payload | Core activation/receipt race serialization |
| PR-T1-04 | Delayed response order; decreasing rate; precision-only notice | Same-version conflicts and whole-snapshot atomic monotonic comparison |
| PR-T1-05 | Two-tab ordering and original expiry retained; context-change matrix owned by units | Full logout/account/fresh-signin/revocation/reassignment matrix |
| PR-T1-06 | Empty lookup adoption before selection; earlier amount/medium/photo, photo-click immediate response release; two tabs | Transaction failure and latest persisted snapshot ordering |
| PR-T1-07 | Repeated warning, discard clears photo/evidence/values, save-refresh race, quota failure retry | Frozen draft/operation behavior |
| PR-T1-08 | Liquid amount and gas quantity, kilogram rate notices/warnings, old/new precision and exact saved arithmetic | Shared exact math; precision-only versions never rewrite originals |
| PR-T1-09 | Offline after adoption; idle/reconnect request count; unchanged window anchors | 429/503/null/legacy fallback and existing capture-window suites |
| PR-T1-10 | Saved evidence and original snapshot compared across repeated refresh, refresh timestamps excluded | Core P-23 on/off activation-at-U/recovery/hold tests |
| PR-T1-11 | Before/after original+photo digest comparison; queue metadata absent | Populated legacy store rows retained byte/semantic identity, existing settled/finalized core preservation |
| PR-T1-12 | Customer cache/outbox contain no refresh metadata, no cached API, repeated update notice behavior | Partition isolation and no price histories |

Executed on candidate `4556c1795f53db4dc990b5fa7be12bfe3da99db5`, 12 Nov 2026. Native Linux Playwright 1.64.1, Node 26.12.0, pnpm 10.17.1, local Postgres/MinIO, isolated `whr128_price_e2e`. No deployed environment was used.

| Command (inside the local runner at `/app`, with the isolated DATABASE_URL) | Actual output |
| --- | --- |
| `pnpm exec playwright test --config tests/price-adoption/playwright.config.ts` | **14 passed (30.7s)**; 0 failed, 0 skipped |
| `pnpm exec playwright test tests/e2e/price-adoption.spec.ts --workers=1` | **4 passed (13.0s)**; 0 failed, 0 skipped |
| `pnpm exec playwright test --config tests/design-parity/price-adoption/playwright.config.ts` | **4 passed (13.4s)**; 0 failed, 0 skipped |

The dedicated config refuses databases outside `whr128_price_*`. Provision a fresh local database, run `pnpm db:migrate:deploy` and `pnpm db:seed`, then the commands above. The default suite uses controlled projections and is safe for its ordinary shared seeded test database. Do not run the dedicated activation cases against that shared database.

`scenarios.ts` supplies the real activation/empty lookup, earlier amount, medium/photo-first and gas precision cases. `draft-preservation.spec.ts` covers held lookup versus amount/medium/photo, repeated updates plus a failed save, and discard during pending lookup. `ordering.spec.ts` covers delayed session versus newer lookup across tabs, registration, save/refresh race, and idle/reconnect request counts. Full names begin with `P-27 PR-T1-…` for the corresponding rows above.

Preservation assertions compare the entire attempted and retried original payload, selected signed receipt, original time/price/precision, and photo digest. Browser coverage establishes local capture/outbox preservation; server acceptance/credit semantics remain the core suite's responsibility. The full logout/context-change, malformed response and populated legacy-store matrices are unit evidence, not newly claimed browser cases.

The initial run exposed a real composition race: a held lookup overtook the first medium selection. The client fix reserves composition before adoption; the same unchanged browser case passes after fix `61aabe0`. Fixture corrections only avoid a documented identical-price activation conflict after exact current-facts comparison, and freeze the first actual signed receipt for expected-value comparison. No forced clicks, skipped cases or relaxed preservation assertions were introduced.

Independent screenshot inspection and measured phone layout are recorded in [the fidelity report](../design-parity/price-adoption/REPORT.md).

Offline-builder unit sources: `src/client/price-refresh.test.ts` (four rollout shapes/header and malformed responses) and `src/client/offline/price-adoption.test.ts` (atomic adoption and preservation). Specific invariants include: whole newer snapshot before composition without customer-cache enrichment; delayed session cannot roll back newer lookup or elapsed checkpoint; equal-version conflicts reject both paths before any write; persistence failure publishes no adopted state; two clients compose from latest persisted version; stale logout/account/fresh-sign-in/expiry/lock/context bindings reject; legacy v1 original/blob/evidence and correction rows remain unchanged; failed-save retry retains original; late receipts never backfill; explicit customer change clears only incompatible selected evidence. These unit results are reported by the builder and remain subject to EM final-head gates.

## Round 1 regression follow-up

Executed on test candidate `39615a4143acd7fec7b444a135c696792524bbc5` (production fix `7dd5ed6`), 12 Nov 2026, in the same isolated native Linux environment. The full dedicated suite now reports **16 passed (38.2s), 0 failed, 0 skipped, 0 retries**. The affected gas fidelity cases report **2 passed (10.2s)** at 390 and 360 pixels. The default four-case result above belongs to the earlier candidate; the EM reruns the full default browser gate on the final feature head.

Before the fix, the three focused regressions reported **3 failed, 0 passed**: both real gas rate-change notices incorrectly used litres, and a pending lookup released from the actual photo-start click event changed the draft rate to ₦1,200.00 instead of retaining ₦1,000.00. The same assertions pass after the fix. The photo test releases before awaiting camera setup or taking the photo; it adds no artificial IndexedDB delay and uses an ordinary Playwright click. Saved originals still assert the earlier price/precision and absence of a later signed receipt. The gas cases assert both per-kilogram copy and exact immutable saved arithmetic, including the composed-draft receipt boundary.
