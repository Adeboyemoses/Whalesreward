# Registration, customers and loyalty cards implementation plan

> For agentic workers: use the assigned isolated builder/test worktrees under the AGENTS.md role boundaries. Execute each task with a failing regression, minimal implementation, green verification and explicit-path commit.

**Goal:** Deliver WO-app-6 / WHR-13 against the merged M2 API and stop at READY; WHR-11 and WHR-77 remain In Review for Earl's later consolidated smoke workbook.
**Architecture:** Extend the persistent admin shell with memory-only customer/card modules and typed shared-schema clients. Add an online-only attendant registration flow with memory-only frozen requests/receipts, existing scanner and guarded fresh-card transition into sale. Server permissions, credit, registration/linkage, inventory, export snapshots and sign-in windows remain authoritative.
**Tech stack:** Existing Next.js/React/TypeScript, vendored wr- design system, zod, shared exact helpers, Vitest/Playwright and local PostgreSQL/Mailpit/MinIO. No new runtime library, API, schema or policy.
**Spec:** docs/engineering/contracts/m2.md; three adjacent row briefs; docs/qa/smoke-2026-11-09-customers-cards.md; WHR-13 approved boards and decisions P-06/P-09/T-18.

## Constraints and review focus
- No feature PR edits to STATUS, coverage or lane; separate READY records after verified green feature merge.
- Lost registration/export/transition responses must retain original operation ID/body and originating authority; never duplicate after automatic new-key retry.
- Late route/account/permission responses must not restore PII or trigger an unauthorized browser download; clear ephemeral PDF URLs.
- No attendant phone/draft/receipt persistence or expanded SW/API caches. Generic offline Register shell may render Connect to register, never submit offline.
- Pagination/filter changes must not mix records/cursors or claim loaded rows are global counts; exact money/quantities and unknown provenance remain intact.
- Preview and downloads use the same prepared PDF snapshot; linking, preparation, download, printing and activation remain separate facts. D08 gates remain configuration-driven.

## Task 1: Online registration — offline-engineer
Own: src/app/(attendant)/attendant/register/**, sale/page.tsx entry/handoff, _components/runtime.tsx only if required; new src/client/registration-api.ts and colocated tests; generic register SW manifest/worker allowlist and tests only where needed. Existing offline/client APIs may get minimal scoped authority-error integration with tests, never persistence schema/outbox changes.
Interface: registration API consumes registrationSchema/registrationReceiptSchema and customerLookupSchema; new sales use existing M1 current card lookup and server-returned identity, not receipt identity. Pass transient handoff in memory; URLs carry only route IDs, no name/phone/search. Coordinate test selectors/routes with test engineer.
- [ ] Failing unit tests: same body/key on uncertain retry, mismatched receipt operation rejection, duplicate exact-phone no phone returned, stale authority fences.
- [ ] Implement A06/A25/A07/A24 and scanner, six categories, Connect to register, safe no-receipt reload, no active card guidance and fresh lookup before sale.
- [ ] Add regressions for no PII in persistence/SW, old account/response clearing, no offline window renewal; preserve first-password/reassignment/outbox tests.
- [ ] Run focused tests, typecheck/lint/build; commit explicit owned paths and report head, tests, red evidence and limitations.

## Task 2: Admin customers/cards — frontend-engineer
Own: src/ui/admin/customers*.tsx and cards*.tsx, portal.tsx integration; new src/client/customer-admin-api.ts and customer-admin-types.ts with colocated tests; scoped src/styles/customers-cards.css and style import in admin layout. Existing station/access code changed only for required shell routing, preserving behavior.
Interface: CustomerPortal and CardsPortal consume current ready session/permission epoch and route, keyed to authority; persistent list/review context above route-keyed detail. Typed responses reuse shared customers-cards schemas and page envelopes. Binary file fetch obeys the same no-store/auth/error boundary as adminRequest.
- [ ] Failing unit tests: strict response/schema parsing, frozen generation/transition/export body, exact large aggregates, cursor/filter isolation and binary error/type refusal.
- [ ] Implement C01/B05/S08 scoped reads and server-masked identities with customers+sales guard; no M3 controls/unsupported global filters.
- [ ] Implement B06/K01/K04/K02/K05/K06/K03 including complete pagination, forward-only reasoned reviews, explicit immutable export preparation/history/status and protected PDF preview/download.
- [ ] Regress permission loss/late route results, uncertainty, version conflicts, narrow grants and no reload/remount confirmation loss. Run focused gates and commit explicit paths.

## Task 3: Independent functional/parity verification — test-engineer
Own: tests/customers-cards/**, tests/e2e/customer-registration.spec.ts and customers-cards.spec.ts, tests/design-parity/customers-cards/**; app-owned existing fixture changes only as needed and documented. No product code writes.
Interface: use actual merged APIs and local fictional accounts/policies; behavioral transport faults may simulate loss/delay but assert real DB result. Any fake must be clearly separated from real-stack success claims. Reuse current local x-test-ip fixture isolation without weakening quotas/timeouts/assertions; no root tooling edits without Core review.
- [ ] Establish reproducible pre-feature failing browser baseline for representative Register, Customers and card lifecycle routes; record fixture preconditions.
- [ ] Real-stack registration/duplicate/scan/code/lost response/capture handoff, lifecycle cancel/review/Printed/Active and export read/download tests; check immutable DB result and no PII persistence. Independent narrow-grant, permission revocation, stale/late results and pagination cases.
- [ ] Run design-fidelity-check on all 13 scoped boards plus A24 integration: 390/360 attendant, 1440/390 admin; original/built screenshots and geometry. Actual PDF content/QR verification and declared contract differences; no fabricated board parity for native PDF internals.
- [ ] Report failures to owning builders, commit tests/artifacts only, supply final named output and no acceptance overclaim.

## Integration and READY — EM
- [ ] Commit frozen high-tier evidence plan before dispatch; builders/tests work from that commit in isolated worktrees and never revert others.
- [ ] Integrate explicit commits, run own typecheck/lint/unit/build plus full user-flow E2E and parity. Integration suite required only if own server/schema changes (not planned); CI runs existing required checks regardless.
- [ ] Freeze clean head; three independent diff-scoped code/security/integrity reviewers in parallel, high cap3; fix only through builders, verify head/tree and validate committed evidence.
- [ ] Open feature PR into staging, wait all required checks, exact-head squash merge and verify actual MERGED state. Separate reviewed records PR updates app lane/STATUS/named invariant and board coverage while preserving other lanes.
- [ ] Post READY on WHR-13, move In Review, keep WHR-11/WHR-77 In Review, clean only own merged worktrees/runners and stop. No next work order, main promotion, cloud/provider/staging data or live Owner action.
