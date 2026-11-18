# Cross-feature journey check — November 2026

WHR-183 / WO-spec-5a. Report only, 18 November 2026. Examined staging
`6d2e5046f95145cb1b2f2a53531e456a11954b11`; branch starts at that head.
No product implementation, test change, policy activation or session-status edit
belongs to this report. Earl decides which separately commissioned fixes precede
smoke. Rook's product review remains the work order's acceptance step.

## Finding and evidence boundary

One new confirmed gap: **INTEGRITY-P1, [WHR-184](https://linear.app/phaneum/issue/WHR-184)**,
P-29 campaign membership evidence is written in a shape the giveaway reader drops.
It is Backlog / needs:human / found-in:WO-spec-5a. No fix was made.

All six journeys below were traced from their actual App Router entry points,
through strict request validation, live authority, writes and downstream reads.
A route trace is source evidence, not a claim that the complete journey passed
through HTTP. Successful tests with fixture storage likewise do not prove real
object-storage delivery. The reproduction for WHR-184 reached the actual
proposal/decision services and contribution SQL on real PostgreSQL with the
existing in-memory evidence adapter; its proposed full HTTP regression is still
needed. This distinction matters because local real-storage uploads refused PUT.

References are `repository path:line` at the examined SHA. Thin route wrappers
below start at line 1 and invoke the named HTTP handler; line numbers in shared
handlers identify the relevant boundary rather than every statement of a function.
Sources: amended `docs/engineering/contracts/m1.md`, `m2.md`, `m3.md`, `m4.md`,
`operations.md`; implementation briefs for attendant capture/uploads/corrections,
admin reviews/meter/two-person release, customer changes, settings, leaderboards,
reports, overview and audit. The specification-only WHR-178 discovery/checklist
additions are not assumed present on this baseline.

## Real-stack and gate evidence

Commands were run from the isolated worktree; database names below denote only
disposable fictional local test data. No credential or signed URL is reproduced.

| Execution                                                                                                                                                                                                           | Result and interpretation                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`                                                                                                                                                            | Passed; 104 unit files / 997 tests. Lint has four existing `no-img-element` warnings in held-release and sales-common.                                                                                                                                                                                                                                                                                                                      |
| `DATABASE_URL=<local whr183_test> pnpm db:migrate:deploy`                                                                                                                                                           | All migrations applied. Local server identifies itself as PostgreSQL 15.14; the required Compose/CI major is 16. Migration success alone is not workflow compatibility.                                                                                                                                                                                                                                                                     |
| `pnpm test:integration`                                                                                                                                                                                             | Attempted; setup timeouts under concurrent schema construction. Stopped.                                                                                                                                                                                                                                                                                                                                                                    |
| `pnpm test:integration --maxWorkers=1` and serial run with larger runner timeouts                                                                                                                                   | Attempted and stopped without a completed suite result; these are not passes.                                                                                                                                                                                                                                                                                                                                                               |
| Targeted existing integration files: `p28-campaign-settings`, `sale-original-date`, `giveaway-exclusion-uniqueness`, `customer-recovery-http`, `health-policy`, `reports-http-adversarial`, `held-release-followup` | P-28 cases fail on missing PostgreSQL 16 `pg_catalog.pg_input_is_valid`; the local run cannot establish the seven-file pass. No compatibility shim or weakened test was introduced.                                                                                                                                                                                                                                                         |
| `pnpm test:time`                                                                                                                                                                                                    | Passed: 5 tests in UTC and the same 5 in America/New_York.                                                                                                                                                                                                                                                                                                                                                                                  |
| `pnpm exec playwright test --config playwright.release.config.ts tests/release-e2e/held-release-real.spec.ts tests/release-e2e/original-date-real.spec.ts tests/release-e2e/sheet-identifiers.spec.ts`              | 10 failed before release assertions: the initial sale fixture's signed meter-photo PUT returns 403. A separate sanitized diagnostic confirmed MinIO `AccessDenied`. This does not establish regression of WHR-176 or WHR-181.                                                                                                                                                                                                               |
| Temporary WHR-184 PostgreSQL probe using existing `heldReleaseRuntimeFixture`                                                                                                                                       | Failed at the intended campaign assertion: stored inside conclusion true, all-time included true, campaign included false, reasons `timing_unresolved`. No replacement production evaluator or fixture-ID rewriting. Probe removed before commit.                                                                                                                                                                                           |
| Existing staging CI at the exact examined SHA                                                                                                                                                                       | [Run 44215098091](https://github.com/Adeboyemoses/Whalesreward/actions/runs/44215098091) is success: 1,453 integration tests; 42 release tests; 430 browser tests with 4 skipped; 1 storage test; 5 calendar tests in each timezone. This prior baseline run is supporting evidence, distinct from this session's attempted local runs. The report PR runs the existing PostgreSQL 16 integration, release, browser and storage jobs again. |

Local transcripts: `/tmp/whr183-migrate.log`, `/tmp/whr183-integration.log`,
`/tmp/whr183-integration-serial.log`, `/tmp/whr183-integration-final.log`,
`/tmp/whr183-targeted.log`, `/tmp/whr183-time.log`, `/tmp/whr183-release.log`,
`/tmp/whr183-pg-probe.log`, `/tmp/whr183-build.log`. These machine-local logs are
not durable report attachments; the checked-in observation and CI links are the
reviewable record. Test fixtures use fictional people only.

## Journey 1 — Phone sale, sync, ordinary review, correction, operational reads

1. Trace `saveCapture` in `src/client/offline/client.ts:1164`, the account-scoped
   sync loop in `src/client/offline/sync.ts:120`, and separate correction queue
   in `src/client/offline/corrections.ts:227`. Saving and upload do not decide credit;
   correction submission waits for an actual original accepted revision.
2. Trace `POST /api/sync/sales`, `GET /api/sync/sales/by-operation/:operationId`,
   `POST /api/sync/sales/:purchaseId/upload-permission`, object PUT, and
   `POST /api/sync/sales/:purchaseId/finalize`. Route files are respectively
   `src/app/api/sync/sales/route.ts:1`,
   `src/app/api/sync/sales/by-operation/[operationId]/route.ts:1`,
   `src/app/api/sync/sales/[purchaseId]/upload-permission/route.ts:1`,
   `src/app/api/sync/sales/[purchaseId]/finalize/route.ts:1`.
   `src/server/modules/sync/http.ts:74` validates UUIDs, Origin and live account;
   `sync/service.ts:197`, `:328`, `:397` preserve operation identity and validate
   sealed evidence. `sync/repo.ts:10` binds account/context and reporting locks;
   `sync/settle.ts:29` evaluates the retained capture interval/history.
3. Trace `POST /api/admin/sales/:purchaseId/holds/:holdId/{price,card,date}-decision`
   and `/capture-decision` through the matching `src/app/api/admin/sales/` route
   files to `src/server/modules/reviews/http.ts:1` and `reviews/service.ts:573`.
   Replay is checked after live authority; versions, targeted hold and retained
   evidence are checked again before commit. `reviews/service.ts:188` rechecks
   all independent gates; `:560` supersedes a pending P-29 proposal only when its
   actual target was closed by an ordinary mutation.
4. Trace `POST /api/attendant/sales/:purchaseId/corrections`, its by-operation GET,
   and `POST /api/admin/sales/:purchaseId/corrections/:correctionId/decision`
   through their route wrappers to `corrections/http.ts:1` and
   `src/server/modules/corrections/service.ts:430`. The base revision and purchase
   version are immutable request facts; a pending/late proposal leaves the prior
   accepted contribution. `corrections/service.ts:271` replaces contribution once;
   P-19 independence and meter-base refusal remain separate gates.
5. Trace `GET /api/admin/sales/:purchaseId` and `/history`,
   `POST /api/admin/reports/query`, `GET /api/admin/reports/sources`,
   `GET /api/admin/overview`, and audit `/search` and `/:eventId`.
   Their real handlers are `sales/http.ts:1`, `reports/http.ts:1`, `audit/http.ts:1`.
   `sales/service.ts:239` uses immutable original projection;
   `reports/data.ts:76` selects current accepted values/date and separately marks
   excluded records; `reports/contribution.ts:3` is the shared accepted predicate.
   `audit/service.ts:15` requires current audit permission for list and detail.
   UI briefs forbid computing credit or totals from a phone status.

**Finding:** no additional confirmed gap in this trace. WHR-184 affects the
campaign branch after P-29, not the ordinary operational-report predicate.
**Evidence:** source trace; existing correction/review/report/audit suites are
covered by baseline CI. Local HTTP release intake was blocked at storage as above.
**Sound seams:** original and correction operation IDs remain distinct; changed
payload replay conflicts; hold decisions clear only their selected gate; proposed
corrections do not replace accepted spend; report quantities retain explicit units.

## Journey 2 — Held sale, photographed proposal, independent decision, snapshot

1. Trace `GET /api/admin/sales/:purchaseId/release-preparation?kind=...` and
   `GET /api/admin/release-proposals/pending` through
   `src/server/modules/reviews/release-discovery-http.ts:30` to
   `release-discovery.ts:92`. Preparation derives target IDs/versions, original,
   candidate, context and admission; the phone cannot invent a trusted interval.
2. Trace `POST /api/admin/sales/:purchaseId/release-sheet-uploads`,
   `/:uploadId/upload-url`, object PUT and `/:uploadId/finalize` through the
   matching route files and `reviews/release-upload-http.ts:50`.
   `release-uploads.ts:173` now uses `newId()` for persisted upload/asset ID;
   URL/finalize validate the same UUIDv7 type. Remaining random UUIDs produce
   object paths only. This addresses WHR-176's handoff pattern.
3. Trace `POST /api/admin/sales/:purchaseId/release-proposals`, proposal list/detail,
   `/:proposalId/decision`, and `/:proposalId/photo-access` through
   `reviews/release-http.ts:55` to `release-service.ts:559`, `:737`, `:1170`, `:1183`.
   Live sales plus kind permission, canonically distinct verified people, target
   and purchase versions, evidence availability, policy and retained consistency
   are server checks. List/get project only permitted kinds. An ordinary target
   closure records a terminal supersession rather than leaving an invisible write.
4. Trace admin and attendant SaleDetail, revision/decision history and audit.
   `src/server/modules/sales/projections.ts:3` reads original verified date from
   the original revision; `:37` separates original display from accepted revision.
   WHR-181 is addressed on this shared read side, including a non-null historic
   original date. Candidate-only values are not labelled credited.
5. Trace `GET /api/admin/giveaway/:campaignId/readiness`, preview preparation,
   initial snapshot POST and predecessor-specific revision POST through
   `giveaway/http.ts:56`, `readiness.ts:8`, `mutations.ts:139`, `:364`.
   `reviews/release-integrations.ts:39` unions pending release purchases into the
   ordinary blockers, even if policy is off. Proposal transitions advance the
   reporting generation. This is distinct from **consuming approved proof**, the
   confirmed gap below.

### G1 — INTEGRITY-P1: P-29 campaign proof is silently discarded (WHR-184)

**Producer → consumer:** `src/server/modules/reviews/release-service.ts:1087`
serializes protected provenance with `target: r.content.target` (a ReleaseTarget)
and `result` (a Decision). `src/server/modules/giveaway/data.ts:124` accepts a
campaign conclusion only with `target.purchaseId`, `target.decisionId`,
`result.closure='confirmed'`, `result.appliedPurchaseVersion`,
`result.resultingRevisionId` and `result.evidenceAssetId` matching the committed
sale decision. P-29 puts none of those fields in those positions. This is a
producer/consumer mismatch, not a recommendation to remove binding checks.
Ordinary v1 provenance is built differently at `reviews/service.ts:490`.

**Observed consequence:** `giveaway/membership.ts:40` finds no bound conclusion
and `:47` falls back to original I. A campaign boundary inside I yields
`timing_unresolved`; `giveaway/data.ts:162` excludes the sale and
`giveaway/readiness.ts:104` adds `eligibility_unresolved`. The same source reader
feeds preview/confirmation. An otherwise valid independent approval can therefore
count all-time and omit campaign spend while blocking the normal result path.
This warrants INTEGRITY-P1 because qualifying spend/rank can be wrong. No claim
is made that a blocked snapshot was saved or that evidence was deleted.

**Minimal reproduction:** in a disposable, complete historical fixture, let
I be 10 November 2026 12:00–13:00 UTC, campaign start 12:05 UTC and original
assignment end 12:30 UTC. Leave both capture authorization and time blocks open.
Use an exact matching paper entry J=12:10–12:20 UTC, complete meter evidence and
all ordinary prerequisites. Reserve/upload/finalize the sheet, propose confirm,
and approve as a different verified person using the latest guards. Read detail,
all-time and campaign leaderboards and readiness. Expect one operational and
campaign contribution and no timing-eligibility blocker from this purchase.

**Actual PostgreSQL probe:** the existing historical release fixture and real
proposal/decision services persist an approved `campaign_membership_uniform`
inside conclusion. Actual contribution SQL produces:

```text
storedConclusionInside: true
allTimeIncluded: true
campaignIncluded: false
reasons: [timing_unresolved]
```

The failed assertion was `expect(row.reasons).not.toContain('timing_unresolved')`.
Historical fixture construction used existing helpers; checked mutations ran with
native guards. Evidence bytes used the existing fixture adapter. This confirms
the storage-shape defect on PostgreSQL 15 as well; it does not establish a full
HTTP pass on PostgreSQL 16.

**Proposed failing test:** real HTTP reserve → upload URL → PUT → sheet finalize
→ propose → independent approve → both leaderboard bases → readiness → normal
manager/census/check → prepare/confirm. Assert one exact current accepted revision
in campaign sources, no stale timing blocker, and immutable original values and
predecessor snapshots. Add inside/outside, foreign campaign/settings pins,
policy-off historical replay and later numeric correction cases. Use real
PostgreSQL 16 and object storage; do not manufacture consumer-shaped provenance,
relax bindings or rewrite fixture IDs to make the test pass.

**Disposition:** [WHR-184](https://linear.app/phaneum/issue/WHR-184), Backlog /
needs:human. Recommend a separately commissioned core fix before smoke; default
is no implementation until Earl approves it. Neither the report nor a green
baseline suite activates v2.

**Other sound seams:** same-person accounts cannot act independently; sheet IDs
are UUIDv7 end to end; old uploads cannot overwrite validated meter evidence;
original/current dates are separated; pending proposals block even when ordinary
holds look resolved; ordinary closing mutations create auditable supersession.

## Journey 3 — Owner campaign setup, ranking, physical census, finalization/revision

1. Trace `GET /api/admin/settings`, `POST /api/admin/settings/giveaway/review`
   and `/confirm` through `settings/http.ts:47` to
   `settings/service.ts:395`, `:526`, `:749`, `:781`. Live Owner plus settings
   permission is required, including replay; the server derives upload deadline,
   enforces old/proposed start locks and immutable policy/version bindings.
   Missing campaign values differ from a missing timing evaluator.
2. Trace sale intake/finalize as Journey 1, then
   `GET /api/admin/giveaway/campaign` and `/api/admin/leaderboards`.
   `leaderboards/service.ts:15` selects the requested basis;
   `giveaway/data.ts:109` builds contributions and `:183` ranks by exact spend.
   `giveaway/membership.ts:21` applies inclusive purchase/receipt boundaries;
   first-details receipt never substitutes for complete-photo proof.
3. Trace the actual `/api/admin/giveaway/:campaignId/reconciliation/` routes:
   `manager`, `required-attendants`, `censuses`, `phones`, phone exclusions,
   exclusions and independent `/decision`, `phone-checks` and immutable check
   `/entries`. `giveaway/phone-http.ts:53` applies HTTP schemas/live authority;
   `phones.ts:76`, `:126`, `:202`, `:432`, `:547`, `:685` handle context, trusted
   deadline, exact partial sources, proposal, independent decision and certification.
   `phone-readiness.ts:25` binds check to census/designation/timing/policy/data/
   predecessor. Missing phone evidence is never an inferred empty queue.
4. Trace readiness → `POST .../previews` → `POST .../snapshots` and
   `POST .../snapshots/:snapshotId/revisions`, then saved detail/rows/sources/changes.
   `giveaway/mutations.ts:139` records a nine-check reconciliation pass;
   `:364` rechecks preview guards, actor, digest, expiry, consumed state and sources.
   `giveaway/history.ts:48` reads saved evidence. Source reads need sales in
   addition to leaderboards; rank-only reads do not imply that grant.
5. Test WHR-179's pattern in the trace: `phone-exclusion-conflicts.ts:1`,
   `phone-readiness.ts:125` and certification reject conflicting applicable
   approvals for one exact partial source. Old evidence remains historical.
   Same-key receipt replay precedes mutable stale checks after current authority.
   A changed accepted revision needs reconciliation even when spend is unchanged;
   a bookkeeping-only change can return unchanged without rewriting a snapshot.

**Finding:** G1 also affects this journey; no duplicate issue. Granular live
checklist and narrow selection endpoints specified by WHR-178 are ongoing work,
not a newly discovered defect or an assumed screen capability here.
**Evidence:** actual route/source trace and baseline CI; local P-28 run fails on
the unsupported PostgreSQL major, not a demonstrated campaign-rule violation.
**Sound seams:** Owner setup is enforced server-side; exact decimals and shared
ranks; independent phone approval; no blanket partial-upload exclusion; previews
invalidate on source generation; snapshots and predecessor links are immutable.

## Journey 4 — Lost card / phone change, history, audit and attribution

1. Trace `GET /api/admin/customers/:customerId/recovery-context`,
   `POST .../phone-change`, `POST .../card-verifications`, challenge GET/verify,
   `POST .../card-replacement`, manager-case intake/list/detail, and `/changes`.
   Each matching `src/app/api/admin/customers/[customerId]/` route invokes
   `src/server/modules/customers/recovery-http.ts:53`.
2. `customers/recovery.ts:325` returns guarded customer/card state and masked
   history; `:396` writes under live authority and canonical receipt identity.
   `:513` binds in-person phone change to the active card/version; `:548` onward
   binds verified challenge, customer, issuer session, old/new cards and Active
   batch. Replacement consumes verification, retires old card and changes links
   atomically. No purchase/customer/category reassignment is performed.
3. Trace `GET /api/admin/customers/:customerId` and `/purchases` via
   `cards/http.ts:1` → `customers/service.ts:268`: customer history additionally
   requires sales. Trace SaleDetail's captured card and historical seller through
   `sales/projections.ts:13`, reports' historical seller through `reports/data.ts:76`,
   customer-ID ranking through `giveaway/data.ts:183`, and audit list/detail
   through `audit/service.ts:15`. Live current-card display does not change the
   captured card or purchase's permanent customer ID; saved snapshot sources stay
   frozen. Old queued cards reach historical lookup and card hold evaluation at
   `sync/settle.ts:94` rather than silently following the replacement card.

**Finding:** no new confirmed gap. Lost-card delivery/replacement cannot currently
be completed in the deployed runtime: `src/server/adapters/phone-verification.ts:52`
permits only a test-injected adapter and otherwise returns 409
`phone_verification_unconfigured`. This existing WHR-49 gate is intentional, not
permission to add an OTP bypass. Manager intake has no final exceptional approval
route; WHR-48 remains separate. Phone change with the active card is a different,
configured path. Tests with an injected adapter prove domain behavior only.
**Sound seams:** permanent customer ID and category preserve attribution; retired
card stays retired; phone change invalidates outstanding verification generations;
changes list and private case detail have their distinct documented permissions.

## Journey 5 — Offline price changes, holds, unconfigured meter correction, reports

1. Trace admin `GET /api/admin/prices`, `/:productCode/history`, and
   `POST /api/admin/prices/:productCode/activate` through
   `src/server/modules/station/http.ts:1`. Compare attendant Session and card
   lookup price refresh through `auth/http.ts:1`, `cards/http.ts:1` and
   `src/client/api.ts:52`: acknowledged context and increasing price version
   decide adoption; an outbox original retains its captured snapshot.
2. Trace the same original through sync submit/upload/finalize.
   `sync/settle.ts:29` locks historical price reads; its rate/currency comparison
   uses the complete capture interval rather than the sync-time price alone.
   Configuration precision alone is not a price hold. Retries preserve the
   original payload and first details receipt.
3. Trace `POST /api/admin/sales/:purchaseId/holds/:holdId/price-decision` with
   `correct_meter` through `reviews/http.ts:1` → `reviews/service.ts:573`.
   `reviews/service.ts:609` pins the meter dependency before applying a new
   decision. `reviews/meter-config.ts:122` returns 409
   `meter_policy_unconfigured` for missing/invalid/inactive approval/dependency.
   The UI mapping and meter brief retain the hold and pending sale after refusal.
   A valid configured meter result stages its exact independent pair; later
   card/date resolutions retain that candidate. Ordinary P-22 correction refuses
   a meter-evidence base (`corrections/service.ts:485`).
4. Trace resulting SaleDetail/history, report query/sources/exports and overview
   as Journey 1. `reports/contribution.ts:3` excludes unresolved holds;
   `reports/data.ts:76` consumes effective accepted amount/quantity without
   recalculating at the latest configured rate. A staged candidate is not spend.

**Finding:** no new confirmed gap in this trace. Meter under active review-v2 is
intentionally unconfigured until a separately approved dependency release; health
must not imply every historic sale is correctable. This limit is stated at
`docs/engineering/contracts/m3.md:692` and in the v2 artifact.
**Sound seams:** historical price preserved; refreshed prices cannot reprice a
queued sale; meter refusal makes no successful decision; all other holds still
block credit; accepted exact litre/kilogram values flow into separate report units.

## Journey 6 — Every health policy: unconfigured and configured behavior

`GET /api/health` enters `src/app/api/health/route.ts:7` →
`health/service.ts:46`, `:120`. The fixed twelve-key allowlist is
`health/policies.ts:8`. One environment snapshot feeds isolated evaluators;
database-backed review/meter/timing/reconciliation checks augment it. Public,
attendant, restricted, invalid/revoked and settings-less sessions receive only
`ok`, `version`, `db`, `fullyConfigured`; only a full live settings admin receives
`policies`. Health reauthorizes after probing and returns no-store/Vary: Cookie.
It never approves policies or establishes sale readiness.

| Health key          | Unconfigured route/screen behavior                                                                                                                                  | Configured behavior and seam checked                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`              | Admin auth wrappers refuse with 409 `auth_policy_unconfigured`; sign-in maps approved setup copy.                                                                   | `admin-access/config.ts:110` validates the same auth/session policy used by wrappers. Live authority still applies.                                                                                              |
| `delivery`          | Delivery requests fail closed with `delivery_unconfigured`; no sample reset link/code or assumed sent state.                                                        | Valid supported adapter counts as configured; a later provider outage remains `delivery_unavailable`, not a policy flip (`health/policies.ts:48`, email adapter).                                                |
| `delegation`        | Role/access mutations refuse 409 `delegation_policy_unconfigured`; UI cannot grant authority locally.                                                               | `admin-access/config.ts:110` and `health/policies.ts:54` share environment-aware approval validation; no grant above the caller.                                                                                 |
| `phone`             | Registration/phone lookup/phone change use 409 `phone_policy_unconfigured`; registration preserves entered data.                                                    | Same normalizer (`adapters/phone.ts:1`) handles canonical uniqueness and validation; configured does not mean a phone is available.                                                                              |
| `meter`             | `price-decision` correct_meter refuses 409 `meter_policy_unconfigured`; sale remains held.                                                                          | `reviews/meter-config.ts:178` validates current profile coverage/dependency; old uncovered sales may still be denied. It is independent of `reviewEvidence`.                                                     |
| `phoneVerification` | Challenge/verify/replacement refuse 409 `phone_verification_unconfigured`; customer-recovery screen shows setup unavailability.                                     | No production evaluator/provider exists. Test-only injection in `adapters/phone-verification.ts:52` does not make runtime health configured. WHR-49 remains open.                                                |
| `recovery`          | Original-phone recovery remains gated; no shipped recovery grant endpoint can be authorized from health.                                                            | No runtime evaluator/approved expiry/device policy. `health/policies.ts:78` leaves it unconfigured; no claim of configured happy-path coverage.                                                                  |
| `reconciliation`    | Preparation refuses 409 `reconciliation_policy_unconfigured`; confirmation stays finalization_blocked. Giveaway screen shows the distinct checklist-policy blocker. | `giveaway/policy.ts:4` checks recorded registry/binding/evaluator integration. Manager/census/exclusions affect readiness independently (`phone-readiness.ts:25`).                                               |
| `timing`            | Settings timing writes refuse 409 `timing_policy_unconfigured`; readiness/ranking distinguish missing policy/values.                                                | `settings/policy.ts:16` checks recorded P-28 station policy. A configured policy with no campaign still has campaign_unconfigured readiness; Settings supplies values without an ops toggle.                     |
| `cardPrint`         | PDF preparation refuses 409 `print_layout_unconfigured`; Excel register remains separate.                                                                           | `cards/config.ts:1` validates the same layout as the export route; export does not activate cards.                                                                                                               |
| `duplicateWindow`   | Time-window detection is disabled; no credit gate/error/hold is introduced. Digest detection remains.                                                               | `duplicates/config.ts:1` validates the pinned window. Flags remain advisory for ordinary credit and separately block result reconciliation until decided.                                                        |
| `reviewEvidence`    | Ordinary decisions deny insufficient evidence; P-29 preparation/proposal/approval additionally require selected complete v2 (`release_policy_unconfigured`).        | `reviews/config.ts:104` verifies active recorded approval and installation; health/service.ts:57 reports the actually selected release. Configured does not prove per-sale sufficiency or enable meter under v2. |

**Finding:** no additional confirmed policy-health mismatch. The absence of a
production configured branch for phoneVerification/recovery is explicitly an
existing policy dependency, not silently green health. Retention is not a
thirteenth health key: configured days record intent only; deletionEnabled remains
false (`src/ui/admin/settings.tsx:732`, amended M4 contract). No tested screen is
allowed to turn fullyConfigured, a reason checkbox or a completed upload into
credit, physical-phone certification or finalization authority.

## Seams found sound and remaining limits

Source trace and existing suites support these specific seams, not a blanket
end-to-end certification:

- UUIDv7 sheet reservation identifiers survive the next validators (WHR-176 fix);
  random object-path IDs do not cross strict JSON-ID contracts.
- SaleDetail original date comes from the original revision; current/candidate
  date is separate (WHR-181 fix). Accepted snapshots remain immutable.
- The same incomplete purchase cannot receive two applicable approved phone
  exclusions; readiness/certification also reject retained duplicates (WHR-179 fix).
- Separate correction and ordinary/P-29 paths retain optimistic guards, live
  permissions, independent people where required, and durable replay identity.
- Open sibling holds/policy blocks keep zero credit; pending corrections preserve
  prior accepted spend; duplicate flags do not invent an ordinary-credit hold.
- Reports/customer operational totals share accepted contribution semantics;
  campaign membership and complete-photo deadlines remain an additional layer.
- Current customer card/phone changes preserve permanent customer and historic
  seller/card attribution; private case, source and paper access remain gated.
- Server deadlines, exact money/quantities, source generations, preview digests
  and immutable predecessor snapshots govern giveaway writes.
- Public health discloses aggregate configuration only; policy configuration,
  campaign readiness, test injection and production activation remain distinct.

Full HTTP reproduction of G1, physical phone/camera behavior, client production
policy activation, WHR-178's future projections and Rook/Earl acceptance are not
claimed by this report. The single new confirmed defect is filed for separate
approval; existing policy dependencies and local test-infrastructure limits were
not turned into duplicate product issues.
