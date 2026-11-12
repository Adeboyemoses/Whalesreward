# lane:spec
WO-spec-3l (WHR-125) online price refresh: READY on reviewed green records merge, 2026-11-12

## In flight
- [Spec PR #122](https://github.com/Adeboyemoses/Whalesreward/pull/122) merged into staging at 237a6d6 with five green checks. Code/security/integrity PASS at 4f8af97, round 1, no findings. This separate records merge completes READY; WHR-125 remains In Review, not accepted.
- P-27 specifies existing session reads and strict capability-gated lookup snapshots. New drafts adopt with a notice; composed drafts keep and warn. Saved/queued/settled sales, capture bounds and offline behavior stay unchanged; zero requests solely for price refresh.
- EM typecheck/lint, 689 unit tests, build, local links, paragraph limit (maximum 120 words) and evidence PASS. Two inherited image warnings. PR-T1-01–12 are downstream obligations; no runtime implementation or board parity claimed.

## Next
- Stop at READY. Rook should draft/number the two high-tier follow-ons in M1: Core P-27 online price snapshots, then App P-27 price adoption and draft notices. Neither is started here.
- Rook should mirror P-27 in product docs. P-26 meter implementation/profile activation remains separate.

## Earl's gos
- 2026-11-12: “Start WHR-125 (WO-spec-3l); WHR-124 is READY.” “Log P-27 and list the follow-on core and app work orders.” “Stop when merged and report READY.”

## Risks
- Refresh reduces stale captured rates but cannot eliminate holds when history changes within the original P-20/P-23 interval. No polling means idle/offline phones learn on their next ordinary successful read.
- Q-528 and Q-559 remain separate pending inputs. No main/cloud action or runtime activation authorized.
- Full runtime model ID unavailable. Metrics include three spec reviewers and one separate records reviewer.

dispatches=4 prs=2 rounds_max=1 escalations=0 model=unavailable
