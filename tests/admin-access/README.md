# Local admin access browser verification

The dedicated suite uses fictional data in an isolated PostgreSQL database and Mailpit. Run `pnpm exec playwright test --config tests/admin-access/admin-access.config.ts`. Setup creates `whr_admin_browser` on local port 5433, applies missing migrations and insert-only fixtures. The application uses port 3104. Override `WHR_ADMIN_TEST_DATABASE_URL`, `WHR_ADMIN_TEST_ROOT_DATABASE_URL`, `MAILPIT_URL` for a Linux runner.

Native host Chromium cannot launch in this sandbox. The cached Linux image `whr-upload-browser:lean` provides Node 26.12.0 and Chromium. Create an isolated container named `whr-admin-browser`, sync the final committed head using `git archive HEAD | docker exec -i whr-admin-browser tar -xf - -C /app`, install frozen dependencies in `/app`, attach `repository-scaffold_default` using `docker network connect repository-scaffold_default whr-admin-browser`, then run:

```sh
docker exec \
  -e WHR_ADMIN_TEST_DATABASE_URL=postgresql://whr:whr@host.docker.internal:5433/whr_admin_browser \
  -e WHR_ADMIN_TEST_ROOT_DATABASE_URL=postgresql://whr:whr@host.docker.internal:5433/whr_dev \
  -e MAILPIT_URL=http://mailpit:8025 \
  whr-admin-browser sh -c 'cd /app && pnpm exec playwright test --config tests/admin-access/admin-access.config.ts'
```

These are public local Compose fixture credentials. Never copy private runtime files or use deployed-service configuration. Passwords are random per run, browser traces/video/failure screenshots are off, explicit board captures never include populated password fields, and email captures redact live tokens before rendering. Copy only parity screenshots from `/app/tests/design-parity/admin-access/screenshots/` after the run. The ordinary `pnpm test:e2e` suite independently exercises live admin restrictions, role confirmation/dependencies and session revocation with no-op mail.
