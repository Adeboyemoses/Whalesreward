---
branch: core/WHR-232-claude-port
linear: WHR-232
tier: high
reviewed_head: e54fb1f1395c665e27494cba1b0ced35dd5ccf54
rounds: 2
builder: em
reviewers:
  code-reviewer: PASS (round 2)
  security-reviewer: PASS (round 2)
  integrity-reviewer: PASS (round 1; round-2 change is integrity-neutral)
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 5
plan:
  goal: port the operating model from Codex to Claude Code (Antigravity) without weakening any gate
  files: CLAUDE.md, AGENTS.md, .mcp.json, .claude/**, .codex/hooks/**, scripts/review/**, docs/agentic/**
  approach: CLAUDE.md imports a tool-neutral AGENTS.md; eight agents ported to .claude/agents with reviewers read-only on opus; the PreToolUse guard is extended to the file tools; Linear via .mcp.json OAuth; Claude files routed high tier
  tests: guard self-test covers Claude event shapes for Bash/Read/Edit/Write/Grep/Glob including secret, product-docs, git-meta and force-staging blocks; review self-test asserts the Claude files are high tier
  risks: a hook that fails open silently drops enforcement; reviewer tool allowlists must exclude Edit/Write; no secret or product-docs path may be writable or publishable
invariants: []
p1: ["fixed: ported the three reviewer agents to .claude/agents with no Edit/Write (round 2)"]
tickets: []
---
Ports the operating model from Codex to Claude Code (in Antigravity); the Codex
wiring (`.codex/**`) is left working so both surfaces run the same model.
CLAUDE.md imports a now-tool-neutral AGENTS.md. Eight agents live in
`.claude/agents/*.md`: five builders inherit the session model with
Read/Grep/Glob/Edit/Write/Bash; the three reviewers run on opus with only
Read/Grep/Glob/Bash — no edit or write tools (maker/checker split). Skills are a
single source (`.claude/skills` symlinks `.agents/skills`). Linear is wired
through `.mcp.json` (Streamable HTTP, OAuth; no token in the repo).

The guard (`.codex/hooks/guard.sh`) is reused by both surfaces and extended to
Claude's file tools: Read/Edit/Write/Grep/Glob/NotebookEdit events are parsed
for their path with jq (python3 fallback; block if neither), so `.env*`,
credential stores, `.git` metadata and `product-docs/` writes are blocked by
path. Checks are case-insensitive for the macOS filesystem. `git add`
force-staging is blocked across short-option groups, long-option abbreviations
and `--pathspec-*`. `.claude/settings.json` denies cloud and repo admin,
auto-allows a small read-ish git/gh/pnpm/docker set (no fetch, push,
`git remote show`, or mutating `gh run`), sets TZ=UTC and empty attribution, and
wires the PreToolUse hook via `${CLAUDE_PROJECT_DIR}`. CLAUDE.md, `.claude/**`
and `.mcp.json` are routed high tier (routing.conf) and asserted by
test-review.sh; review.md records the fresh-session reviewer rule.

Round 1 (7f18297): integrity PASS; code FAIL on a P0 and security SEC-MED on the
same gap — only the five builders had been ported, so dispatching a reviewer in
Claude Code would fall back to a write-capable general agent. Round 2 (e54fb1f)
added the three reviewer `.md` files (read-only, opus) and narrowed `gh run` to
list/view/watch (security SEC-LOW); code and security re-reviewed PASS. Integrity's
round-1 PASS stands — the round-2 change touches no money/quantity/sync/time/
ranking code.

Accepted residuals (defence-in-depth): a shell-quoted `git add` force flag
defeats the hygiene regex (the `.env`-path rule still blocks the secret case);
the guard matcher covers Bash and the file tools, not MCP write tools (`.mcp.json`
declares only Linear, not a repo-writing MCP). The sandbox, branch protection and
these reviews are the real controls.

EM verification on e54fb1f: typecheck, lint (0 errors, 4 pre-existing img
warnings), 1046 unit tests across 114 files, build, guard self-test 233/0 and
review self-test 57/0 all PASS. Integration and e2e are not triggered (no prisma,
server or user-flow change). No STATUS, coverage-map or lane-file edits.
