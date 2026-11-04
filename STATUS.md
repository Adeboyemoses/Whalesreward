# STATUS.md
Updated: 2026-11-04

## Milestone: M0 Foundation (docs/engineering/roadmap.md); target: end of week 1 after kickoff

## Done this week
- Codex operating model, agents, skills, review gate and engineering guidelines written (Rook, 4 Nov 2026).
- product-docs symlink to the Fuel Station Loyalty folder created.
- Linear team WhalesReward (WHR) created by Earl.
- WO-core-1 (WHR-1) Repository scaffold merged to staging in PR #3; strict Next.js scaffold, pinned tooling, local services and all five required CI checks passed. ACCEPTED by Earl: "Accepted. Scaffold verified." No product features implemented.

## In progress
- WO-spec-1 (WHR-32): data-model PR #4 merged at 7d92cb6 with all five checks green; contracts PR #5 and lane setup PR #1 remain open. WHR-37 already merged in PR #6.
- Earl's one-time setup (docs/agentic/setup.md).
- WO-app-0 (WHR-33): M0/M1 implementation briefs and draft phone smoke runbooks; six briefs and three draft phone runbooks prepared for staging; Earl reads row 02 and one runbook after merge. No app implementation or device verification claimed.

## Blocked / decisions needed
- WO-spec-1: restore Git metadata writes for spec worktrees; PR #1 requires Earl's authorization for review round 4 after staging updates. WO-core-2's data-model dependency is cleared.
- Client kickoff and contract: not yet confirmed.
- Client DigitalOcean account for staging and production (needed by M4/M5).
- Launch date versus the December campaign start.

## Next up
- Start approved WO-core-1b (WHR-41), evidence validation after staging updates; WO-core-2 waits for the data-model merge. WO-app-1 follows its own approval.

## Known risks
- Five-to-six-week estimate against a November launch target for a December giveaway.
- Brand and product name awaiting client sign-off (Q-516).
- Verification provider, token expiries and role matrix not decided (D06).

WO-app-0 findings (2026-11-04): draft runbooks split by capture/local-save versus server confirmation; row 02 checks expiry and omits the M2 registration link in M1. Ready after findings PR merge for Earl’s re-read; phone execution remains pending implementation.
