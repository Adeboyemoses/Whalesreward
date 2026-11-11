# lane:spec
WO-spec-3h (WHR-103) evidence admissibility: READY on reviewed green staging merge

## In flight
- Branch `spec/wo-3h-evidence-policy` contains the proposal and READY records. Merge and verification links are posted on WHR-103; committed review evidence records the three independent verdicts.
- `docs/engineering/proposals/evidence-policy.md` is explicitly non-normative. It covers admissible facts, sufficient combinations, counterexamples, immutable policy/configuration versions and proposed protected `reviewEvidence` health reporting.
- No change to m3.md, runtime code or policy activation. The proposal preserves zero-credit unresolved holds and independent WHR-50 gating.

## Next
- Stop at READY after merge; WHR-103 stays In Review, not accepted.
- Earl/client questions: EP-1 WHR-109 (closed evidence set), EP-2 WHR-105 (price limits), EP-3 WHR-106 (replacement proof), EP-4 WHR-107 (single-day proof), EP-5 WHR-108 (capture proof). Recommend A in each; no runtime activation without explicit approval.
- After approval, Rook commissions the normative amendment and a separate core evaluator work order. Q-528 remains pending.

## Earl's gos
- 2026-11-11: “Work order WHR-103 (WO-spec-3h) is approved and in Todo.” “Write a PROPOSAL (not yet normative)”. “Don't change m3.md.” “Code, security and integrity verdicts. Stop when merged and report READY with the questions.”

## Risks
- Some genuinely ambiguous cases cannot be resolved by the proposed first evidence set. Price cancellation is unsupported; meter correction remains WHR-50. No new external admission channel.
- No implementation or board parity claimed; no cloud change or main promotion. Full runtime model ID unavailable.

dispatches=3 prs=1 rounds_max=1 escalations=0 model=unavailable
