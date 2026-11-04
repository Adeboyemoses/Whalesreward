---
name: log-decision
description: "Use when Earl settles a Whales Rewards technical or product question, to record it in docs/engineering/decisions/ (INDEX.md and technical.md) with the supersede protocol. Not for open debates; those stay as needs:human issues."
---

# Log a decision

Ask for anything missing: the decision (one sentence, active voice), why (one line), type (product P or technical T), source (product doc section, Linear issue, Earl's message and date), the question it resolves (Linear `needs:human` or Earl's Q-ID), and what it supersedes.

1. **Settled?** If it's still being debated, stop: it's a `needs:human` issue, not a decision.
2. **Product decisions** belong in the product docs, which you can't edit. Record a P-row in INDEX.md citing Earl's message, and tell Earl that Rook should update the product docs too.
3. **Next ID:** the highest `T-` (or `P-`) in INDEX.md plus one.
4. **Conflicts:** grep INDEX.md and technical.md for the area. To change an old decision, add the new row with "Supersedes T-NN (reason)", append "Superseded by T-MM on YYYY-MM-DD" to the old full-text row, and replace the old INDEX row with the new one (INDEX holds only rules in force).
5. **Write:** a full row at the end of technical.md (T only), and one line in INDEX.md.
6. **Close the question:** comment the decision on the `needs:human` issue and close it.
7. Commit it in its own PR. Changes under `docs/engineering/decisions/` are medium tier: code-reviewer plus the routed domain reviewer, with an evidence file.
