# Whales Rewards

Loyalty programme for Whales Energy (Whales Empire): an attendant PWA for recording fuel and cooking-gas sales against loyalty cards, online or offline, and an admin portal for cards, reviews, reports and the spend-based giveaway leaderboards. Built by Cloudrock Technologies.

- **Agents start at [AGENTS.md](AGENTS.md).**
- People start at [docs/agentic/README.md](docs/agentic/README.md) (how the build runs) and [docs/agentic/setup.md](docs/agentic/setup.md) (one-time setup).
- What to build: `product-docs/` (symlink to the client's product folder; not in git).
- How it's built: [docs/engineering/](docs/engineering/).
- Where it stands: [STATUS.md](STATUS.md).

## Local development

Use Node `26.12.0` (`nvm install && nvm use`) and pnpm `10.17.1`.

```sh
pnpm install --frozen-lockfile
docker compose up -d --build
export DATABASE_URL=postgresql://whr:whr@127.0.0.1:5433/whr_dev
pnpm db:migrate:deploy
pnpm db:seed
pnpm dev
```

Open `http://localhost:3000`. This scaffold serves a generic shell; the attendant
and admin route directories remain empty until their own work orders.
The example environment names are in `.env.example`; provide values through your
shell or deployment settings. Never commit actual environment files.

Local services bind to loopback: PostgreSQL `5433`, Mailpit SMTP `1025` and inbox
`8025`, MinIO API `9000` and console `9001`. Credentials in Compose are fictional
development defaults. Volumes persist across restarts; `docker compose stop`
stops the services without deleting them. No cloud resources are needed.

MinIO's [official repository](https://github.com/minio/minio) now distributes
source only. Compose builds its official release source at commit
`07c3a429bfed433e49018cb0f78a52145d4bedeb` rather than relying on an unavailable
public image. The first build downloads Go dependencies and can take several
minutes. This local AGPL service is a separate development process; application
runtime dependencies Next.js, React and React DOM are MIT licensed.

## Verification

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm test:integration
pnpm test:time
pnpm exec playwright install chromium
pnpm test:e2e
bash scripts/review/test-review.sh
bash .codex/hooks/test-guard.sh
```

Integration requires `DATABASE_URL` and the applied migration. Browser tests start
their own production server on port `3000`; stop any development server first.
Unit and browser suites cover the generic shell; integration checks the real
PostgreSQL connection and applied empty migration baseline. There are no business
models or fixtures yet. The time suite explicitly permits no tests until the time
rules are implemented. Maintenance job commands explicitly report that they are
unimplemented and make no changes.

`pnpm db:migrate:dev` creates SQL for review without applying it. Review migrations
before running `pnpm db:migrate:deploy`. `pnpm format` applies Prettier; all tools
exclude worktrees and the read-only product folder.

Node 26 is [LTS](https://nodejs.org/en/about/previous-releases) and
[supported by App Platform](https://docs.digitalocean.com/products/app-platform/reference/buildpacks/nodejs/).
PostgreSQL 16 matches CI and is
[supported by DigitalOcean](https://docs.digitalocean.com/products/databases/postgresql/how-to/create/).
No managed cluster exists yet; the provisioning work order must preserve this
major-version match. Versions are pinned for reproducibility; upgrades receive
their own review.
