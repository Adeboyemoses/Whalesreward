# WHR-178 named PostgreSQL tests

These 67 exact names are the projection acceptance inventory. Final post-change outcomes and full PostgreSQL 16 counts are recorded on [PR #164 checks](https://github.com/Adeboyemoses/Whalesreward/pull/164/checks) and the WHR-178 READY comment. Merge requires every final-head CI check green.

Earl approved WHR-182 Option A on 18 Nov 2026: update the one named duplicate-exclusion regression, preserve certification/preparation coverage through pre-existing duplicates, and allow one bounded review round 4. No production-code change, new-finding fix or round 5 is authorized.

At test code head `7780b7ca17ffa90aca5ab2980425b6bf3cc457b7`, the EM focused real-PostgreSQL test PASS under a NOSUPERUSER/NOBYPASSRLS role. It expects `exclusion_stale` on second approval, appends retained duplicate approval with native guards enabled, expects certification `phone_check_stale`, seeds matching historical check pins and expects preparation `finalization_blocked`. All three refusals assert no side effects. Only the expanded test timeout changes from 30 to 60 seconds; no skip or expected-failure wrapper is added.

Fresh EM typecheck, lint (four existing image warnings), 997 unit tests, production build, review self-tests 53, guard self-tests 94 and time tests 5 per timezone PASS. Local PostgreSQL 15 broad reruns encountered setup/DDL timeouts in unchanged cases and were not used as green evidence. Supported PostgreSQL 16 CI must rerun the entire integration suite, including all 67 names and all six actual exported GET routes over localhost HTTP. The prior supported-version run had 1,519/1,520 passing with only the now-corrected expectation failing; the previous clean local giveaway regression had 81/81 passing. Neither prior result is claimed as the final post-change result. No compatibility shim or safety-guard relaxation.

| Exact test name |
|---|
| T21 ordinary holds independently count history and open purchases without P29-only targets |
| T21 corrections independently block pending proposals without replacing accepted contribution |
| T21 duplicate pairs deduplicate the primary purchase while either side remains relevant |
| T21 stale inactive P29 with apparently closed target remains a station-wide blocker |
| T21 uploads and photo proof overlap without changing grouped readiness unions |
| T21 accepted legacy photo without trusted proof keeps grouped uploads unresolved |
| T21 phone census missing stale and complete outcomes never infer unknown devices |
| T21 101-plus historical candidates page completely and first-page census cannot certify |
| T21 cursor binds route and limit and rejects obsolete complete view |
| T21 changed verified and alias person bindings invalidate selection without promising independence |
| T21 sealed observation without final fact removes candidate and invalidates selection |
| T21 accepted-then-cancelled and superseded revision histories never become incomplete candidates |
| T21 byte arrival between proposal and independent decision refuses obsolete source |
| T21 partition replacement invalidates phone and source views before proposal |
| T21 snapshot predecessor changes derived action and invalidates initial selection |
| T21 unchanged historical result preserves exact stored checks after later intake and snapshots remain immutable |
| T21 malformed retained check evidence returns 503 rather than synthesized pass |
| T21 generic failed writes do not disclose unknown versus ineligible targets |
| T21 read bounds reject excess filters empty tokens oversized cursors and limits |
| T21 WHR-179 duplicate applicable source exclusions cannot certify or prepare |
| T21 exact cutoff equality blocks and phase crossing invalidates view without a generation write |
| T21 revoked manager action fails current authorization before old cursor decoding |
| T21 byte arrival after approval invalidates phone certification and preparation |
| T21 new intake after preparation prevents confirmation without rewriting historical result |
| T21 shared account partitions keep both phones and require independent canonical approval |
| T21 response budget continues large phone pages without dropping or truncating partitions |
| T21 eligibility independently retains unknown campaign relevance without ordinary holds |
| T21 proven late complete-photo sources are settled exclusions rather than missing proof |
| T21 mutation source and partition limits stay 100 and real HTTP body limit stays 32 KiB |
| T21 disabled candidate role and still-verified person rebinding invalidate manager choices |
| T21 authorized different caller and full phone parent cannot reuse a valid signed cursor |
| T21 required historical labels fail closed rather than guessing or omitting an account |
| T21 photo fact for a different asset remains unbound to the selected accepted evidence |
| T21 all projection reads leave certification reconciliation preview snapshot and source tables unchanged |
| T21 acceptance after source selection invalidates view and cannot be proposed as incomplete |
| T21 required purchase accounts cannot lose assignment or identity through ordinary constrained writes |
| T21 known valid foreign-schema campaign phone and stored result IDs return identical not_found |
| T21 a single oversized retained result returns 413 over real HTTP without partial evidence |
| T21 missing protected source digest cannot be serialized as a historical pass |
| T21 mismatched retained actor binding cannot be serialized as a historical pass |
| T21 invalid protected source digest cannot be serialized as a historical pass |
| T21 unchanged outcome without predecessor cannot be serialized as a historical pass |
| T21 duplicate approved exclusion IDs cannot be serialized as a historical pass |
| T21 verified caller binding revoked while waiting for security lock denies inventory |
| T21 missing protected operation ID is prevented by native generated-column constraints |
| T21 invalid protected operation ID is prevented by native generated-column constraints |
| T-21 live checklist preserves grouped readiness and returns all nine ordered outcomes |
| T-21 policy missing differs from zero and not_applicable without synthesizing a pass |
| T-21 Owner with settings and sales but no leaderboards sees current designation and eligible choices without directory grants |
| T-21 Owner without settings or sales and readers without action grants are denied |
| T-21 checklist without sales exposes aggregate outcomes and omits protected links and fields |
| T-21 stable tokens ignore asOf but invalidate on renamed identities outside campaign generation |
| T-21 current designation remains visible when manager role becomes ineligible |
| T-21 conservative required accounts retain disabled staff and ended assignments |
| T-21 inventory selection requires named manager and verified canonical person |
| T-21 all six routes traverse real HTTP with strict envelopes no-store and typed history |
| T-21 real HTTP checklist rejects no session, missing grants and unknown input |
| T-21 real HTTP results rejects no session, missing grants and unknown input |
| T-21 real HTTP managers rejects no session, missing grants and unknown input |
| T-21 real HTTP attendants rejects no session, missing grants and unknown input |
| T-21 real HTTP phones rejects no session, missing grants and unknown input |
| T-21 real HTTP incomplete-sources rejects no session, missing grants and unknown input |
| T-21 malformed queries foreign parents and forged cursors fail without details |
| T-21 reads do not create business audits receipts or clear dirty state |
| T-21 incomplete sources include received and photo_pending originals but exclude finalizing held accepted and cancelled |
| T-21 stored historical pass retains counts after later mutations and differs from live outcomes |
| T-21 grant revoked while waiting for security lock is reauthorized before HTTP success |
