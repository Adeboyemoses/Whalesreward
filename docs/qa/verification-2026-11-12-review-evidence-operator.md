# Review-evidence operator verification

WHR-114 / WO-core-9b. Feature [PR #119](https://github.com/Adeboyemoses/Whalesreward/pull/119) merged into staging at `ace2f433de17c9ebb4091304d1455ca0495d2ad4`. Decision [PR #117](https://github.com/Adeboyemoses/Whalesreward/pull/117) records T-19 from Earl's WHR-116 Option A. The separate READY records merge completes the handoff; it does not activate a deployment.

## EM verification

```text
pnpm typecheck: PASS
pnpm lint: PASS (two existing next/no-img-element warnings)
pnpm test: 71 files, 689 tests passed
pnpm build: PASS
pnpm test:integration: 31 files, 699 tests passed
```

These commands ran on feature head `568c822`. The later base merge changed only the already-reviewed T-19 decision documentation; all feature files stayed byte-identical. Final-head [CI run 43210317133](https://github.com/Adeboyemoses/Whalesreward/actions/runs/43210317133) passed build, gate-self-test, integration, e2e and the separate review-evidence check. CI repeated 689 unit and 699 PostgreSQL tests, timezone tests 5 in UTC and 5 in America/New_York, 276 browser tests with four existing skips, and one storage test. No flaky result was reported.

## Operator cases

The 11 unit tests in `tests/unit/review-evidence-operator.test.ts` cover default dry run, explicit apply, strict expected revision, built-in digest validation, malformed/ambiguous arguments, inactive semantics, secret-safe CLI failures, help without database access and microsecond-preserving instants.

All 11 integration tests in `tests/integration/review-evidence-operator.test.ts` use real PostgreSQL and the actual database environment check:

- Dry run previews exact immutable rows and policy without writes.
- Apply commits activation atomically, then appends higher inactive and reactivation revisions.
- Concurrent activation/deactivation serializes and refuses stale authorization.
- Configuration-insert failure rolls the approval back.
- Revision allocation includes orphan approvals and refuses safe-integer exhaustion.
- Digest and environment mismatches write no rows.
- Previews reserve neither revisions nor UUIDs.
- Missing, malformed or duplicate persisted identity refuses the operation.
- Session SET and connection options cannot override database identity.
- Role-in-database settings cannot override or establish database identity.
- Real CLI production preview/apply/deactivate checks persisted identity and exact policy output.

Code, security and integrity reviewers independently passed round 1 at `568c822`. Each ran targeted PostgreSQL checks; code/security also ran unit checks. Evidence: [.review/core__wo-9b-review-evidence-operator.md](../../.review/core__wo-9b-review-evidence-operator.md).

## Operator handoff

Follow [the runbook](../ops/review-evidence.md). Earl supplies his secured `DATABASE_URL` in his own shell and provisions database-level `whr.environment` once with the admin user, after inspecting the persisted identity. Preview first; approve the concrete digest, scope, next revision and activation instant; apply with the printed expected revision. Set `WHR_REVIEW_EVIDENCE_POLICY` from successful apply output, then check protected `/api/health` with a live admin holding settings permission.

No managed database, cloud resource, public endpoint or deployed application setting was changed in this session. Policy operations do not reevaluate purchases or clear holds. WHR-18 starts in a fresh session after READY, as Earl instructed.
