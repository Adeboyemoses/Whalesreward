# CLAUDE.md

Claude Code reads this first. The operating rules are tool-neutral and live in AGENTS.md, imported below; this file adds only what is specific to running the repo in Claude Code (inside Antigravity).

@AGENTS.md

## Running this repo in Claude Code

- **First, the 5-minute setup and self-check: [docs/agentic/setup.md](docs/agentic/setup.md).** Run it once per machine before working a work order. It verifies the guard is live, secrets are blocked and the gates pass.
- **The guard is live or you don't work.** `.claude/settings.json` wires a PreToolUse hook on Bash and the file tools to `.codex/hooks/guard.sh` (it needs `jq` or `python3` on PATH). Confirm it in `/hooks` under PreToolUse before the first mutation. Settings added mid-session are not live until you open `/hooks` once or restart.
- **Agents** are `.claude/agents/*.md`. Builders (backend, platform, offline, frontend, test) inherit the session model and write code in their own worktree. Reviewers (code, security, integrity) run on opus with no edit or write tools. Dispatch each reviewer as a fresh subagent — never in the thread that wrote the diff; if subagents aren't available, use a fresh session with that agent's file as its instructions.
- **Skills** are `.claude/skills/` (a symlink to the single source `.agents/skills/`); invoke by name.
- **Linear** is wired read/write through `.mcp.json` (`https://mcp.linear.app/mcp`, Streamable HTTP, OAuth via `/mcp`; no tokens in the repo). Authorize it once with `/mcp`.
- **Session model** per lane: opus for `lane:core` and `lane:spec`, sonnet for `lane:app`; reviewers are always opus. The work order names it; record the model you actually ran in the lane file.
- Fast, silent enforcement is the guard's job; the rest — lanes, tiers, gates, the secrets and git rules — is in AGENTS.md and the docs it links.
