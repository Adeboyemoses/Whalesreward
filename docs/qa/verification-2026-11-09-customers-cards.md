# Customers and card batches verification — 9 Nov 2026

WO-core-7 / WHR-12. Backend acceptance against `docs/engineering/contracts/m2.md`. EM verification on frozen implementation and tests `09e39ec` (including both review-driven recovery fixes); approval/review and the READY records follow separately.

Final combined staging verification is recorded below: 333 unit tests, 260 PostgreSQL tests, 168 browser passes plus four existing skips and signed-upload1. The named 59+58 output remains the reviewed customer/card source verification; the later base merge adds independently reviewed app tests.

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

All commands below were executed by the EM. A clean PostgreSQL database applied all 10 migrations; new migrations are additive and existing migration files are unchanged. The dedicated Linux browser container received a `git archive` of `09e39ec` with the frozen lockfile, without secrets, product docs or a developer checkout.

```text
pnpm typecheck                                      exit 0
pnpm lint                                           exit 0, no warnings
pnpm test                                           40 files, 318 passed (2.17s)
pnpm build                                          exit 0; Workbox 32 generic assets
pnpm test:integration                               18 files, 260 passed (9.55s)
pnpm test:time                                      3 passed in UTC; 3 passed in America/New_York
named customer/card integration                     2 files, 59 passed (5.90s)
named renderer/config/runtime/storage/phone units    5 files, 58 passed (696ms)
pnpm test:e2e (Linux Chromium)                       130 passed, 4 existing staging-only skips (1.4m)
Playwright signed-upload browser test                1 passed (411ms)
```

No backend test was skipped and browser retries were zero. Existing auth, sync, evidence, station, P-20 and P-21 regressions are part of the 260-test integration run; their assertions were not weakened. The 59 named tests below cover primary and independently authored cases. Runtime tests bind the actual automatic preparation loop, test bounded nonoverlap, and preserve prior mail/Next shutdown handlers. Renderer tests decode the actual QR image bytes embedded in PDF and reopen the actual XLSX workbook.

### Named integration output

```text
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-16/I-20 reserves cryptographic globally unique codes and returns original inventory on replay 47ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-18 requires forward CAS transitions, reason, audit and historical Domain replay 35ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-19 inactive cards cannot register and failed attempts leave no customer or receipt 17ms
✓ |integration| tests/integration/customers-cards-adversarial.test.ts > independent M2 customer and card adversarial checks > I-16 bounded code collisions roll back every card, batch, audit and receipt and permit same-key retry 36ms
✓ |integration| tests/integration/customers-cards-adversarial.test.ts > independent M2 customer and card adversarial checks > I-15 normalized phone and parsed QR/code content replay one registration while changed content conflicts 41ms
✓ |integration| tests/integration/customers-cards-adversarial.test.ts > independent M2 customer and card adversarial checks > I-14 unknown legacy registration provenance stays null despite a known card link actor 11ms
✓ |integration| tests/integration/customers-cards-adversarial.test.ts > independent M2 customer and card adversarial checks > I-42 I-44 exact accepted totals ignore late proposals and campaign cutoff, preserve duplicates, and separate product units and upload pending 68ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-14/I-15/I-19 two registrations racing for one phone create exactly one customer/link 37ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-19 same card race rolls back losing customer; exact lookup follows the successful link 31ms
✓ |integration| tests/integration/customers-cards-adversarial.test.ts > independent M2 customer and card adversarial checks > I-07 card inventory without customers permission never reveals linked customer identity 39ms
✓ |integration| tests/integration/customers-cards-adversarial.test.ts > independent M2 customer and card adversarial checks > I-07 customer cursors bind actor, endpoint, category and query 76ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > registration replay preserves immutable provenance and only the original account can see the receipt 120ms
✓ |integration| tests/integration/customers-cards-adversarial.test.ts > independent M2 customer and card adversarial checks > I-20 export snapshot ordered before card linking remains unassigned while a later export records linked 223ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-20 immutable XLSX snapshots prepare privately with checksum and never mutate inventory 183ms
✓ |integration| tests/integration/customers-cards-adversarial.test.ts > independent M2 customer and card adversarial checks > I-20 export ordered before lifecycle activation retains original batch metadata and original pending receipt 123ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > D08 PDF requires configured layout; preparation failures retain the same snapshot and bounded retry 125ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > D08 invalid physical layout rejects PDF before snapshot while independent XLSX remains usable 67ms
✓ |integration| tests/integration/customers-cards-adversarial.test.ts > independent M2 customer and card adversarial checks > I-09 grant revocation while a card write waits cannot authorize either a commit or receipt replay 55ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > export snapshots cannot gain additional rows after the creation transaction 81ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > ready artifacts require all checksum metadata and cannot be overwritten after publication 111ms
✓ |integration| tests/integration/customers-cards-adversarial.test.ts > independent M2 customer and card adversarial checks > I-07 every customer and card route rejects absent, restricted, wrong-kind and ungranted authority 357ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-52 automatically terminalizes two crashed final claims and releases their preparation quota without changing snapshots or inventory 165ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-52 recovers a final renderer that finishes after expiry and fences its bytes permanently 77ms
✓ |integration| tests/integration/customers-cards-adversarial.test.ts > independent M2 customer and card adversarial checks > I-07 HTTP rejects cross-origin reads by POST, oversized bodies, unsupported fields and duplicate query parameters 64ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-52 preserves unexpired final claims and their active quota until their leases end 66ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-52 PDF configuration loss terminalizes pending/0 with missing layout and absent lease, one row per polling step 119ms
✓ |integration| tests/integration/customers-cards-adversarial.test.ts > independent M2 customer and card adversarial checks > I-20 private prepared bytes remain checksum-identical, GETs do not prepare files, replay retains pending receipt, and expiry requires a new export 191ms
✓ |integration| tests/integration/customers-cards-adversarial.test.ts > independent M2 customer and card adversarial checks > I-09 revoked creator permission blocks both preparation and a previously prepared download 73ms
✓ |integration| tests/integration/customers-cards-adversarial.test.ts > independent M2 customer and card adversarial checks > I-52 a renderer from an expired lease cannot replace a newer worker's private artifact 83ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-52 PDF configuration loss terminalizes pending/0 with missing layout and expired lease, one row per polling step 100ms
✓ |integration| tests/integration/customers-cards-adversarial.test.ts > independent M2 customer and card adversarial checks > I-16 retired exact card search resolves its historical customer and the retired code can never be allocated again 58ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-52 PDF configuration loss terminalizes pending/0 with malformed layout and absent lease, one row per polling step 109ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-52 PDF configuration loss terminalizes pending/0 with malformed layout and expired lease, one row per polling step 80ms
✓ |integration| tests/integration/customers-cards-adversarial.test.ts > independent M2 customer and card adversarial checks > I-20 linking ordered before PDF snapshot excludes that linked card and cannot later broaden the print sheet 79ms
✓ |integration| tests/integration/customers-cards-adversarial.test.ts > independent M2 customer and card adversarial checks > I-14 registration provenance remains original after pump reassignment and a fresh same-account receipt replay 65ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-52 PDF configuration loss terminalizes pending/1 with missing layout and absent lease, one row per polling step 77ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-52 PDF configuration loss terminalizes pending/1 with missing layout and expired lease, one row per polling step 73ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-52 PDF configuration loss terminalizes pending/1 with malformed layout and absent lease, one row per polling step 87ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-52 PDF configuration loss terminalizes pending/1 with malformed layout and expired lease, one row per polling step 96ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-52 PDF configuration loss terminalizes pending/2 with missing layout and absent lease, one row per polling step 126ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-52 PDF configuration loss terminalizes pending/2 with missing layout and expired lease, one row per polling step 144ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-52 PDF configuration loss terminalizes pending/2 with malformed layout and absent lease, one row per polling step 148ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-52 PDF configuration loss terminalizes pending/2 with malformed layout and expired lease, one row per polling step 136ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-52 PDF configuration loss terminalizes failed/0 with missing layout and absent lease, one row per polling step 195ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-52 PDF configuration loss terminalizes failed/0 with missing layout and expired lease, one row per polling step 182ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-52 PDF configuration loss terminalizes failed/0 with malformed layout and absent lease, one row per polling step 180ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-52 PDF configuration loss terminalizes failed/0 with malformed layout and expired lease, one row per polling step 172ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-52 PDF configuration loss terminalizes failed/1 with missing layout and absent lease, one row per polling step 185ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-52 PDF configuration loss terminalizes failed/1 with missing layout and expired lease, one row per polling step 184ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-52 PDF configuration loss terminalizes failed/1 with malformed layout and absent lease, one row per polling step 161ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-52 PDF configuration loss terminalizes failed/1 with malformed layout and expired lease, one row per polling step 192ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-52 PDF configuration loss terminalizes failed/2 with missing layout and absent lease, one row per polling step 183ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-52 PDF configuration loss terminalizes failed/2 with missing layout and expired lease, one row per polling step 172ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-52 PDF configuration loss terminalizes failed/2 with malformed layout and absent lease, one row per polling step 159ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-52 PDF configuration loss terminalizes failed/2 with malformed layout and expired lease, one row per polling step 174ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-52 missing layout preserves live pending and retry PDF leases and their quota until expiry 144ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-52 configuration-loss recovery preserves a live PDF renderer then fences its late bytes after lease expiry 69ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > I-52 automatic polling terminalizes configuration-blocked PDFs without any GET and resumes independent XLSX 144ms
✓ |integration| tests/integration/customers-cards.test.ts > M2 atomic customers and card inventory > HTTP validates bodies, origin, cookie surface, oversized input and fixed category 201ms
```

### Named unit output

```text
✓ |unit| src/server/adapters/phone.test.ts > D08 phone normalization > canonicalizes presentation variants before uniqueness without dropping arbitrary digits 3ms
✓ |unit| src/server/adapters/phone.test.ts > D08 phone normalization > fails closed in production until the explicit numbering policy is configured 1ms
✓ |unit| src/server/adapters/card-artifacts.test.ts > writes private random keys with the renderer content type and no signing API 2ms
✓ |unit| src/server/adapters/card-artifacts.test.ts > bounds declared and streamed bytes and destroys streams on both failure and success 1ms
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
✓ |unit| src/server/modules/cards/runtime.test.ts > never overlaps slow render batches and limits successful work per tick 3ms
✓ |unit| src/server/modules/cards/runtime.test.ts > drains active preparation before invoking prior mail/Next signal handlers once 1ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > prints only unassigned snapshot cards, actual decodable QRs, labels and page numbers 76ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > handles Unicode metadata visibly with Unicode escapes rather than missing glyphs 27ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > writes all states, raw QR, text codes, eligibility and immutable export metadata to XLSX 34ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > neutralizes formula-like text metadata "=1+1" 12ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > neutralizes formula-like text metadata "+cmd" 13ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > neutralizes formula-like text metadata "-1+2" 10ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > neutralizes formula-like text metadata "@SUM(A1)" 11ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > neutralizes formula-like text metadata "\t=1" 10ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > neutralizes formula-like text metadata "\r=1" 8ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > neutralizes formula-like text metadata "\n=1" 8ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > neutralizes formula-like text metadata "  =1" 6ms
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
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > keeps four-module QR quiet zones and decodable pixels at the minimum configured card size 31ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > prints unassigned cards in non-active batches without claiming assignment eligibility 13ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > neutralizes every free-text XLSX metadata field and retains Unicode labels 11ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > rejects printed codes outside the v1 alphabet even when payload matches 0ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > rejects more than the bounded 1000-card snapshot 0ms
✓ |unit| src/server/modules/cards/renderer.test.ts > card export renderer > sorts by snapshot ordinal and does not mutate input 23ms
```

The permission-first file guard was independently reproduced as a failing 403-versus-503 test, then passed after correction. Invalid physical layout now rejects PDF before a snapshot is recorded while XLSX stays usable. Later transactions cannot append snapshot items, and published checksum/artifact metadata cannot be rewritten. Round-one code and integrity review independently reproduced P1 exhausted final leases remaining pending and consuming quota. Three additional real-PostgreSQL regressions failed before the fix and now verify bounded automatic terminalization, capacity recovery, stale-render fencing and preservation of live final claims; no original assertion was removed. Round two additionally reproduced queued PDFs below the retry cap being skipped forever after valid layout configuration disappeared, consuming both creator slots and blocking XLSX. The configuration-loss fix adds 27 cases: a 24-case pending/failed × attempt 0/1/2 × missing/malformed layout × absent/expired lease matrix, live-lease quota protection, actual bounded automatic polling without GET, and a stale PDF callback fenced after recovery. Those snapshots now fail through bounded polling and release capacity; live leases and prepared artifacts remain protected.


## Limits

Phone numbering and physical printing remain D08 configuration/approval boundaries. No UI parity, phone change, card replacement, manager intake, physical print confirmation, cloud configuration or staging-data operation is claimed. T-18 records the local MIT-licensed runtime libraries; WHR-82 tracks the moderate advisory in ExcelJS's unused transitive UUID functions.

## Final combined staging verification

The EM merged separately reviewed app station UI #80 (9768962) into the reviewed customer/card branch, producing bb1e86ecf938ad9997de76526a6e5d181099421a. No customer/card production or test file changed after the final reviewed head3161c08; only evidence and unrelated base files differ. The evidence validator passed with the current staging base. A git archive of the exact final head was installed in the isolated Linux browser container.

```text
pnpm typecheck                                  exit 0
pnpm lint                                       exit 0, no warnings
pnpm test                                       43 files, 333 passed (1.51s)
pnpm build                                      exit 0; Workbox 32 generic assets
pnpm test:integration                           18 files, 260 passed (9.60s)
pnpm test:time                                  3 passed in UTC; 3 passed in America/New_York
pnpm test:e2e (Linux Chromium)                   168 passed, 4 existing staging-only skips (1.8m)
Playwright signed-upload browser test            1 passed (409ms)
pnpm audit --prod                               moderate1, high0, critical0 (WHR-82)
```

Local browser retries were zero. Feature CI run42545843483 instead reported166 passed,2 flaky and4 skipped; both cases passed retry, and storage1 passed. The station uncertain-replay failure was duplicate route fulfilment at assignment-end-fake.ts:63 (WHR-83); handover hit the already tracked interrupted sign-in navigation at offline-browser.ts:5 (WHR-67). No incorrect account access was observed and root cause for the route fixture remains unconfirmed. No assertion or configured retry count changed. The changed browser/unit counts come from the independently reviewed station UI base; no new customer/card UI parity or device acceptance is claimed. Feature #81 merged with all five required CI checks green. This records-only update adds no runtime implementation or relaxed assertion.
