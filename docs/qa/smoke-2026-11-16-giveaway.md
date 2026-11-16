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
