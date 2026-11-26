---
branch: core/WHR-232-claude-port
linear: WHR-232
tier: high
reviewed_head: 3d13df5dab4c3119e7afcea710c477d671f7b3a1
rounds: 1
builder: em
reviewers:
  code-reviewer: PENDING
  security-reviewer: PENDING
  integrity-reviewer: PENDING
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 3
plan:
  goal: port the operating model from Codex to Claude Code (Antigravity) without weakening any gate
  files: CLAUDE.md, AGENTS.md, .mcp.json, .claude/**, .codex/hooks/**, scripts/review/**, docs/agentic/**
  approach: CLAUDE.md imports a tool-neutral AGENTS.md; eight agents ported to .claude/agents with reviewers read-only on opus; the PreToolUse guard is extended to the file tools; Linear via .mcp.json OAuth; Claude files routed high tier
  tests: guard self-test covers Claude event shapes for Bash/Read/Edit/Write/Grep/Glob including secret, product-docs, git-meta and force-staging blocks; review self-test asserts the Claude files are high tier
  risks: a hook that fails open silently drops enforcement; reviewer tool allowlists must exclude Edit/Write; no secret or product-docs path may be writable or publishable
invariants: []
p1: []
tickets: []
---

Ports the operating model from Codex to Claude Code (in Antigravity); the Codex
wiring (`.codex/**`) is left working so both surfaces run the same model.
CLAUDE.md imports AGENTS.md, which is now tool-neutral. Eight agents are ported
to `.claude/agents/*.md`: builders inherit the session model and get
Read/Grep/Glob/Edit/Write/Bash; the three reviewers run on opus with only
Read/Grep/Glob/Bash — no edit or write tools (maker/checker split preserved).
Skills are a single source (`.claude/skills` symlinks `.agents/skills`). Linear
is wired through `.mcp.json` (Streamable HTTP, OAuth; no token in the repo).

The guard (`.codex/hooks/guard.sh`) is reused by both surfaces and extended to
Claude's file tools: Read/Edit/Write/Grep/Glob/NotebookEdit events are parsed
for their path with jq (python3 fallback; block if neither), so `.env*`,
credential stores, `.git` metadata and `product-docs/` writes are blocked by
path, not by content. Path checks are case-insensitive for the macOS filesystem.
`git add` force-staging is blocked across short-option groups, long-option
abbreviations and `--pathspec-*`. `.claude/settings.json` denies cloud and repo
admin, auto-allows a small read-ish git/gh/pnpm/docker set (no fetch, push,
`git remote show`), sets TZ=UTC and empty commit/PR attribution, and wires the
PreToolUse hook via `${CLAUDE_PROJECT_DIR}`.

CLAUDE.md, `.claude/**` and `.mcp.json` are routed high tier in routing.conf and
asserted by test-review.sh; review.md records the fresh-session reviewer rule and
the three-reviewer cap. work-orders.md names the per-lane Claude session model.
setup.md keeps the Codex setup and adds the Antigravity open steps and a
5-minute self-check.

Accepted residual (defence-in-depth): shell quoting or a backslash around a
`git add` force flag defeats the hygiene regex, but the separate `.env`-path
rule still blocks the secret case through any quoting; the sandbox, branch
protection and these reviews are the real controls. No app, prisma, money or
quantity code changed; no STATUS, coverage-map or lane-file edits.

EM verification and reviewer verdicts are recorded on the reviewed head below.
