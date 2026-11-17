import { defineConfig } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";
import base from "./playwright.config";
import { browserReleasePolicy } from "./tests/reviews/release-browser-policy";

// Isolate this policy and historical fixture data from the ordinary v1 browser suite.
// Worker processes inherit this already-created schema; no deployed database is accepted.
const source = new URL(
  process.env.DATABASE_URL ??
    "postgresql://whr:whr@127.0.0.1:5432/whr_release_browser",
);
if (!["127.0.0.1", "localhost"].includes(source.hostname))
  throw new Error("Release browser tests require a loopback database");
const schema =
  process.env.WHR_RELEASE_BROWSER_SCHEMA ??
  `whr_release_${randomBytes(8).toString("hex")}`;
if (!/^whr_release_[a-f0-9]{16}$/.test(schema))
  throw new Error("Invalid disposable release browser schema");
process.env.WHR_RELEASE_BROWSER_SCHEMA = schema;
source.searchParams.set("options", `-c search_path=${schema},public`);
process.env.DATABASE_URL = source.href;
const pool = new pg.Pool({ connectionString: source.href, max: 1 });
try {
  await pool.query("SELECT pg_advisory_lock(9171717)");
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  const exists = await pool.query("SELECT to_regclass($1) installed", [
    `${schema}.held_release_proposal`,
  ]);
  if (!exists.rows[0].installed) {
    const migrations = new URL("./prisma/migrations/", import.meta.url);
    const dirs = (await readdir(migrations, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const dir of dirs)
      await pool.query(
        await readFile(
          new URL(`${dir.name}/migration.sql`, migrations),
          "utf8",
        ),
      );
    await pool.query(
      await readFile(new URL("./prisma/fixtures.sql", import.meta.url), "utf8"),
    );
  }
} finally {
  await pool.query("SELECT pg_advisory_unlock(9171717)");
  await pool.end();
}
if (Array.isArray(base.webServer) || !base.webServer)
  throw new Error("Expected the ordinary single local server configuration");
export default defineConfig({
  ...base,
  testDir: "./tests/release-e2e",
  globalTeardown: "./tests/release-e2e/teardown.ts",
  workers: 1,
  retries: 0,
  projects: [{ name: "release-desktop", use: { browserName: "chromium" } }],
  webServer: {
    ...base.webServer,
    command: "pnpm build && pnpm start --hostname 127.0.0.1",
    env: {
      ...base.webServer.env,
      DATABASE_URL: source.href,
      STORAGE_ENDPOINT:
        process.env.WHR_TEST_STORAGE_ENDPOINT ?? "http://127.0.0.1:9000",
      WHR_RELEASE_BROWSER_SCHEMA: schema,
      WHR_REVIEW_EVIDENCE_POLICY: JSON.stringify(browserReleasePolicy),
    },
  },
});
