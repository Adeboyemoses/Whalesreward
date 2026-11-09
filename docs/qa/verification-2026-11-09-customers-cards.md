# Customers and card batches verification — 9 Nov 2026

WO-core-7 / WHR-12. Backend acceptance against `docs/engineering/contracts/m2.md`. EM verification on frozen implementation and tests `0be03d7` (including the reviewed lease-recovery fix); approval/review and the READY records follow separately.

## Acceptance matrix

| Contract | Required evidence |
|---|---|
| Online registration | Canonical unique phone; fixed category; same-transaction eligible card claim; historical same-account receipt replay; no partial customer/link/audit after conflict |
| Live authority | Normal/current attendant assignment and online window; admin kind and explicit parent/action grants; revocation serialized with confirmation; restricted sessions denied |
| Customer reads | Exact-phone attendant lookup without phone/history/totals; bounded private admin search and historical retired-card lookup; unknown legacy provenance stays null |
| Operational totals | Exact all-time accepted spend/count and product/unit quantities; held/cancelled excluded; upload-pending separate; duplicates included; late proposals retain accepted revision |
| Batch allocation | Seven-character crypto codes, global uniqueness including retired inventory, bounded collision exhaustion and rollback, no new codes on replay |
| Lifecycle | Generated → Printed → Active only; expected-version/reason/audit/history; counts and availability honest; exports/reads never change status |
| Export snapshot | Immutable ordered inventory and batch metadata; serialized linking/activation boundary; PDF unassigned only; XLSX all states without customer identity |
| File preparation | Real QR parity; text XLSX codes and neutralized formula metadata; configured physical layout; leased/fenced automatic retry from stored snapshot |
| Private download | Current permission/creator checks, exact batch association, expiry/checksum, attachment/no-store, no bearer URL or public artifact |
| Compatibility | Existing P-20/P-21, sync/evidence, auth, station and browser regressions remain intact |

## Verification output

All commands below were executed by the EM. A clean PostgreSQL database applied all 10 migrations; new migrations are additive and existing migration files are unchanged. The dedicated Linux browser container received a `git archive` of `0be03d7` with the frozen lockfile, without secrets, product docs or a developer checkout.

```text
pnpm typecheck                                      exit 0
pnpm lint                                           exit 0, no warnings
pnpm test                                           40 files, 318 passed (2.13s)
pnpm build                                          exit 0; Workbox 32 generic assets
pnpm test:integration                               18 files, 233 passed (9.58s)
pnpm test:time                                      3 passed in UTC; 3 passed in America/New_York
named customer/card integration                     2 files, 32 passed (3.66s)
named renderer/config/runtime/storage/phone units    5 files, 58 passed (see named unit output below)
pnpm test:e2e (Linux Chromium)                       130 passed, 4 existing staging-only skips (1.4m)
Playwright signed-upload browser test                1 passed (437ms)
```

No backend test was skipped and browser retries were zero. Existing auth, sync, evidence, station, P-20 and P-21 regressions are part of the 233-test integration run; their assertions were not weakened. The 32 named tests below cover primary and independently authored cases. Runtime tests bind the actual automatic preparation loop, test bounded nonoverlap, and preserve prior mail/Next shutdown handlers. Renderer tests decode the actual QR image bytes embedded in PDF and reopen the actual XLSX workbook.

### Named integration output

```text
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-16/I-20 reserves cryptographic globally unique codes and returns original inventory on replay 43ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-18 requires forward CAS transitions, reason, audit and historical Domain replay 36ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-19 inactive cards cannot register and failed attempts leave no customer or receipt 19ms
✓ |integration| tests/integration/customers-cards-adversarial.test.ts > independent M2 customer and card adversarial checks > I-16 bounded code collisions roll back every card, batch, audit and receipt and permit same-key retry 33ms
✓ |integration| tests/integration/customers-cards-adversarial.test.ts > independent M2 customer and card adversarial checks > I-15 normalized phone and parsed QR/code content replay one registration while changed content conflicts 43ms
✓ |integration| tests/integration/customers-cards-adversarial.test.ts > independent M2 customer and card adversarial checks > I-14 unknown legacy registration provenance stays null despite a known card link actor 12ms
✓ |integration| tests/integration/customers-cards-adversarial.test.ts > independent M2 customer and card adversarial checks > I-42 I-44 exact accepted totals ignore late proposals and campaign cutoff, preserve duplicates, and separate product units and upload pending 127ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-14/I-15/I-19 two registrations racing for one phone create exactly one customer/link 52ms
✓ |integration| tests/integration/customers-cards-adversarial.test.ts > independent M2 customer and card adversarial checks > I-07 card inventory without customers permission never reveals linked customer identity 74ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-19 same card race rolls back losing customer; exact lookup follows the successful link 117ms
✓ |integration| tests/integration/customers-cards-adversarial.test.ts > independent M2 customer and card adversarial checks > I-07 customer cursors bind actor, endpoint, category and query 70ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > registration replay preserves immutable provenance and only the original account can see the receipt 142ms
✓ |integration| tests/integration/customers-cards-adversarial.test.ts > independent M2 customer and card adversarial checks > I-20 export snapshot ordered before card linking remains unassigned while a later export records linked 233ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-20 immutable XLSX snapshots prepare privately with checksum and never mutate inventory 224ms
✓ |integration| tests/integration/customers-cards-adversarial.test.ts > independent M2 customer and card adversarial checks > I-20 export ordered before lifecycle activation retains original batch metadata and original pending receipt 111ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > D08 PDF requires configured layout; preparation failures retain the same snapshot and bounded retry 86ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > D08 invalid physical layout rejects PDF before snapshot while independent XLSX remains usable 89ms
✓ |integration| tests/integration/customers-cards-adversarial.test.ts > independent M2 customer and card adversarial checks > I-09 grant revocation while a card write waits cannot authorize either a commit or receipt replay 46ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > export snapshots cannot gain additional rows after the creation transaction 147ms
✓ |integration| tests/integration/customers-cards-adversarial.test.ts > independent M2 customer and card adversarial checks > I-07 every customer and card route rejects absent, restricted, wrong-kind and ungranted authority 396ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > ready artifacts require all checksum metadata and cannot be overwritten after publication 89ms
✓ |integration| tests/integration/customers-cards-adversarial.test.ts > independent M2 customer and card adversarial checks > I-07 HTTP rejects cross-origin reads by POST, oversized bodies, unsupported fields and duplicate query parameters 58ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-52 automatically terminalizes two crashed final claims and releases their preparation quota without changing snapshots or inventory 150ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-52 recovers a final renderer that finishes after expiry and fences its bytes permanently 55ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-52 preserves unexpired final claims and their active quota until their leases end 72ms
✓ |integration| tests/integration/customers-cards-adversarial.test.ts > independent M2 customer and card adversarial checks > I-20 private prepared bytes remain checksum-identical, GETs do not prepare files, replay retains pending receipt, and expiry requires a new export 221ms
✓ |integration| tests/integration/customers-cards-adversarial.test.ts > independent M2 customer and card adversarial checks > I-09 revoked creator permission blocks both preparation and a previously prepared download 97ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > HTTP validates bodies, origin, cookie surface, oversized input and fixed category 181ms
✓ |integration| tests/integration/customers-cards-adversarial.test.ts > independent M2 customer and card adversarial checks > I-52 a renderer from an expired lease cannot replace a newer worker's private artifact 89ms
✓ |integration| tests/integration/customers-cards-adversarial.test.ts > independent M2 customer and card adversarial checks > I-16 retired exact card search resolves its historical customer and the retired code can never be allocated again 60ms
✓ |integration| tests/integration/customers-cards-adversarial.test.ts > independent M2 customer and card adversarial checks > I-20 linking ordered before PDF snapshot excludes that linked card and cannot later broaden the print sheet 53ms
✓ |integration| tests/integration/customers-cards-adversarial.test.ts > independent M2 customer and card adversarial checks > I-14 registration provenance remains original after pump reassignment and a fresh same-account receipt replay 50ms
```

### Named unit output

```text
✓ |unit| src/server/adapters/phone.test.ts > D08 phone normalization > canonicalizes presentation variants before uniqueness without dropping arbitrary digits 1ms
✓ |unit| src/server/adapters/phone.test.ts > D08 phone normalization > fails closed in production until the explicit numbering policy is configured 0ms
✓ |unit| src/server/adapters/card-artifacts.test.ts > writes private random keys with the renderer content type and no signing API 2ms
✓ |unit| src/server/adapters/card-artifacts.test.ts > bounds declared and streamed bytes and destroys streams on both failure and success 0ms
✓ |unit| src/server/adapters/card-artifacts.test.ts > rejects invalid endpoints http://remote.example.test 0ms
✓ |unit| src/server/adapters/card-artifacts.test.ts > rejects invalid endpoints https://name:pass@remote.example.test 0ms
✓ |unit| src/server/adapters/card-artifacts.test.ts > rejects invalid endpoints https://remote.example.test/path 0ms
✓ |unit| src/server/adapters/card-artifacts.test.ts > rejects invalid endpoints https://remote.example.test/?query=1 0ms
✓ |unit| src/server/adapters/card-artifacts.test.ts > rejects invalid endpoints https://remote.example.test/#fragment 0ms
✓ |unit| src/server/modules/cards/config.test.ts > D08 card export configuration > unconfigured/invalid layout remains unavailable while XLSX configuration works: undefined 1ms
✓ |unit| src/server/modules/cards/config.test.ts > D08 card export configuration > unconfigured/invalid layout remains unavailable while XLSX configuration works: invalid 0ms
✓ |unit| src/server/modules/cards/config.test.ts > D08 card export configuration > unconfigured/invalid layout remains unavailable while XLSX configuration works: {} 0ms
✓ |unit| src/server/modules/cards/config.test.ts > D08 card export configuration > unconfigured/invalid layout remains unavailable while XLSX configuration works: {"pageWidthMm":0,"pageHeightMm":297,"cardWidthMm":85.6,"cardHeightMm":54,"marginMm":10,"gapMm":2} 0ms
✓ |unit| src/server/modules/cards/config.test.ts > D08 card export configuration > unconfigured/invalid layout remains unavailable while XLSX configuration works: {"pageWidthMm":40,"pageHeightMm":40,"cardWidthMm":85.6,"cardHeightMm":54,"marginMm":10,"gapMm":2} 0ms
✓ |unit| src/server/modules/cards/config.test.ts > D08 card export configuration > accepts explicitly configured fitting physical dimensions and positive lifetime 0ms
✓ |unit| src/server/modules/cards/config.test.ts > D08 card export configuration > rejects malformed artifact lifetime 0 0ms
✓ |unit| src/server/modules/cards/config.test.ts > D08 card export configuration > rejects malformed artifact lifetime -1 0ms
✓ |unit| src/server/modules/cards/config.test.ts > D08 card export configuration > rejects malformed artifact lifetime NaN 0ms
✓ |unit| src/server/modules/cards/config.test.ts > D08 card export configuration > rejects malformed artifact lifetime 1.5 0ms
✓ |unit| src/server/modules/cards/config.test.ts > D08 card export configuration > rejects malformed artifact lifetime Infinity 0ms
✓ |unit| src/server/modules/cards/runtime.test.ts > opens no resources during build or without storage/database configuration 2ms
✓ |unit| src/server/modules/cards/runtime.test.ts > starts once, bounds the pool and binds automatic restart work without PDF configuration 2ms
✓ |unit| src/server/modules/cards/runtime.test.ts > never overlaps slow render batches and limits successful work per tick 1ms
✓ |unit| src/server/modules/cards/runtime.test.ts > drains active preparation before invoking prior mail/Next signal handlers once 1ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > prints only unassigned snapshot cards, actual decodable QRs, labels and page numbers 62ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > handles Unicode metadata visibly with Unicode escapes rather than missing glyphs 18ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > writes all states, raw QR, text codes, eligibility and immutable export metadata to XLSX 20ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > neutralizes formula-like text metadata "=1+1" 6ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > neutralizes formula-like text metadata "+cmd" 5ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > neutralizes formula-like text metadata "-1+2" 5ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > neutralizes formula-like text metadata "@SUM(A1)" 5ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > neutralizes formula-like text metadata "\t=1" 5ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > neutralizes formula-like text metadata "\r=1" 4ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > neutralizes formula-like text metadata "\n=1" 4ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > neutralizes formula-like text metadata "  =1" 4ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > requires explicit PDF layout while XLSX works independently 1ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > rejects unsafe or non-fitting layout {"pageWidthMm":null} 0ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > rejects unsafe or non-fitting layout {"pageHeightMm":null} 0ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > rejects unsafe or non-fitting layout {"cardHeightMm":0} 0ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > rejects unsafe or non-fitting layout {"marginMm":-1} 0ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > rejects unsafe or non-fitting layout {"gapMm":-1} 0ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > rejects unsafe or non-fitting layout {"pageWidthMm":1001} 0ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > rejects unsafe or non-fitting layout {"cardWidthMm":10} 0ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > rejects unsafe or non-fitting layout {"cardHeightMm":20} 0ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > rejects unsafe or non-fitting layout {"marginMm":30} 0ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > rejects unsafe or non-fitting layout {"gapMm":null} 0ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > rejects unsafe or non-fitting layout {"pageHeightMm":62} 0ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > rejects empty PDF printable inventory 0ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > rejects payload that is not exactly its normalized printed code: "https://example.com/ABCDEFG" 0ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > rejects payload that is not exactly its normalized printed code: "abcdefg" 0ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > rejects payload that is not exactly its normalized printed code: "ABCDEFG\n" 0ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > rejects payload that is not exactly its normalized printed code: "XYZ2345" 0ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > keeps four-module QR quiet zones and decodable pixels at the minimum configured card size 16ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > prints unassigned cards in non-active batches without claiming assignment eligibility 11ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > neutralizes every free-text XLSX metadata field and retains Unicode labels 5ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > rejects printed codes outside the v1 alphabet even when payload matches 0ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > rejects more than the bounded 1000-card snapshot 0ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > sorts by snapshot ordinal and does not mutate input 16ms
```

The permission-first file guard was independently reproduced as a failing 403-versus-503 test, then passed after correction. Invalid physical layout now rejects PDF before a snapshot is recorded while XLSX stays usable. Later transactions cannot append snapshot items, and published checksum/artifact metadata cannot be rewritten. Round-one code and integrity review independently reproduced P1 exhausted final leases remaining pending and consuming quota. Three additional real-PostgreSQL regressions failed before the fix and now verify bounded automatic terminalization, capacity recovery, stale-render fencing and preservation of live final claims; no original assertion was removed.


## Limits

Phone numbering and physical printing remain D08 configuration/approval boundaries. No UI parity, phone change, card replacement, manager intake, physical print confirmation, cloud configuration or staging-data operation is claimed. T-18 records the local MIT-licensed runtime libraries; WHR-82 tracks the moderate advisory in ExcelJS's unused transitive UUID functions.
