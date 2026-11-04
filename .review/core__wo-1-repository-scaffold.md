---
branch: core/wo-1-repository-scaffold
linear: WHR-1
tier: high
builder: platform-engineer
plan:
  goal: Empty fully wired Next.js scaffold with local and CI gates green on staging.
  files: Root tooling and lockfile, docker-compose.yml, .github/workflows/ci.yml, prisma/**, src/** placeholders, jobs/** placeholders, tests/**, docs/agentic/bootstrap/**, README.md, STATUS.md, docs/agentic/lanes/core.md.
  approach: Pin supported runtime and tools, scaffold empty architecture, wire real smoke suites and local services, preserve enforcement checks, remove obsolete bootstrap copies.
  tests: Typecheck, lint, unit, build, PostgreSQL integration, Playwright smoke, review self-test, guard self-test, evidence validation and GitHub CI.
  risks: CI enforcement paths and dependency compatibility; no business schema, cloud provisioning or feature implementation.
invariants: []
---

Plan committed before builder dispatch. Review results pending.
