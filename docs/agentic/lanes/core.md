# lane:core
WO-core-1h (WHR-232) port the operating model from Codex to Claude Code (Antigravity): READY since 2026-11-26.

## In flight
- Feature PR [PR #189](https://github.com/Adeboyemoses/Whalesreward/pull/189) merged into staging at `a03a89de1e5a4193b1f851b710581d76d5c06430`; feature and reviewed head `e54fb1f`. Shared records are in this separate docs PR. Earl's setup self-check in Antigravity is pending.
- CLAUDE.md imports a now-tool-neutral AGENTS.md. Eight agents live in `.claude/agents/*.md`: five builders inherit the session model with Read/Grep/Glob/Edit/Write/Bash; the three reviewers run on opus with only Read/Grep/Glob/Bash (no edit or write). The `.codex/**` wiring is left working so both surfaces run the same model.
- The shared guard (`.codex/hooks/guard.sh`) is extended to Claude's file tools: path values are parsed with jq (python3 fallback), so `.env*`, credentials, `.git` metadata and `product-docs/` writes are blocked by path. `.claude/settings.json` denies cloud/repo admin, sets TZ=UTC and empty attribution, and wires the PreToolUse hook via `${CLAUDE_PROJECT_DIR}`. Linear is wired through `.mcp.json` (OAuth; no token in the repo).
- CLAUDE.md, `.claude/**` and `.mcp.json` are routed high tier (routing.conf), asserted by test-review.sh; guard self-test covers Claude event shapes. docs/agentic/setup.md gains the Antigravity steps and the 5-minute self-check.

## Review
- High tier, two rounds. code-reviewer, security-reviewer and integrity-reviewer agents all PASS. Round 1: code FAIL on a P0 and security SEC-MED on the same gap — only the five builders had been ported, so dispatching a reviewer in Claude Code would fall back to a write-capable general agent. Round 2 added the three reviewer `.md` files (read-only, opus) and narrowed `gh run`; code and security re-reviewed PASS, integrity's round-1 PASS stands (the change is integrity-neutral).
- The security verdict is the **security-reviewer agent's**, not a human reviewer's. Accepted residuals (defence-in-depth, not reachable per that review): a shell-quoted `git add` force flag defeats the hygiene regex (the `.env`-path rule still blocks the secret case); the guard matcher covers Bash and the file tools, not MCP write tools (`.mcp.json` declares only Linear).

## Next
- Verification: Earl runs the setup self-check in a Claude Code session in Antigravity and pastes the result. READY means stop. No next work order is started; `.codex/**` cleanup, if wanted, is a separate later work order.

## Earl's gos
- 2026-11-26: "Open the records PR now (low tier, docs only): STATUS.md and docs/agentic/lanes/core.md for WHR-232, including the session model you actually ran (opus) and 'Earl's self-check pending'."

## Risks
- The guard is a tripwire over the sandbox, branch protection and review, not the boundary. Dispatch count 5 is within the high-tier flag of 8; two rounds within cap 3. No cloud, main promotion, client data or secret touched.

dispatches=5 prs=2 rounds_max=2 escalations=0 model=opus
