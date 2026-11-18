# Admin row 05: two-person stuck-hold release

Authority: approved docs/design/two-person-release-brief.md (WHR-161), exact copy R0–R18; M3 P-29 and T-20 including app row/RD-07. Earl's WHR-144–148/159–161 decisions supersede old open-question wording. No new static boards required. Existing S02/S03/S04/S06/S07/S09 and A14 implementation briefs remain visual references.

| Surface | Route | Components | Reads | Writes | States | Permission |
|---|---|---|---|---|---|---|
| Ordinary kind review + in-place release | existing /admin/sales/:id review route | Sheet, Notice, KeyValueList, Reason, Button, photo viewer | ReleasePreparation, ReleaseProposal/history, current SaleDetail | sheet reserve/URL/PUT/finalize, propose, decision | R0–R18 | sales + matching kind grant; server person checks |
| Review queue | existing review queue | filters, DataTable, safe pending rows | PendingReleasePage | none | loading/empty/error/paginated/stale references | sales + any matching kind grant |
| Sales | existing list/detail | existing filter/table/summary | pending_release SaleFilter and pendingRelease | none | loaded/error/empty/permission loss | sales; summary kind-filtered |
| Giveaway/audit | existing routes | Notice, safe events | existing readiness and closed audit catalogue | unchanged | aggregate blockers and safe transitions | existing live grants |

## Behaviour

Consume WHR-153 (22312aa) and WHR-164 (e23162b) unchanged. Gate new form on structurally_admissible, proposerAccess.allowed, configured v2, current full live grants and no known pending proposal. Preparation supplies exact historical IDs, complete targets, candidate and guard. Never infer identifiers or eligibility. Keep transcriptions blank. Read current post-proposal guard for a new decision; uncertain writes preserve operation/body/path/actor/guards. Protected data exists only in account-scoped memory and is cleared on access loss/unmount. Dedicated queue defaults to all authorized kinds and does not inherit ordinary filters. No new endpoints, binding editor, runtime policy or attendant detail.

## Copy and contracts

All exact labels, errors, impact copy, precision expansion and photo states in approved design brief are binding; use strict shared held-release contracts and exact string money/quantity parsing. Status remains server-owned. Written decision replaces any need for new static boards; existing board hierarchy and design-system tokens remain.

## Open questions

None: supplied decisions resolve preparation, discovery and written-screen authority. Runtime activation and Earl's eventual station smoke are separate.
