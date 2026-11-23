# Canonical people: operator runbook outline

WO-spec-3q / WHR-222, 23 Nov 2026. **Planned command; not installed.** Read the [contract](../engineering/contracts/person-provisioning.md) for exact semantics, private evidence, locks, audit and rejection requirements. This outline neither runs a seed nor authorizes staging/production data changes. Rook reviews and Earl approves policy; a later core work order implements and verifies it. Earl then explicitly approves the concrete environment-specific execution. Agents never handle credentials or provision real identities.

## Before any operation

1. Use the separately reviewed core checkout and pinned Node version. Confirm `pnpm ops:people --help` exists; stop if absent. Obtain Earl's private approval of scope, exact IDs/action, binding versions and next provisioning revision. Q-576's actual manager and independent approver are confirmed privately; fictional smoke identities do not satisfy production naming.
2. Earl supplies `DATABASE_URL` through his secure shell workflow, with certificate-verified TLS for managed databases. No dotenv load, URI arguments, credential files, shell tracing or copying terminal output into public artefacts. Do not reseed an existing staging database to install people.
3. Follow [database-comment identity](review-evidence.md#one-time-database-identity-earl-only): exact persisted `whr.environment=staging` for this smoke. Every inventory/preview/apply validates it. A non-null mismatch stops the procedure; never relabel. Initial null-only setup is a separate Earl operation.
4. In protected operational storage, record the association verification attestation and obtain opaque references. `authorization` approves the operation; `verification-reference` supports the checked account/person association. No private evidence, names, emails, document IDs or URLs in references. The real association map and output remain private. Below, names/IDs/references are fictional only.
5. Run a read-only inventory, follow all pages, and identify all enabled accounts, existing canonical people and disabled historical exclusions. Reuse existing canonical person IDs for known humans; never create one person per account automatically. Investigate unknown identity/provenance before applying anything.

```sh
pnpm ops:people list \
  --station 019a5000-0000-7000-8000-000000000008 \
  --environment staging
```

Expect no writes/audit. Inventory reports the provisioning revision, current binding versions/flags, gaps and distinct verified enabled-admin count, including disabled accounts and unassociated identities. It prints no display names, email, phone or secret. Do not run this proposed command yet against a deployed database.

## Preview, apply, verify and inspect

Example for fictional Owner account `...002`. The new person ID is a proposed fixture ID, not a known production row. These commands illustrate syntax, not a script to run without reviewing each preview.

```sh
pnpm ops:people create-person \
  --station 019a5000-0000-7000-8000-000000000008 --environment staging \
  --person 019a5000-0000-7000-8000-000000000801 \
  --reason-code initial_provisioning --authorization FICTIONAL-CREATE-01
```

Default dry run: expect one proposed person, no verified accounts and no writes. Review printed next revision N and the exact scope/IDs. Obtain approval for N; copy the **same** command adding `--apply --expected-revision N` with N replaced by the printed integer. Existing ledger rows may make N different from 1. Do not use the release-policy revision. Expect an immutable provisioning event/person/audit, then inspect successful apply output privately.

```sh
pnpm ops:people bind \
  --station 019a5000-0000-7000-8000-000000000008 --environment staging \
  --user 019a5000-0000-7000-8000-000000000002 \
  --person 019a5000-0000-7000-8000-000000000801 \
  --expected-binding-version 0 \
  --reason-code initial_provisioning --authorization FICTIONAL-BIND-01
```

Review preview and apply with its **fresh next** `--expected-revision`. Expect binding version 1, `verified=false`. This account is still ineligible for identity-dependent actions.

After the private account-control/roster check (a fictional attestation for smoke):

```sh
pnpm ops:people verify \
  --station 019a5000-0000-7000-8000-000000000008 --environment staging \
  --user 019a5000-0000-7000-8000-000000000002 \
  --person 019a5000-0000-7000-8000-000000000801 \
  --expected-binding-version 1 \
  --verification-reference FICTIONAL-ASSOCIATION-01 \
  --reason-code verification_completed --authorization FICTIONAL-VERIFY-01
```

Preview then apply with the new N. Expect binding version 2, `verified=true`; read it back using `list --user <same-user-UUID> --history` plus scope. A stale N or binding version writes nothing: new preview and matching authorization are required. For a lost apply response, use `list --revision N` with the same scope to reconcile the exact immutable event privately before any retry. Never assume a network error means rollback.

For later corrections preview `rebind --user U --person P --expected-binding-version V`, then apply with scope/authorization/reason `identity_correction` and the new N. Expect unverified successor; a separate private verification is required. Preview `unbind --user U --expected-binding-version V` or `disable-person --person P` with `identity_uncertain` or `offboarding`, then apply after reviewing the full alias set and affected campaign counts. These revoke person bindings, not login accounts. The existing access workflow handles login disable; it preserves bindings for historical exclusions. None of these commands repairs a sale, rejects a proposal, designates a manager or activates policy.

## Fictional account map for the end-of-M4 smoke

Run only on an Earl-approved fictional staging dataset after implementation. Never copy this map to production. Seeded account/profile IDs come from `prisma/fixtures.sql`; person IDs below are **new planned** identities. If any ID is occupied differently, stop and choose fresh reviewed fixture IDs, rather than overwriting.

| Fictional account | auth_user.id | Existing/new profile | Canonical person to create/reuse |
|---|---|---|---|
| Ada Williams, Owner/manager candidate | `019a5000-0000-7000-8000-000000000002` | Seeded admin `...005` | `019a5000-0000-7000-8000-000000000801` |
| Grace Okon, attendant | `019a5000-0000-7000-8000-000000000003` | Seeded attendant `...006` | `019a5000-0000-7000-8000-000000000802` |
| Favour James, attendant | `019a5000-0000-7000-8000-000000000004` | Seeded attendant `...007` | `019a5000-0000-7000-8000-000000000803` |
| Tunde Adebayo, independent admin | `019a5000-0000-7000-8000-000000000090` | **Not seeded**; planned new admin `...091` | `019a5000-0000-7000-8000-000000000804` |
| Ada Williams, alias admin for refusal case | `019a5000-0000-7000-8000-000000000092` | **Not seeded**; planned new admin `...093` | Reuse Ada's `...801`, never create a fifth human |

All abbreviated profile IDs use the table's `019a5000-0000-7000-8000-000000000` prefix. The only seeded admin is Ada; the seed alone cannot satisfy two distinct admin people. Provision the two additional fictional admin accounts through existing approved account administration in the future smoke setup, with private fixture credentials and completed first-password changes. The Tunde customer fixture is a different domain record and supplies no staff authority or identity evidence. Do not modify customer IDs or credentials with `ops:people`.

Grant the independent admin and alias the existing action permissions required for the scenarios through ordinary authorized administration. Manager/approver need `sales`, `leaderboards`, `giveawayFinalize` for initial and separately `giveawayRevise` for revisions; P-29 scenarios additionally need `sales` plus the tested kind's `priceReview`, `cardEligibility` or `dateReview`. Owner status is no bypass. No public/default staging password, manual email verification or direct role SQL is part of this walkthrough.

## Walkthrough and expected results

1. Confirm reviewed implementation, private authorization, comment identity and complete inventory. Before binding, v2 installation refuses new mutations; the manager selector has no verified eligible admin. No data/holds have been cleared.
2. Create each of the four new canonical people, one preview/apply at a time. Bind and independently verify each of the five account associations using the pattern above; the alias reuses Ada's person. Follow all inventory pages and bind **every other enabled account** present too, after private fixture review. Include disabled historical attendants/recovery actors referenced by test sales. Never assume the five rows exhaust a reused dataset.
3. Read inventory: no enabled-account gaps; at least two distinct verified enabled-admin people (Ada and Tunde); three admin accounts do not mean three humans. Grace/Favour remain distinct from both. Read-only list and application candidate reads create no audit/mutation. Merely preparing people has not changed review/meter/reconciliation policy configuration.
4. Verify missing/unverified attendant failure on a disposable rehearsal first: leave Grace unverified and show v2 mutation refuses even though both admins are verified; verify her explicitly and repeat. Never use an admins-only install bypass. Record only fictional IDs/counts in the smoke report.
5. Separately obtain Earl's approval to activate the reviewed v2 artifact at the exact station/environment/digest/next **release** revision/instant using [review-evidence operations](review-evidence.md#two-person-release-v2-whr-153). Bindings do not grant activation. Confirm all installation dependencies first; meter-v1 remains unconfigured under v2. Do not relabel/reuse its policy. P-29 denial/admission checks still run.
6. On a fictional eligible P-29 sale originating with Grace, Ada proposes. Her verified alias must fail independent approval; Tunde may approve only after ordinary evidence/admission/permission checks. Rehearse original-attendant/recovery alias exclusions and a proposer rebind/reverification: old approval returns `proposal_stale`, remains a giveaway blocker, and the independent rejection route closes only that proposal. Also unbind the proposer explicitly: rejection must succeed using retained identity in both preflight and commit, while sale holds and contribution gates remain unchanged; the unbound proposer cannot approve anything. Reverify only after a fresh authorized private check. No automatic credit follows provisioning.
7. Use normal UI/API as Owner with settings to designate Ada. Manager candidates now include only live verified eligible admins. Q-576's real production naming remains outstanding. With separately approved reconciliation policy and campaign settings, and trusted server time after cutoff and upload grace, record the complete physical-phone/account-partition census. Include disabled/offboarded historical accounts and replacement phones. Use [giveaway smoke](../qa/smoke-2026-11-19-giveaway-stage-2b.md) for the screen sequence.
8. Ada proposes an unavailable fictional phone with exact never-accepted/no-byte-observation partial sources. Her alias cannot approve; Tunde independently approves with the matching initial/revision grant. Record a **fresh** phone check after decision. No unknown phone-only queue is represented as zero; exact exclusion does not waive holds, corrections, duplicates, other uploads or eligibility.
9. In a separately authorized reversible rehearsal, unbind/rebind the manager after a proposal/check/preview. Expect live designation/check clearance, old approval `exclusion_stale`, stale preparation refusal, unchanged frozen history, and pending global blocker. Reverify (fresh evidence), explicitly redesignate through Owner+settings, independently reject stale exclusion using stored proposer exclusions, then create fresh proposal/check/preview. Test `disable-person` against Ada's aliases: both identities revoke atomically; account login remains independent; v2 may become unready. Do not run the command just to clear a pending item.
10. Clear remaining ordinary reviews/reconciliation through their lawful routes. Inspect all nine checklist outcomes, prepare/confirm one initial snapshot and same-operation replay, then an authorized source change/new linked revision and unchanged reconciliation as in [core M4 smoke](../qa/smoke-2026-11-16-giveaway.md). Stale binding/check/preview must block all three confirmation paths. Prior snapshots remain byte-identical. Recovering bindings alone never makes the checklist pass.
11. Keep real verification/authorization/output in protected custody. The public smoke record contains only fictional scenario evidence, reviewed core commit, counts and pass/fail; never URLs/credentials/private staff identities. If any expected result fails, retain data and blockers, file the failure and stop certification. Do not reseed, rewrite history or activate a bypass.

**Status:** walkthrough specified, not executed. WHR-222 ships documentation only. Actual M4 smoke/activation depends on Earl's decisions, reviewed core implementation and his explicit data/configuration go. The READY handoff asks Rook to review and Earl to approve; it claims neither of those approvals nor real verified people.
