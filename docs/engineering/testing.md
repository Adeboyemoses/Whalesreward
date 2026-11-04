# Testing

The TRD asks for "business-rule checks plus real browser workflows", concurrency tested against PostgreSQL, and a pilot on real station phones. Here is how that maps to suites and scripts.

| Script | Runs | When |
|---|---|---|
| `pnpm test` | Vitest unit tests (pure logic: money, quantity, time, status transitions, validation, Dexie logic with fake-indexeddb) | every PR |
| `pnpm test:integration` | Vitest against a real Postgres (Docker locally, a service container in CI); migrations applied from scratch | any change under `prisma/**`, `src/server/**`, `src/app/api/**`, `jobs/**` |
| `pnpm test:e2e` | Playwright against `pnpm build && pnpm start` on the local database, Chromium with Pixel-class mobile emulation for the attendant and desktop for admin | any change to a user flow; nightly on `staging` |
| `pnpm test:time` | the time and midnight suite twice, under `TZ=UTC` and `TZ=America/New_York` | any change touching time, corrections, campaign windows |
| `bash scripts/review/test-review.sh` | the review gate's own tests | changes under `scripts/review/` |
| `bash .codex/hooks/test-guard.sh` | the Codex guard hook's tests | changes under `.codex/hooks/` |

## Required suites (each maps to invariants)

1. **Credit once:** online credit; offline save → restart → reconnect → one credit; lost response → retry → same result; same ID with different content → 409; concurrent finalize of the same purchase → one credit. (I-22, I-26)
2. **Adversarial evidence:** after acceptance, PUT different bytes with the old staging URL; accepted object, digest and revision unchanged. Oversized, undecodable and wrong-type images rejected. (I-25)
3. **Accounts and handover:** logout with a queue; another attendant signs in and sees nothing of it; the original attendant resumes; pump reassignment keeps old rows on the old pump; disabled account and revoked permission on a live session. (I-05, I-06, I-09)
4. **The 24-hour window:** 23:59 allowed, 24:00 expired, clock set back expired, reopen and reconnect don't renew, a new online sign-in does. (I-03)
5. **Money and quantity:** amount mode keeps entered kobo; quantity mode rounds once; halfway cases; precision 2 and 3; kilograms and litres kept apart. Property-based tests (fast-check) for the arithmetic. (I-29, I-44)
6. **Midnight:** a correction received at 23:59:59 Lagos applies; at 00:00:00 it goes to review; an original arriving after midnight doesn't reopen editing. (I-37, I-38)
7. **Holds:** price, card and date holds contribute zero; each resolution clears only its hold; replayed and stale resolutions rejected. (I-31, I-33, I-34, I-35)
8. **Cards:** two simultaneous links of one card → one wins; Generated and Printed cards can't be linked; export leaves status and codes unchanged; retired codes never reappear. (I-18 to I-21)
9. **Access:** every admin route denies without the permission; delegation can't escalate; two concurrent removals of the last Owner → one refused; recovery responses identical for known and unknown emails; reset tokens single-use and expiring. (I-07 to I-13)
10. **Rankings and giveaway:** ties share rank (1, 1, 3); excluded sales; finalize blocked by any open hold or unset value; a revision creates a new snapshot and leaves the old one byte-identical. (I-42, I-43, I-45, I-46)

## Fixtures

`tests/fixtures/` mirrors the hi-fi boards: Station 01, Pumps 01–05 (PMS, diesel, kerosene, cooking gas), ₦1,000.00 / litre and ₦1,500.00 / kg, attendants Grace Okon (STAFF002) and Favour James (STAFF005), admin Ada Williams (ADMIN001), customers Amina Bello, Tunde Adebayo, card A7K3M9Q. Fictional only, `@example.com` only.

## Device pilot

The automated suites don't replace the pilot list in `product-docs/06 Delivery and Handoffs/Design Handoff Readiness.md` ("Validation required before pilot"). Milestone M1 ends with the core flow on a real station Android phone; M5 runs the full list with real cards and meter photos in daylight.
