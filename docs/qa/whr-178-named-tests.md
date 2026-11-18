# WHR-178 named PostgreSQL tests

EM serial rerun on rebased code head `e46a1afaa3977a56b28660d74ff2ee3ccae58615`, 18 Nov 2026, based on staging `6d2e504` including WHR-179 and WHR-181. Disposable local PostgreSQL 15; NOSUPERUSER/NOBYPASSRLS fixture role. **66 passed, 1 failed, 67 total; no skips.** Both projection test files are unchanged from parked `6aa6ea6`. All six actual exported GET routes execute over localhost HTTP, including success, authentication, permission and malformed-input cases.

The sole failure now occurs earlier: WHR-179 correctly rejects the second conflicting approval with `409 exclusion_stale` at `phones.ts:633`, while the unchanged test unconditionally expects it to succeed at line 740. This is an expectation mismatch, not the previous mutation defect. [WHR-182](https://linear.app/phaneum/issue/WHR-182/whr-178-resume-decide-regression-update-and-bounded-review-after) requests Earl's decision on changing the test and one bounded review beyond round cap 3. PR #164 remains draft, not READY.

Additional EM verification: typecheck, lint (four existing image warnings), 997 unit tests and production build PASS; review self-tests 53, guard self-tests 94, time tests 5 in each timezone PASS. All 81 existing giveaway regressions pass serially in 12 files, including photo receipts, the three named WHR-179 guards, and all named authority/writer/snapshot regressions in the acceptance mapping. CI uses PostgreSQL 16; local PG16 initialization was blocked by sandbox shared-memory restrictions. No compatibility shim or safety-guard relaxation.

| Result | Exact test name |
|---|---|
| PASSED | T21 ordinary holds independently count history and open purchases without P29-only targets |
| PASSED | T21 corrections independently block pending proposals without replacing accepted contribution |
| PASSED | T21 duplicate pairs deduplicate the primary purchase while either side remains relevant |
| PASSED | T21 stale inactive P29 with apparently closed target remains a station-wide blocker |
| PASSED | T21 uploads and photo proof overlap without changing grouped readiness unions |
| PASSED | T21 accepted legacy photo without trusted proof keeps grouped uploads unresolved |
| PASSED | T21 phone census missing stale and complete outcomes never infer unknown devices |
| PASSED | T21 101-plus historical candidates page completely and first-page census cannot certify |
| PASSED | T21 cursor binds route and limit and rejects obsolete complete view |
| PASSED | T21 changed verified and alias person bindings invalidate selection without promising independence |
| PASSED | T21 sealed observation without final fact removes candidate and invalidates selection |
| PASSED | T21 accepted-then-cancelled and superseded revision histories never become incomplete candidates |
| PASSED | T21 byte arrival between proposal and independent decision refuses obsolete source |
| PASSED | T21 partition replacement invalidates phone and source views before proposal |
| PASSED | T21 snapshot predecessor changes derived action and invalidates initial selection |
| PASSED | T21 unchanged historical result preserves exact stored checks after later intake and snapshots remain immutable |
| PASSED | T21 malformed retained check evidence returns 503 rather than synthesized pass |
| PASSED | T21 generic failed writes do not disclose unknown versus ineligible targets |
| PASSED | T21 read bounds reject excess filters empty tokens oversized cursors and limits |
| FAILED | T21 WHR-179 duplicate applicable source exclusions cannot certify or prepare |
| PASSED | T21 exact cutoff equality blocks and phase crossing invalidates view without a generation write |
| PASSED | T21 revoked manager action fails current authorization before old cursor decoding |
| PASSED | T21 byte arrival after approval invalidates phone certification and preparation |
| PASSED | T21 new intake after preparation prevents confirmation without rewriting historical result |
| PASSED | T21 shared account partitions keep both phones and require independent canonical approval |
| PASSED | T21 response budget continues large phone pages without dropping or truncating partitions |
| PASSED | T21 eligibility independently retains unknown campaign relevance without ordinary holds |
| PASSED | T21 proven late complete-photo sources are settled exclusions rather than missing proof |
| PASSED | T21 mutation source and partition limits stay 100 and real HTTP body limit stays 32 KiB |
| PASSED | T21 disabled candidate role and still-verified person rebinding invalidate manager choices |
| PASSED | T21 authorized different caller and full phone parent cannot reuse a valid signed cursor |
| PASSED | T21 required historical labels fail closed rather than guessing or omitting an account |
| PASSED | T21 photo fact for a different asset remains unbound to the selected accepted evidence |
| PASSED | T21 all projection reads leave certification reconciliation preview snapshot and source tables unchanged |
| PASSED | T21 acceptance after source selection invalidates view and cannot be proposed as incomplete |
| PASSED | T21 required purchase accounts cannot lose assignment or identity through ordinary constrained writes |
| PASSED | T21 known valid foreign-schema campaign phone and stored result IDs return identical not_found |
| PASSED | T21 a single oversized retained result returns 413 over real HTTP without partial evidence |
| PASSED | T21 missing protected source digest cannot be serialized as a historical pass |
| PASSED | T21 mismatched retained actor binding cannot be serialized as a historical pass |
| PASSED | T21 invalid protected source digest cannot be serialized as a historical pass |
| PASSED | T21 unchanged outcome without predecessor cannot be serialized as a historical pass |
| PASSED | T21 duplicate approved exclusion IDs cannot be serialized as a historical pass |
| PASSED | T21 verified caller binding revoked while waiting for security lock denies inventory |
| PASSED | T21 missing protected operation ID is prevented by native generated-column constraints |
| PASSED | T21 invalid protected operation ID is prevented by native generated-column constraints |
| PASSED | T-21 live checklist preserves grouped readiness and returns all nine ordered outcomes |
| PASSED | T-21 policy missing differs from zero and not_applicable without synthesizing a pass |
| PASSED | T-21 Owner with settings and sales but no leaderboards sees current designation and eligible choices without directory grants |
| PASSED | T-21 Owner without settings or sales and readers without action grants are denied |
| PASSED | T-21 checklist without sales exposes aggregate outcomes and omits protected links and fields |
| PASSED | T-21 stable tokens ignore asOf but invalidate on renamed identities outside campaign generation |
| PASSED | T-21 current designation remains visible when manager role becomes ineligible |
| PASSED | T-21 conservative required accounts retain disabled staff and ended assignments |
| PASSED | T-21 inventory selection requires named manager and verified canonical person |
| PASSED | T-21 all six routes traverse real HTTP with strict envelopes no-store and typed history |
| PASSED | T-21 real HTTP checklist rejects no session, missing grants and unknown input |
| PASSED | T-21 real HTTP results rejects no session, missing grants and unknown input |
| PASSED | T-21 real HTTP managers rejects no session, missing grants and unknown input |
| PASSED | T-21 real HTTP attendants rejects no session, missing grants and unknown input |
| PASSED | T-21 real HTTP phones rejects no session, missing grants and unknown input |
| PASSED | T-21 real HTTP incomplete-sources rejects no session, missing grants and unknown input |
| PASSED | T-21 malformed queries foreign parents and forged cursors fail without details |
| PASSED | T-21 reads do not create business audits receipts or clear dirty state |
| PASSED | T-21 incomplete sources include received and photo_pending originals but exclude finalizing held accepted and cancelled |
| PASSED | T-21 stored historical pass retains counts after later mutations and differs from live outcomes |
| PASSED | T-21 grant revoked while waiting for security lock is reauthorized before HTTP success |
