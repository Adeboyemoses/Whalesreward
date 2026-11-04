# Provision and operate staging

WO-core-15 (WHR-28), prepared 4 November 2026. Earl performs every DigitalOcean action below in his own console or terminal. Codex prepares configuration and local verification only; it never runs `doctl`. This uses Cloudrock's temporary account, separate from future client production. Use fictional data only. The generated HTTPS URL is publicly reachable: obscurity and `noindex` do not provide access control.

## 1. Check the proposed resources and price

Read the merged `staging` branch before provisioning. It defines one `apps-s-1vcpu-1gb` web instance, two deployment jobs and one PostgreSQL 16 development database. The Dockerfile pins Node 26.12.0 and pnpm 10.17.1 to the repository values; all components use that same Dockerfile and source branch. GitHub Actions remains unchanged. DigitalOcean builds and deploys on each push to `staging`.

App Platform's Frankfurt region slug is `fra`; its datacenter and the Spaces region are `fra1`. This is the valid spec equivalent of the work order's `fra1` wording. See the [App Platform region mapping](https://docs.digitalocean.com/products/app-platform/how-to/enable-vpc/).

Published prices checked 4 November 2026: web $12/month + development database $7/month + Spaces Standard subscription $5/month = **$24/month baseline**, plus deployment-job usage, any overages and taxes. Spaces is an account-level subscription shared across buckets, so an existing subscription may already cover the base fee. Earl must check the console estimate and current [App Platform pricing](https://docs.digitalocean.com/products/app-platform/details/pricing/) and [Spaces pricing](https://docs.digitalocean.com/products/spaces/details/pricing/) before creating resources. This is an estimate, not a fixed bill.

Development databases have limited capacity and no production backup/availability guarantees. Backups and monitoring belong to WO-core-16. Do not store live customer information here.

## 2. Connect GitHub

1. Sign in to Cloudrock's existing DigitalOcean account. Confirm the account/project and billing owner.
2. Open **Apps → Create App → GitHub**. Authorize DigitalOcean's GitHub integration for `Adeboyemoses/Whalesreward` only. Select branch `staging` to verify access, then leave the wizard without creating a duplicate app.
3. In Earl's terminal, use an installed, authenticated `doctl`. Keep its token and every secret in Bitwarden. Never paste credentials into chat, Linear, GitHub, terminal recordings or a committed file.
4. Use a clean checkout of the merged `staging` branch for the following commands. Confirm `.do/app.staging.yaml` names `whr-staging`, PostgreSQL 16 and Frankfurt, and that deployment-on-push is enabled for web and both jobs.

## 3. Create the private Spaces bucket and restricted key

1. Open **Spaces Object Storage → Create bucket**, choose Frankfurt (`fra1`) and name it `whr-staging-evidence`. Leave the CDN disabled and file listing restricted. Keep object permissions private; add no public-read policy. If the name is unavailable, choose a unique staging-only name and change `STORAGE_BUCKET` in the app console after creation.
2. Create a Spaces access key restricted to this one bucket with read/write access. Do not use a full-account Spaces key or a DigitalOcean API token as the application key. Store the access-key ID and secret in Bitwarden.
3. Leave CORS unset until the exact app URL exists in step 4. After creation, set a CORS rule on this bucket with that **exact HTTPS origin**, allowed methods `PUT`, `GET`, `HEAD`, allowed request header `Content-Type` and exposed response header `ETag`. Do not use `*` for origins. CORS does not make objects public.
4. Confirm an unsigned request to a known private object is denied. Do not upload real meter photos to test this. See [Spaces CORS](https://docs.digitalocean.com/products/spaces/how-to/configure-cors/) and [Spaces access keys](https://docs.digitalocean.com/products/spaces/how-to/manage-access/).

## 4. Validate and create the app — Earl only

Run:

```sh
doctl apps spec validate .do/app.staging.yaml
doctl apps create --spec .do/app.staging.yaml
```

Save the validation result and app ID without secrets. If validation fails, stop and return the redacted error to the EM; do not remove TLS validation or change the database plan to work around it. The configuration follows the [App Spec reference](https://docs.digitalocean.com/products/app-platform/reference/app-spec/).

The three manually supplied secrets are intentionally empty in the committed spec. In **Apps → whr-staging → Settings → App-level environment variables**, enter the following and select **Encrypt** and runtime scope for each:

| Variable                    | Value Earl supplies                                                |
| --------------------------- | ------------------------------------------------------------------ |
| `BETTER_AUTH_SECRET`        | A new random staging-only secret generated and stored in Bitwarden |
| `STORAGE_ACCESS_KEY_ID`     | The restricted staging bucket key ID                               |
| `STORAGE_SECRET_ACCESS_KEY` | That key's secret                                                  |

Keep `DATABASE_URL=${db.DATABASE_URL}` and `DATABASE_CA_CERT=${db.CA_CERT}` bound to the database component; never replace them with checked-in credentials. Keep `BETTER_AUTH_URL=${APP_URL}`. Bindable variables are resolved at runtime; no cloud database or application secret is needed to build the Docker image. See [environment variables and bindings](https://docs.digitalocean.com/products/app-platform/how-to/use-environment-variables/).

The image entrypoint writes the bound database CA to an ephemeral file with owner-only permissions and changes the bound URL to `sslmode=verify-full`. Web, migration and seed processes all verify the database hostname and certificate. Do not set `NODE_TLS_REJECT_UNAUTHORIZED=0` or disable certificate verification. Missing or invalid staging DB settings fail startup with a generic message.

Save the console settings to trigger deployment. A first deployment may start before manual secrets are entered; do not use the app until the settings and successful deployment are confirmed. Record the generated HTTPS app URL and complete the exact-origin CORS rule from step 3. Do not export the populated live app spec into the repository: it contains encrypted secret material.

## 5. Verify the first deployment

1. Open **Activity** and find the deployment built from the current `staging` commit. Check build logs for pinned tooling and a successful Next.js build.
2. Check the `migrate` PRE_DEPLOY job exits successfully before the web component becomes active. It runs `pnpm db:migrate:deploy`; it must not reset or reseed the database on failure.
3. Check the web health check becomes healthy and the `seed` POST_DEPLOY job exits successfully. It runs `pnpm db:seed`, inserts fictional fixtures idempotently and provisions no usable login password. Do not treat this foundation deployment as a completed sign-in or sales flow.
4. Open `https://<app-host>/api/health`. Expect HTTP 200, `Cache-Control: no-store` and JSON like `{"ok":true,"version":"<source-commit>","db":"ok"}`. The `version` must match the source commit displayed by the deployment. A database failure returns HTTP 503 with `db: "unavailable"`, without connection details.
5. Open `/` and `/dev/gallery` on a phone. Expect a visible **Staging · fictional data** banner and the existing component gallery. Follow the [phone smoke steps](../qa/smoke-2026-11-04-staging.md). Production stays without the banner and returns 404 for the gallery, even if only the gallery flag is accidentally set.
6. Inspect headers on `/`, `/api/health`, `/dev/gallery`, a static asset and a missing route. Every application response should include `X-Robots-Tag: noindex`. DigitalOcean-generated error pages are controlled by the platform. Email uses a no-op adapter: no message is sent or logged until WO-core-5 configures a provider.
7. After the next approved PR merges into `staging`, check that DigitalOcean starts a new deployment automatically, both jobs succeed, the active deployment has that new commit and the same HTTPS checks pass. No GitHub Actions deployment workflow is needed.
8. Send the EM only the URL, commit, validation success and redacted job/health results. Provider validation, HTTPS behavior and automatic redeploy are pending until Earl performs these steps.

## 6. Read logs and recover a failed deployment

Use **Apps → whr-staging → Activity → deployment → Build/Deploy logs** for build and job errors, and the web component's **Runtime Logs** for application errors. Inspect locally; redact usernames, connection strings, tokens, signed URLs and message content before sharing. A green web process with a failed seed job is not a verified deployment.

If PRE_DEPLOY migration fails, preserve the last healthy deployment and the database. Ask the EM for a forward fix; never run reset, drop tables or erase the migration ledger. If health fails, check database status, bindings and the CA certificate binding in the console, then redeploy after correcting configuration.

For a broken application deployment, choose the last known-good compatible deployment under **Activity → Rollback**, review the target commit and confirm rollback in the console. Verify health and gallery again. Application rollback does **not** undo schema changes or seed data, and deployment jobs may run again; use a forward fix when the old app is incompatible with the current schema. Coordinate a reviewed revert on `staging` with the EM so the next automatic deployment does not reintroduce the fault. See [manage deployments](https://docs.digitalocean.com/products/app-platform/how-to/manage-deployments/).

## 7. Tear down temporary staging — Earl only

1. Confirm the selected app, dev database, bucket and key belong only to this temporary staging environment and contain fictional data. Preserve any needed redacted acceptance notes first.
2. Delete **whr-staging** in the Apps console and confirm its attached development database is deleted. Inspect the Databases list and remove only an orphaned staging resource if it remains; do not touch unrelated databases.
3. Revoke the bucket-scoped staging Spaces key. Empty and delete only the staging bucket, including any object versions if enabled. Do not delete other Cloudrock buckets or cancel a shared Spaces subscription used by other projects.
4. Confirm the app and staging database no longer appear, the staging key is revoked and the staging bucket is gone. Check billing for remaining resources. Spaces base billing ends only when the account has no remaining buckets; an app deletion alone does not delete Spaces.
5. Remove unused staging secrets from Bitwarden according to Earl's retention practice. Do not paste them anywhere during cleanup. Record that staging was destroyed so nobody expects the old URL to work.

Production provisioning, a client account, custom domains, live data migration, backup automation and monitoring are outside this work order.
