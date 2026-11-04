# Work orders

> Every session works one work order (WO): build → ready → fix → accept → close. Found work becomes an issue, not extra scope. Ported from Phaneum's protocol (adopted there 12 Oct 2026) for Linear team `WHR`.

## What a work order is

- A Linear issue in team `WHR`, labelled `work-order` and its lane label (`lane:core`, `lane:app` or `lane:spec`), titled `WO-<lane>-<n>: <name>` (for example `WO-core-1: Repository scaffold`).
- Its child issues are the only issues the session may touch. A work order with no children is a single scope item. A child added after approval is out of scope until Earl approves it.
- Size guide: one flow row of boards, or at most six child issues, or about two working days.

## Approval

- Rook drafts the work order. When Earl approves, Rook makes the description's last line `Approved by Earl, <d Mon yyyy>; Rook moved it to Todo` and moves it to Todo.
- The EM **starts** a work order only if it carries that line and is in Todo. It **resumes** one only if it carries the line and is In Progress or In Review.
- The EM never writes the approval line and never moves a work order to Todo.
- If Earl gives an explicit go in his own message in the session, naming the work order, the EM comments his quote on the issue and works it for that session only.
- Anything else (no line, Backlog, Blocked, Canceled, Done): ask Earl.

## Template

```
Lane:          lane:<core|app|spec>
Milestone:     M<n> (docs/engineering/roadmap.md)
Session model: <model>, reasoning <effort>
Goal:          <one sentence>
Scope:         <child issues only>
Inputs:        <board IDs, decision notes, F&R and TRD sections, invariant IDs, decision IDs>
Done means:    <testable list>
Verification:  user-facing: smoke runbook docs/qa/smoke-<date>-<slug>.md, written at START
               back-end: named tests and the commands the EM runs and pastes
Out of scope:  <explicit list>
Stop when:     <condition>
```

The EM records the model actually used in the lane-file metric line. The requested session model is not evidence of the runtime model.

## Flow

```
WO approved → questions batched → tier + plan (high) → builder in worktree off origin/staging
→ EM re-runs gates → reviewers (diff-scoped, parallel) → fix rounds within cap
→ evidence committed → PR into staging → CI + review-evidence green → EM merges
→ READY message → Earl smokes / reads verification → FIX → ACCEPTED → CLOSE
```

Branches: `<lane>/WHR-<n>-<slug>` for a child issue, `<lane>/wo-<n>-<slug>` for a childless work order. A branch name or PR title never contains the work order's own ID, or Linear closes it on merge. A PR body cites `Part of WHR-<n>` (the work order) and may close a child with `Fixes WHR-<child>`.

## States

| State | Means |
|---|---|
| BUILD | Children in flight: dispatch, review, merge to `staging` |
| READY | "Done means" is met on `staging` and verified; the READY message is posted |
| WAIT | Earl is smoke-testing or reading the verification. A session that stops here writes its lane file with state READY |
| FIX | Earl's findings for this work order only, then READY again |
| ACCEPTED | Earl said yes (user-facing), or the verification passed and he hasn't objected by the stated default date (back-end) |
| CLOSE | Lane file overwritten, coverage map and STATUS.md updated, one close-out PR, work order Done |

Until a staging environment exists on DigitalOcean (milestone M5), "on staging" means merged into the `staging` branch with CI green, and Earl smoke-tests on his machine or the pilot phone using `pnpm dev` and the runbook.

## Stop rules

1. Only the work order's children.
2. Found work becomes an issue labelled `found-in:<WO>` and its lane label, never a PR.
3. A P0, SEC-HIGH or INTEGRITY-P1 in code you touched is fixed inside the work order; tell Earl before the fix. Anything else urgent goes to Earl as an A/B, default "ticket it".
4. READY means stop. Post one message with PR links, the runbook or verification output, and the decisions needed. Then wait.
5. FIX takes only Earl's findings for this work order.
6. Acceptance never stands in for a T2 go or an over-cap escalation; those record Earl's actual answer.
7. The next work order starts in a new session.

## Slice rules

- **One PR per coherent slice**, not one per issue.
- **Saved plan (high tier).** Before dispatching the builder, commit the `plan:` block (goal, files, approach, tests, risks; one line each, 15 lines at most) in `.review/<branch>.md`. Reviewers check the diff against it.
- **Escape-to-test.** A fix for a bug that escaped (found in Earl's smoke test or after merge) ships with a test that fails without the fix, plus a one-line gotcha in the agent file that should have caught it. The PR body says `escape: <where found> · <test name>`.
- **Invariant-to-test.** A PR that implements an invariant from `docs/engineering/invariants.md` names its test in the coverage map.
- **Dispatch count.** One subagent call (builder, reviewer or test-engineer, including re-runs) is one dispatch. Record `dispatches: N` in the evidence. Flag a PR in the lane file when it passes 4 dispatches (low and medium) or 8 (high).
- **Smoke runbook first.** For user-facing work orders, write `docs/qa/smoke-<date>-<slug>.md` at the start: numbered steps Earl can follow on a phone, each with the expected result and the board ID it should match.
