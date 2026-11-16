# Admin row 11: leaderboards and giveaway — Stage 2a

Boards: E01 → E02 → E04 → E03. Feature: F09/F11. Invariants: I-07/I-09/I-11/I-40–I-46/I-49.
Decision note: `product-docs/04 UI Design/Admin Portal/Admin Leaderboard Screen Decisions.md`.
Approved design: [giveaway checklist brief](../design/giveaway-checklist-brief.md), narrowed by Earl's 16 November Stage 2 split and WHR-165–167.

| Board | Route | Components | Reads | Writes | States | Permission |
|---|---|---|---|---|---|---|
| E01 | `/admin/leaderboards` | PageHead, Notice, Sheet, DataTable, select, Button | campaign, RankingPage | none | loading, error/offline, unconfigured, provisional, recorded all-time, empty category, stale page | leaderboards; sales for View purchases |
| E02 | `/admin/leaderboards/finalize` | PageHead, Notice, KeyValueList, Sheet, TextField, Button | Readiness, campaign, snapshot history, live ranking | prepareGiveawaySchema | no campaign, policy unset, before cutoff, grace open, grouped blockers, phone missing/stale, canPrepare, uncertain preparation, unchanged reconciliation | leaderboards; relevant action grant to prepare |
| E04 | `/admin/leaderboards/finalize/confirm` | Sheet, Notice, KeyValueList, DataTable, Button | owned frozen SnapshotPreview, readiness, frozen rows, changes | confirmGiveawaySchema to snapshots or predecessor revisions | no reviewed draft, preview not saved, preparing replay, unavailable/expired/stale, uncertain confirm, permission revoked, saved receipt | leaderboards + giveawayFinalize or giveawayRevise, independently |
| E03 | `/admin/leaderboards/finalize` saved selection | Notice, Sheet, DataTable, KeyValueList, select, Button | snapshot summary/rows/sources/changes/history | revision preparation then E04 | saved history, earlier selection, paging, no changes, unchanged reconciliation, revision pending, read error | leaderboards; sales for source/purchase changes; giveawayRevise to revise |

## Behaviour

- Consume WHR-22 merge b4dcc7b unchanged; no API, server, schema or contract edits. Routes follow the existing flow, with E04 as a child state. Preserve category on return and customer-filtered Sales links.
- Rank and sharedRank come from server, including across page boundaries. No local rank recomputation or tie breaker. Use exact kobo/decimal strings; separate currencies, litres and kilograms. All-time recorded totals are explicitly separate from qualifying campaign totals and cannot be finalized.
- E02 displays exactly five grouped counts, every returned blocker and phoneCheck metadata. Counts overlap: never add them. No nine per-check rows, inferred passes or fabricated granular counts. Link authorized reviews/corrections/duplicates/uploads/release-proposal destinations; checklist destination says “not available yet”. Manager, census and unavailable-phone forms remain Stage 2b.
- Use server canPrepare even when reconciliation_required is present; reason alone is no certification. Preparation records reconciliation and a preview, not a saved result. Preview uses returned guard; confirmation uses frozen preview contentDigest and ID. Revisions target latest predecessor. Unchanged reconciliation has its own receipt, no E04 and no new snapshot.
- Freeze operation ID/body before each mutation. Preserve the exact pending body in authorized session memory across internal navigation; no persistence or sensitive draft URLs. Uncertain response (transport, invalid success, 429/5xx) locks conflicting edits and permits same-request retry only. Definitive stale/conflict requires explicit refresh/review. Same-key replay is historical, never current readiness proof.
- Session epoch/account/authority changes clear protected data and draft; async responses must not resurrect it. Read-only viewers cannot mutate; finalize and revise are independent grants. Server remains authority.
- E04 presents exact frozen totals, category ranks, exclusions, reason, actor, expiry, timing, predecessor, reconciliation/phone-check/source-version IDs and comparison. Confirmation additionally needs matching owned preview and fresh canConfirm. Sources in E03 are immutable and permission gated; older names/ranks must never join live data. History and every detail list use explicit paging.

## Copy and board deviations

- “Not configured” replaces all fictional periods and rankings when campaign values/policy are missing. No board sample names, money, ranks or dates in production.
- “Finalization checks”, “Review final snapshot”, “Confirm and save snapshot”, “Keep reviewing”, “Snapshot and revision history”, “Prepare audited revision”, “Revision reason”.
- “Finalization checklist · not available yet” and an explanation of Stage 2b; no working link to an unbuilt form.
- “Snapshot preview · not saved”; reason displayed read-only after preparation, because it is pinned to preview. Required reason is entered before preparation.
- “The result of this request is uncertain. Retry the same request before starting another change.”
- “Reconciliation recorded. The saved result is unchanged; no new snapshot was created.”
- Saved receipt: “Snapshot {number} saved.” Earlier snapshots remain selectable; prizes manual.
- Exact campaign instants/timezone use existing campaignTime, retaining raw ISO fractional precision; audit times Africa/Lagos. Existing design tokens, wr classes and responsive shell; 48px phone controls. No whole-page overflow at 1440/390/360.

## Contracts needed

Existing m4.md and merged giveaway module projections only: Campaign, CampaignGuard, RankingPage, Readiness, SnapshotPreview, ReconciledUnchanged, SnapshotSummary, SnapshotSource, SnapshotChange and CustomerChange. Client-side strict parsers may live in `src/client/`; existing request schemas in `src/shared/contracts/giveaway.ts` remain unchanged. Granular check/selection projections belong to Stage 2b dependencies WHR-170/WO-core-12b.

## Implementation plan

1. Frontend builder owns new client giveaway adapter/parsers and focused unit tests; add E01/E02/E04/E03 UI/routes using existing session epoch and design system patterns. Prove malformed/mismatched receipts fail, retries retain body/key, guards use returned preview, paging preserves ties and grouped counts. Commit explicit paths.
2. Independent test engineer owns real-stack browser cases and fidelity evidence/runbook updates in a separate worktree. Exercise no campaign, ties/category/paging, grouped blockers, dirty marker preparation, owned preview/save/replay/uncertainty, stale data, saved revision/source/history/unchanged and permissions at 1440/390/360.
3. EM reruns final typecheck/lint/unit/build/e2e gates. Code/security/integrity reviewers run read-only in parallel; fix cap 3. Evidence committed alone after final reviewed head; validate, push, PR to staging, green CI, merge and READY-2a. Do not change STATUS, coverage-map or lane files. Stop before WHR-171.

## Open questions

None for Stage 2a. Actual people/policy/campaign configuration remain operational prerequisites, never seeded by this change.
