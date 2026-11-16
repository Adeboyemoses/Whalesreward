# WO-core-12 verification

Backend-only work: no giveaway screen or design parity is claimed. Run only against a disposable local PostgreSQL instance with fictional fixtures. Never inherit an unknown database connection. Policy registration/configuration used by tests is confined to disposable schemas; shipping this implementation activates no policy and seeds no campaign dates or people.

## Acceptance matrix

| Area | Required evidence |
|---|---|
| Exact contribution | Current accepted revision only; completed validation and identity/evidence; held/cancelled excluded; proposed corrections retain accepted numbers; meter values never recalculated; duplicates count live but block readiness |
| Campaign proof | P-23 bounds and typed P-25 inside/outside/unknown; stale campaign/configuration proof rejected; late receipt after expiry is not a capture hold; first details receipt unchanged |
| Ranking | Equal spend shares 1,1,3 across page boundaries and categories; no transaction-count tie break; exact large sums; mixed currency refusal; litres/kilograms separate; empty categories; stale cursor |
| Deadline | Exact cutoff and details/photo deadline equality; one tick late; zero grace; incomplete and legacy missing proof block; trusted now strictly after deadline |
| Photo receipt | Complete sealed bytes before deadline with later validation; PUT before deadline but seal/fact after; crash before commit; overwritten staging; competing lease retries; receipt belongs to exact selected immutable asset |
| Census | Missing/extra/duplicate entries; multiple phones/account and partitions/phone; disabled/offboarded relevant staff; complete replacement history; unknown queue counts stay unknown |
| Authority | Named manager and independent verified person; aliases denied; Owner alone no bypass; finalize/revise separation; revoked grants on decision/confirm/replay; foreign IDs denied |
| Exact exclusions | Two competing decisions; body conflict; rejected/superseded histories; changed census/timing/designation/predecessor; exact incomplete purchase list; accepted/complete-photo sources forbidden; changed source invalidates applicability |
| Checklist | All nine typed clear checks persisted with counts and complete binding; partial exclusions suppress only upload/photo obligation; holds/corrections/duplicates/eligibility/P-29 remain blockers |
| SR-06 | Pending/stale proposals with resolved-looking targets and inactive policy block initial, revision and unchanged; transitions invalidate previews; ordinary closure supersedes; old snapshots remain frozen |
| Concurrency | Phantom intake, receipt and each M3 writer race initial/revision/unchanged under common locks; distinct confirmations have one winner; stale settings/predecessor rejected |
| Frozen results | Names/cards/ranks/sources immutable; changed lineage requires new numbered snapshot; bookkeeping-only changes reconcile unchanged; replay historical receipt before stale checks |
| Audit and database | Exact v2 actions/fields; privacy projection; one event per transition; rollback/replay emit no duplicates; non-superuser immutable-history guards |

## Local smoke sequence

1. On the migrated empty fixture station, read campaign and leaderboard: unconfigured is explicit and finalization is blocked.
2. In a disposable test schema only, prepare configured timing/policy fixtures and accepted sales including ties, held/cancelled sales and duplicates. Compare live totals and readiness.
3. Establish verified manager/approver identities, designate manager, record complete census after deadline, inspect available phones or approve exact unavailable sources independently, then record the phone check.
4. Prepare and confirm an initial snapshot. Retry the same request; check unchanged ID, number, audit count and frozen contents.
5. Change accepted lineage through an ordinary writer. Confirm the old preview fails; prepare and save a linked revision; compare predecessor bytes.
6. Clear bookkeeping without changing effective sources and prepare a revision: expect audited unchanged reconciliation and no extra snapshot.
7. Execute SR-06 pending-proposal and writer-race tests against real PostgreSQL, including non-superuser cases. Record actual named-test counts in review evidence and READY report.

Verification status: planned; no passing tests claimed by this runbook.

## Named backend evidence (verification agent)

The following are real PostgreSQL tests. These references map implemented assertions; they do not replace the unresolved matrix items below. Final-head counts belong in review evidence after the EM rerun.

| Contract cases | Named test / file |
|---|---|
| Exact accepted contribution; proposed/held/cancelled | `I-42 accepted numbers count once while proposed held and cancelled values cannot inflate spend` — giveaway.test.ts |
| Ties across pages, unequal transaction counts | `I-42 equal spend shares rank across pages despite different transaction counts` — giveaway.test.ts |
| Duplicate/late-correction live contribution, units | `I-40/I-44 duplicates and pending corrections count live with unit-separated quantities` — giveaway.test.ts |
| Generation-bound paging | `M4 changed data generation rejects a live leaderboard cursor` — giveaway.test.ts |
| Unset configuration and rollback | `I-46 missing policy timing and phone checks block initial preparation without audit` — giveaway.test.ts |
| Review blockers | `I-46 duplicate and late-correction work remains in readiness blockers` — giveaway.test.ts |
| Live read authorization, empty categories | `I-07 live permission revocation denies the next leaderboard read`; `I-42 empty categories return exact zero totals` — giveaway.test.ts |
| P-25 inside/outside, stale identities, contradictory/malformed proof, original false retained | `P-25 committed %s provenance retains original facts and binds campaign configuration` — giveaway-provenance.test.ts |
| Inclusive bounds, one microsecond crossing, unknown photo proof | `I-45/P-30 exact capture and details/photo deadline boundaries use durable database facts` — giveaway-membership.test.ts |
| Independent complete-photo deadline | `P-30 timely details cannot waive complete-photo receipt one microsecond after deadline` — giveaway-membership.test.ts |
| Receipt replay, overwritten staging, preserved R | `I-28/P-30 receipt seals exact bytes and preserves original details receipt on replay` — giveaway-photo-receipt.test.ts |
| Seal failure | `P-30 failed seal verification creates neither receipt observation nor final fact` — giveaway-photo-receipt.test.ts |
| Crash after durable observation, overwrite recovery | `P-30 retry after durable observation uses retained sealed bytes despite staging overwrite` — giveaway-photo-receipt.test.ts |
| Non-superuser receipt immutability | `P-30 non-superuser cannot rewrite or truncate trusted receipt history` — giveaway-photo-receipt.test.ts |
| Bytes received before later validation | `P-30 complete-byte receipt uses database time after seal verification and before later validation` — giveaway-photo-receipt.test.ts |
| Seal/PUT before deadline, lock wait makes receipt late | `P-30 sealed bytes and PUT before deadline cannot backdate receipt after waiting for locks` — giveaway-photo-receipt.test.ts |
| Concurrent upload finalization | `P-30 concurrent same-byte retries retain one observation and one final fact` — giveaway-photo-receipt.test.ts |
| Full checklist, initial/replay, unchanged reconciliation, revision blockers | `I-46 complete phone checklist permits one frozen initial snapshot` — giveaway-snapshots.test.ts |
| Inactive/stale pending proposal initial block | `SR-06 stale pending proposal with inactive policy and resolved-looking target blocks initial readiness` — giveaway-snapshots.test.ts |
| Two confirms, one winner | `I-46 distinct simultaneous confirmations save one numbered snapshot` — giveaway-snapshots.test.ts |
| Linked revision, frozen predecessor | `I-46 changed source lineage saves a linked revision without rewriting its predecessor` — giveaway-snapshots.test.ts |
| Proposal creation invalidates preview | `SR-06 a new pending proposal invalidates an already reviewed initial preview` — giveaway-snapshots.test.ts |
| Phantom intake race | `I-46 phantom purchase intake and confirmation serialize without silently losing source history` — giveaway-snapshots.test.ts |
| Unchanged-source proposal block | `SR-06 pending proposal blocks unchanged reconciliation of identical snapshot sources` — giveaway-snapshots.test.ts |
| Non-superuser snapshot immutability | `I-46 non-superuser cannot update delete or truncate frozen snapshots` — giveaway-snapshots.test.ts |

Phone-specific coverage is owned by the phone builder in giveaway-phones.test.ts. Verify its final named cases separately.

Remaining verification gaps at this checkpoint: each distinct M3 writer and every P-29 terminal transition racing initial/revision/unchanged; ordinary target closure's linked supersession in real giveaway flow; same-key changed body for snapshot routes; snapshot actor permission revoked between prepare/confirm/replay; stale settings/predecessor and expired/wrong-owner preview; included customer-name/card/rank historical display after identity changes; category recomputation and aggregate overflow/mixed-currency negative in real PostgreSQL; a crash before durable observation followed by retry after deadline (distinct from durable-observation recovery). Existing upstream tests may cover pieces, but this document does not claim their giveaway integration is proven.
