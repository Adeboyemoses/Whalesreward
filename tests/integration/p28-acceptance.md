# P-28 acceptance evidence

WHR-150 / WO-core-14b. Tests use disposable PostgreSQL schemas and fictional identities.
`p28-campaign-settings.test.ts` contains the named P-28 cases below; timing lineage
and retained P-25 evidence are additionally checked by `settings-timing-lineage.test.ts`.
The EM records final-head gate counts in the PR evidence.

| Contract acceptance item | Named test (unique identifying text) |
|---|---|
| Non-Owner review, confirm and replay | `I-07 settings-only non-Owner is denied on review, confirmation and historical replay despite all action grants` |
| Owner authority revoked between stages | `I-09 Owner demotion, settings removal, disable and session revocation between review and confirm cannot authorize a write` |
| Empty creation and creation history | `I-45 empty creation is side-effect-free at review and commits one campaign with logical version two and before=null` |
| Retention-first creation and separate pin | `I-45 retention-first creation preserves intent and old campaign=null snapshots and retention never moves the timing pin` |
| Concurrent distinct create keys | `I-22 different create keys racing produce exactly one campaign, settings version, audit and receipt` |
| Lost-response replay after start/snapshot; changed body/kind | `I-22 identical lost-response create replay after start and snapshot returns exact receipt; changed content or kind conflicts` |
| All five inputs, exact elapsed grace, generation, immutable old values | `I-45 updating all five inputs preserves old values and advances campaign and generation once` |
| No change | `I-45 a new reason with identical five timing inputs is no_change without effects` |
| Proposed start equality | `I-45 exact proposed-start equality locks review and confirmation with a fresh database clock` |
| Existing start equality and future replacement | `I-45 exact persisted-start equality cannot be unlocked by proposing a future replacement start` |
| Waiting confirmation crosses start | `I-45 a confirmation waiting across purchaseStart fails at its post-lock clock check` |
| Launch before now while start future | `I-45 launch before now does not lock timing while purchaseStart remains future` |
| Saved snapshot with null pointer | `I-46 any saved snapshot locks timing even when latestSnapshotId is null and start is future` |
| Explicit legacy null start | `I-45 explicitly unconfigured legacy start can be completed without approving the incomplete historical version` |
| Corrupt missing pin | `I-45 a corrupt missing timing pointer is not evidence of an explicitly unconfigured legacy start` |
| Null start with unreadable earlier history | `I-45 an explicit legacy null start with broken earlier timing history fails closed on read, review and confirm` |
| Zero/fractional/overflow grace and invalid timezone | `I-45 fractional, negative or overflowing grace %s is timing_invalid with no effects`; `I-45 unsupported timezone and invalid ordering fail timing_invalid while malformed or extra fields fail invalid_request`; zero is used by creation and boundary tests |
| Inclusive cutoff and deadline | `I-45a exact inclusive launch, start, cutoff and durable receipt deadline use microseconds with zero grace` |
| Retention races force new review | `I-45 retention racing a reviewed campaign proposal requires a new explicit review and never silently substitutes guards` |
| Fresh install and repeated bootstrap | `I-45 fresh migration before station bootstrap and repeated bootstrap preserve one original binding with no campaign` |
| Existing-station migration | `I-45 existing-station upgrade binds the registered policy without inventing any campaign values` |
| Absent policy versus configured without campaign | `I-45 recorded policy with no campaign configures protected timing health without seeding inputs or exposing policy metadata`; `I-45 absent policy binding fails closed in health and timing review without creating configuration` |
| Absent definition and binding cannot be silently repaired | `I-45 missing definition fails closed and repeated bootstrap never repairs an absent historical station binding` |
| Missing evaluator | `I-45 a recorded definition and binding without the matching installed evaluator remain unconfigured` |
| Policy mismatch, stale digest and generation | `I-45 changed recorded semantics never inherits approval from a matching policy version or stale review`; `I-45 changed material digest with matching explicit guards returns review_stale`; `I-45 generation changes make an otherwise guard-matching comparison review_stale` |
| Atomic rollback | `I-41 a receipt failure rolls back campaign, timing, history, audit, pointers and generation` |
| Exact audit mappings and historical fallback | `I-41 create and update audit search/detail expose exactly the required immutable fields and history references one event`; `I-41 historical version-two timing events missing campaignId use the safe legacy projection without fabricated current context` |
| Read-only policy storage outage and redaction | `I-07 policy storage failure preserves 503 semantics and public health redaction` (SELECT is denied to a non-superuser) |
| Append-only registry and binding under actual roles | `I-41 non-superuser cannot mutate or truncate timing definitions and station bindings even with table privileges` |
| Accepted sales and holds remain unchanged | `I-51 timing changes leave accepted amounts, original capture facts, held sales and evidence unchanged` |
| First logical timing version and genuine chain gaps | `I-45 timing lineage accepts first giveaway version two and retention gaps but rejects a genuine missing station version` |
| Non-Lagos P-28 sync and retention | `P28 first giveaway version two with a non-Lagos campaign calendar qualifies real sync and retention leaves its immutable timing identity` |
| Pre-upgrade provenance remains exact | `reuses exact old campaign snapshots without ignoring changed meaningful fields altered=%s` (existing two-case regression in `settings-timing-lineage.test.ts`) |

The exact-time cases shadow the database clock in their isolated schema and keep
test sessions live at that clock. Transactions, row locks, permissions, writes,
rollback, receipts and concurrency use real PostgreSQL. Production clocks and
database roles are unchanged. HTTP tests inject the real per-case pool to avoid
the application singleton retaining a schema that a previous case has dropped.
