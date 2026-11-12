# WHR-128 P-27 verification map

Dedicated real flows run against an isolated `whr128_price_*` database with the guarded `tests/price-adoption/playwright.config.ts`. They activate actual station prices through core endpoints and use real authenticated lookup/session responses, local IndexedDB and camera captures. They are deliberately outside default `tests/e2e`: price activation must not alter seeded rates used by unrelated full-suite cases. All accounts, pumps, stock and customers are fictional and unique per fixture.

The small default CI regression set uses real authenticated lookup responses but projects controlled `priceRefresh` versions; it never activates shared rates. Ordering and malformed-response cases explicitly control transport responses. These are client tests, not additional core consistency claims. Core evidence is `tests/integration/p27-verification.md`.

| Contract row | Browser evidence planned | Complementary offline-builder unit / existing core evidence |
| --- | --- | --- |
| PR-T1-01 | Actual price capability header; real negotiated lookup and legacy/null fallback | Four exact strict wire shapes and independent headers |
| PR-T1-02 | Invalid candidate leaves original window/draft; ordinary next lookup succeeds | Full malformed IDs/rate/version/time/key matrix; persistence failure |
| PR-T1-03 | Real activation → lookup/session → new draft → immutable saved payload | Core activation/receipt race serialization |
| PR-T1-04 | Delayed response order; decreasing rate; precision-only notice | Same-version conflicts and whole-snapshot atomic monotonic comparison |
| PR-T1-05 | Two-tab request/context guard; original expiry retained | Full logout/account/fresh-signin/revocation/reassignment matrix |
| PR-T1-06 | Empty lookup adoption before selection; earlier amount/medium/photo; two tabs | Transaction failure and latest persisted snapshot ordering |
| PR-T1-07 | Repeated warning, discard clears photo/evidence/values, save-refresh race, quota failure retry | Frozen draft/operation behavior |
| PR-T1-08 | Liquid/gas, amount/quantity, old/new precision and exact saved arithmetic | Shared exact math; precision-only versions never rewrite originals |
| PR-T1-09 | Offline after adoption; idle/reconnect request count; unchanged window anchors | 429/503/null/legacy fallback and existing capture-window suites |
| PR-T1-10 | Saved evidence and original snapshot compared across repeated refresh, refresh timestamps excluded | Core P-23 on/off activation-at-U/recovery/hold tests |
| PR-T1-11 | Before/after original+photo digest comparison; queue metadata absent | Populated legacy store rows retained byte/semantic identity, existing settled/finalized core preservation |
| PR-T1-12 | Customer cache/outbox contain no refresh metadata, no cached API, repeat notice behavior | Partition isolation and no price histories |

This is a coverage plan, not a pass claim. Final commands, counts and fidelity evidence will be recorded after execution.

Offline-builder unit sources: `src/client/price-refresh.test.ts` (four rollout shapes/header and malformed responses) and `src/client/offline/price-adoption.test.ts` (atomic adoption and preservation). Specific invariants include: whole newer snapshot before composition without customer-cache enrichment; delayed session cannot roll back newer lookup or elapsed checkpoint; equal-version conflicts reject both paths before any write; persistence failure publishes no adopted state; two clients compose from latest persisted version; stale logout/account/fresh-sign-in/expiry/lock/context bindings reject; legacy v1 original/blob/evidence and correction rows remain unchanged; failed-save retry retains original; late receipts never backfill; explicit customer change clears only incompatible selected evidence. These unit results are reported by the builder and remain subject to EM final-head gates.
