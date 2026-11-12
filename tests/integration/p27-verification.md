# P-27 core verification

Scope: WHR-127, the core follow-on in `docs/engineering/contracts/m1.md`. The app follow-on owns price adoption and notices. This matrix accounts for every P-27 acceptance row without claiming UI behavior that this core change does not implement.

| Case | Core evidence | App follow-on obligation |
| --- | --- | --- |
| PR-T1-01 | `p27-price-refresh.test.ts`: all four independent HTTP projections and unknown capability values. `tests/unit/p27-price-refresh.test.ts`: four strict wire shapes, legacy normalization. | Enable header and consume shared strict schemas during rollout/rollback. |
| PR-T1-02 | Unit schema cases reject unknown envelope/nested keys, invalid category, all six context IDs, malformed extension and invalid price bounds/UTC/order; valid nullable extensions. PostgreSQL tests cover independently null price/receipt. | Invalid response changes no local state; null retains local price. |
| PR-T1-03 | PostgreSQL tests: `session/lookup waits for in-flight activation commit before selecting latest version`; `activation cannot commit between the locked price observation and receipt issuance`. | Ordinary successful calls supply candidates. |
| PR-T1-04 | `ordinary reads expose price decreases and precision-only versions as whole snapshots`; schemas validate version and immutable fields. | Out-of-order V2/V3, equal-version conflict, transactional monotonic adoption and distinct notices. |
| PR-T1-05 | Acknowledged reassignment versus fresh sign-in, immutable context/anchors, revoked context, disabled account, expired window, restricted session, and revocation winning during the request. Existing `attendant-auth.test.ts` preserves sign-in replay. | Generation/partition recheck, logout/switch race, no stale-context write or unlock. |
| PR-T1-06 | Server bindings always identify the acknowledged context; no app mutation in this PR. | Empty-form composition boundary, previous amount/medium/photo, two-tab ordering and persistence failure. |
| PR-T1-07 | `p27-preservation.test.ts`: later refresh/new receipt leaves a saved sale and its hold unchanged. | Repeated draft warning, intentional discard, save/refresh race and failed-save retry. |
| PR-T1-08 | Preservation tests: exact amount/quantity arithmetic for litres/kilograms after precision-only activation; current reads publish new precision while originals remain unchanged. | New-draft precision and persistent old-draft warning. |
| PR-T1-09 | Original expiry and context remain unchanged; expiry still denies lookup, rate limit remains 30/account with Retry-After, null and legacy success behavior tested. Existing app suites continue running. | Offline/reconnect/idle/hidden/resume behavior, 503 retry and no added refresh requests. |
| PR-T1-10 | Preservation tests: P-23 on/off activation-before-lookup, later activation retains hold, late upload with activation at U versus U+1 ms. Existing `p23-lookup-receipt.test.ts` covers recovery provenance. | No new refresh-derived evidence; actual recovery flow remains existing scope. |
| PR-T1-11 | Preservation tests snapshot purchase, capture context, revisions, holds, photo rows, blob bytes, digest and credited totals before/after refresh, including corrected/finalized records. No sale migration or settlement change. | Populated legacy IndexedDB drafts/outboxes and giveaway snapshots are not claimed by core tests. |
| PR-T1-12 | HTTP no-store verified on negotiated lookup; no metadata enters sale payload, evidence claims or customer objects. | SW/cache partition checks, no customer enrichment/history, duplicate-notice suppression. |

Product source: Technical Requirements, “Immediate price activation — confirmed 3 November 2026”: “Publish one station/product price to every same-product pump for future captures.” P-27 supplies this distribution through existing session/lookup calls; app adoption follows separately.
