# lane:core
WO-core-3 (WHR-4) Attendant authentication and sessions: READY on reviewed green staging merge, 2026-11-05

## In flight
- [PR #30](https://github.com/Adeboyemoses/Whalesreward/pull/30): Better Auth username sign-in, revocable database sessions, immutable capture contexts, credential-revalidated retries, persistent rate limits, secure cookies and safe fictional seeding. READY takes effect after all five CI checks pass and staging merge completes; final verdicts and commands are in .review/core__wo-3-attendant-auth.md and WHR-4.
- EM independently passed typecheck/lint/unit 77/build, fresh-database migrations/integration 65, time 3 per timezone and real HTTP Playwright 1. Local Chromium MachPort startup is sandbox-blocked; full browser CI is required before merge.
- T-14 confirms T-13's single auth-user model; Session.account.id is the attendant profile ID. WO-spec-3a's capturing sign-in lower bound stays immutable.
- WO-core-15 (WHR-28) remains READY from PR #22. Earl's provisioning and deployed staging checks are still pending; no cloud operations or staging data changes ran here.

## Next
- STOP at READY. Earl reads backend verification on WHR-4 and can run docs/qa/smoke-2026-11-05-attendant-auth.md. WO-app-2's phone smoke is now unblocked by the authentication merge; upload/credit remain later work.
- WHR-57 tracks the nonblocking P2 rate-bucket storage growth found in security review. No additional scope started.

## Earl's gos
- 2026-11-05: “WO-core-15 (WHR-28) stays READY until Earl reports the staging checks.”
- 2026-11-05: “Work order: WO-core-3 (WHR-4), attendant authentication and sessions, against docs/engineering/contracts/m1.md including the WO-spec-3a amendment. Take it to READY, then stop.”

## Risks
- Client D06 policy remains open; runtime defaults are centralized. No admin auth, recovery, sync/credit or real-phone acceptance claimed.
- A26 admin-unlock lockout wording conflicts with M1 temporary throttling; M1 governs. Staging fixture credentials require a separately supplied secret; no public default is installed.
- Runtime model ID unavailable. Review rounds 2–3 cover staging documentation integration and READY records; authentication implementation unchanged from round 1. Dispatch flag: PR #30 exceeds 8 calls because all three reviewers rechecked these final documentation updates.

dispatches=10 prs=1 rounds_max=3 escalations=0 model=unavailable
