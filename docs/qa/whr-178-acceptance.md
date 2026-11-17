# WHR-178 T-21 acceptance evidence

Scope: six read-only projections over WHR-22. The specification is `docs/engineering/contracts/m4.md`, “Granular outcomes and narrow selections — WHR-170 / T-21”, including its complete core acceptance paragraph. Grouped Readiness and mutation behavior are not authorized to change. No READY or complete-acceptance claim is made by this document.

The new tests are in `tests/integration/giveaway-projections.test.ts` (B below) and `tests/integration/giveaway-projections-adversarial.test.ts` (A). Names below are exact Vitest names, except the clearly identified parameterized HTTP name. Tests use real disposable PostgreSQL schemas. The adversarial local run uses the `whr178_fixture` non-superuser, without BYPASSRLS. Historical/corrupt-evidence fixtures use the existing `seedHistorical` helper to establish retained state, then restore native guards before exercising services. The equality test replaces only the SQL clock expression; PostgreSQL performs the actual microsecond comparisons.

## Acceptance mapping

| T-21 acceptance clause | Named evidence |
|---|---|
| All nine rows, independently unresolved cases | B: `T-21 live checklist preserves grouped readiness and returns all nine ordered outcomes`; A: `T21 ordinary holds independently count history and open purchases without P29-only targets`; `T21 corrections independently block pending proposals without replacing accepted contribution`; `T21 duplicate pairs deduplicate the primary purchase while either side remains relevant`; `T21 stale inactive P29 with apparently closed target remains a station-wide blocker`; `T21 accepted legacy photo without trusted proof keeps grouped uploads unresolved`; `T21 eligibility independently retains unknown campaign relevance without ordinary holds`; `T21 phone census missing stale and complete outcomes never infer unknown devices`; `T21 exact cutoff equality blocks and phase crossing invalidates view without a generation write`. Upload/photo obligations deliberately overlap; these are not claimed to be mutually exclusive blockers. |
| Overlapping counts; unchanged grouped blocker unions | A: `T21 uploads and photo proof overlap without changing grouped readiness unions`; B: `T-21 live checklist preserves grouped readiness and returns all nine ordered outcomes`. |
| Policy missing versus evaluated zero versus not_applicable | B: `T-21 policy missing differs from zero and not_applicable without synthesizing a pass`; A: `T21 proven late complete-photo sources are settled exclusions rather than missing proof`. |
| Pending stale/inactive P-29, apparently closed target | A: `T21 stale inactive P29 with apparently closed target remains a station-wide blocker`. |
| Stored pass and unchanged result after later mutation, no recomputation/leakage | B: `T-21 stored historical pass retains counts after later mutations and differs from live outcomes`; A: `T21 unchanged historical result preserves exact stored checks after later intake and snapshots remain immutable`; `T21 malformed retained check evidence returns 503 rather than synthesized pass`. |
| Live/stored distinction | Same historical-result tests; A: `T21 new intake after preparation prevents confirmation without rewriting historical result`. |
| Exact time equality; phase crossing without source generation change | A: `T21 exact cutoff equality blocks and phase crossing invalidates view without a generation write`. Zero grace uses the same exact cutoff/deadline boundary. |
| Conservative required accounts: disabled, ended assignments, multiple phones and partitions | B: `T-21 conservative required accounts retain disabled staff and ended assignments`; A: `T21 101-plus historical candidates page completely and first-page census cannot certify`; `T21 shared account partitions keep both phones and require independent canonical approval`. “Leaver” is not inferred from account state. |
| 101+ candidates over pages; incomplete coverage cannot certify | A: `T21 101-plus historical candidates page completely and first-page census cannot certify`. Asserts all 103 required IDs, stable order, no repeats, terminal cursor, and first-page-only census rejection. |
| Eligible manager current action grant, revoked authority, changed/unverified/alias binding | B: `T-21 inventory selection requires named manager and verified canonical person`; `T-21 current designation remains visible when manager role becomes ineligible`; A: `T21 changed verified and alias person bindings invalidate selection without promising independence`; `T21 revoked manager action fails current authorization before old cursor decoding`; `T21 shared account partitions keep both phones and require independent canonical approval`. |
| Owner settings+sales without leaderboards; current ineligible designation | B: `T-21 Owner with settings and sales but no leaderboards sees current designation and eligible choices without directory grants`; `T-21 current designation remains visible when manager role becomes ineligible`. |
| Owner lacks settings/sales; reader lacks sales/action/directory grants | B: `T-21 Owner without settings or sales and readers without action grants are denied`; `T-21 checklist without sales exposes aggregate outcomes and omits protected links and fields`; Owner selector success above proves no unrelated directory grant needed. |
| Foreign parents, cursors, generic failed writes | B: `T-21 malformed queries foreign parents and forged cursors fail without details`; A: `T21 cursor binds route and limit and rejects obsolete complete view`; `T21 generic failed writes do not disclose unknown versus ineligible targets`. See remaining subcases below. |
| No-ever-accepted versus accepted-then-cancelled/finalizing; observation without fact; missing legacy proof | B: `T-21 incomplete sources include received and photo_pending originals but exclude finalizing held accepted and cancelled`; A: `T21 accepted-then-cancelled and superseded revision histories never become incomplete candidates`; `T21 sealed observation without final fact removes candidate and invalidates selection`; `T21 accepted legacy photo without trusted proof keeps grouped uploads unresolved`. |
| Receipt/source changes between list and proposal | A: `T21 sealed observation without final fact removes candidate and invalidates selection`. The explicit false fields are not reused as authority. |
| Changes between proposal and independent decision | A: `T21 byte arrival between proposal and independent decision refuses obsolete source`. |
| Changes between independent approval, phone check and preparation | A: `T21 byte arrival after approval invalidates phone certification and preparation`. |
| Partition/predecessor changes | A: `T21 partition replacement invalidates phone and source views before proposal`; `T21 snapshot predecessor changes derived action and invalidates initial selection`. |
| Changes between preparation and confirmation | A: `T21 new intake after preparation prevents confirmation without rewriting historical result`. Existing real transaction races are separately listed below. |
| Least-privilege fields and links | B: `T-21 checklist without sales exposes aggregate outcomes and omits protected links and fields`; `T-21 Owner with settings and sales but no leaderboards sees current designation and eligible choices without directory grants`; `T-21 incomplete sources include received and photo_pending originals but exclude finalizing held accepted and cancelled`. |
| No business read audit or dirty-clear | B: `T-21 reads do not create business audits receipts or clear dirty state`. Checks audit/receipt counts and reconciliation flag before/after reads. |
| No duplicate applicable source exclusion | **FAIL / WHR-179**: A: `T21 WHR-179 duplicate applicable source exclusions cannot certify or prepare`. Ordinary failing assertion; no skip, expected-failure wrapper, or diagnostic pass. Existing mutation allows two independently approved phone exclusions for one source, then certifies both. Read-only scope cannot resolve this. |
| Response and body limits | A: `T21 response budget continues large phone pages without dropping or truncating partitions`; `T21 read bounds reject excess filters empty tokens oversized cursors and limits`; `T21 mutation source and partition limits stay 100 and real HTTP body limit stays 32 KiB`. |
| Immutable historical results | A: `T21 unchanged historical result preserves exact stored checks after later intake and snapshots remain immutable`; `T21 new intake after preparation prevents confirmation without rewriting historical result`. |
| All six new routes through real HTTP | B: `T-21 all six routes traverse real HTTP with strict envelopes no-store and typed history`; six instances of `T-21 real HTTP %s rejects no session, missing grants and unknown input` for checklist, results, managers, attendants, phones, incomplete-sources. Listener dispatches actual exported route GET functions. |
| Authority race at lock wait | B: `T-21 grant revoked while waiting for security lock is reauthorized before HTTP success`. |

## Existing regression evidence to rerun

These are existing named tests, not newly written coverage or a claim that they passed this change's final head:

- `P-30 proposer identity rebinding cannot silently rebase an existing exclusion` and `P-30 revoked manager grant denies independent approval and manager proposal replay` in `giveaway-phones.test.ts`.
- `P-30 non-superuser cannot attach another campaign census or omit its check entries` in `giveaway-phones.test.ts`.
- `P-30 exact incomplete source approval suppresses only its upload obligation and retains review blockers` in `giveaway-phones.test.ts`.
- `I-46 phantom purchase intake and confirmation serialize without silently losing source history` in `giveaway-snapshots.test.ts`.
- `I-46 every durable M3 source table participates in the shared reporting-generation protocol` and `I-46 actual M3 duplicate clear and cancellation services invalidate reviewed snapshot guards` in `giveaway-writers.test.ts`.
- `SR-06 persisted %s transition invalidates real giveaway confirmation even after pending blocker closes` in `giveaway-writers.test.ts`.

## Additional boundary evidence and reachability limits

The following new named tests close the previously listed explicit subcases:

- `T21 required purchase accounts cannot lose assignment or identity through ordinary constrained writes`: proves native composite assignment/identity FKs and NOT NULL prevent a normal purchase-only orphan or missing identity. The conservative purchase-union predicate remains unchanged. This is a constraint test, not a claim that invalid retained orphan data was successfully created.
- `T21 required historical labels fail closed rather than guessing or omitting an account`: a retained out-of-bounds label yields 503, without an invented label or silent omission.
- `T21 known valid foreign-schema campaign phone and stored result IDs return identical not_found`: IDs are created in a second disposable schema and sent to the first schema's authenticated services. This demonstrates resource-namespace isolation; it does not invent multi-station operation inside the one-station database.
- `T21 authorized different caller and full phone parent cannot reuse a valid signed cursor`: valid signed manager cursor used by another authorized Owner, and valid source cursor used under another current phone, both return 400.
- `T21 disabled candidate role and still-verified person rebinding invalidate manager choices`: checks both explicit role disablement and rebinding to a different verified canonical person.
- `T21 photo fact for a different asset remains unbound to the selected accepted evidence`: native validated-byte fact exists for another asset, yet the accepted revision's evidence remains unresolved with photo_proof_unbound.
- `T21 a single oversized retained result returns 413 over real HTTP without partial evidence`: a retained result whose syntactically valid count exceeds the response budget produces only the 413 error envelope.
- `T21 acceptance after source selection invalidates view and cannot be proposed as incomplete`: the selected purchase transitions through finalizing to credited with an accepted revision under native constraints. Its old view becomes stale and a new exclusion proposal rejects it.
- `T21 all projection reads leave certification reconciliation preview snapshot and source tables unchanged`: checks all six reads against audits, receipts, reconciliation/check/preview/snapshot/consumption rows, purchases/revisions and the full campaign row.
- `T21 missing protected source digest cannot be serialized as a historical pass` and `T21 mismatched retained actor binding cannot be serialized as a historical pass`: verify malformed protected retained evidence is not ignored merely because public fields look valid.

The lifecycle coverage includes each change class (receipt, acceptance, partitions, predecessor) and every boundary (list, proposal, independent decision, certification, preparation, confirmation). It does not claim every Cartesian combination; existing named transaction races above supplement the new tests.

Production deployment, real station data, browser/fidelity and Stage 2b client retry/session handling remain outside this work order's test surface. Local PostgreSQL is version 15. Tests requiring PostgreSQL 16 functions remain a CI requirement; no compatibility shim is installed. WHR-179 prevents a green acceptance/READY claim while the mutation-preservation instruction remains in force.

## Retained evidence and authority regressions

The protected-history cases additionally test missing and invalid `sourceDigest`, mismatched actor binding, unchanged outcome without predecessor, and duplicate approved exclusion IDs. Each requires 503 rather than a historical pass. Missing/invalid operation IDs are separately named native-constraint tests: generated UUID/NOT NULL columns prevent those retained states even with user triggers disabled. No schema constraints are removed to manufacture reachability.

`T21 verified caller binding revoked while waiting for security lock denies inventory` holds the security row lock, appends an unverified latest binding in the writer transaction, starts the inventory read and confirms its lock wait, then commits. The read must deny 403 after the change. This tests append-only authority independent of role/session revision changes.

## Recorded adversarial run

17 Nov 2026, production implementation through `e529185` (local cherry-pick `d71cb17`), local PostgreSQL 15, non-superuser fixture account. Final run results are recorded after execution below. The EM must rerun the final integrated head and full required gates. This work is not READY while acceptance regressions fail.

```text
Test Files  1 failed (1)
Tests       7 failed | 39 passed (46)
Duration    51.81s
```

The seven ordinary failing assertions are WHR-179 duplicate applicability; missing source digest; invalid source digest; mismatched actor binding; unchanged outcome without predecessor; duplicate approved exclusion IDs; and verified caller binding revoked during the security-lock wait. None is skipped or treated as an expected pass. The lock-race fixture asserts one appended binding and latest verified=false after commit. Typecheck and focused ESLint passed. Local log: `/tmp/whr178-adversarial-final46c.log` (not committed). These results precede review fixes; their presence in this matrix is evidence of regressions requiring repair, not a claim that final integrated production still has each defect.
