import { test as base, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import pg from "pg";
import { origin, setReportsOrigin } from "./helpers";

const require = createRequire(import.meta.url);
type ReportsStack = { origin: string; schema: string };

function localTestDatabase(raw: string | undefined) {
  if (!raw) throw new Error("Reports browser tests require DATABASE_URL");
  const url = new URL(raw);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]", "host.docker.internal"].includes(
      url.hostname,
    ) ||
    !/(?:test|e2e|whr25)/i.test(url.pathname) ||
    ["staging", "production"].includes(process.env.WHR_ENV ?? "")
  )
    throw new Error(
      "Reports browser tests require an explicitly local test database",
    );
  return url;
}

async function stop(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) =>
    child.once("close", () => resolve()),
  );
  child.kill("SIGTERM");
  const deadline = setTimeout(() => child.kill("SIGKILL"), 10000);
  try {
    await exited;
  } finally {
    clearTimeout(deadline);
  }
}

/** A real compiled Next server and migrated schema per Playwright worker.
 * Only report tests opt in; unrelated browser suites keep their ordinary stack.
 */
export const test = base.extend<object, { reportsStack: ReportsStack }>({
  reportsStack: [
    async ({}, provide, workerInfo) => {
      const originalUrl = process.env.DATABASE_URL;
      const originalSchema = process.env.WHR_REPORTS_TEST_SCHEMA;
      const originalOrigin = origin;
      const url = localTestDatabase(originalUrl);
      const root = new pg.Pool({ connectionString: url.toString() });
      const schema = `reports_browser_${randomBytes(12).toString("hex")}`;
      const workerOrigin = `http://127.0.0.1:${3100 + workerInfo.workerIndex}`;
      let schemaCreated = false;
      let db: pg.Pool | undefined;
      let child: ChildProcess | undefined;
      try {
        await root.query(`CREATE SCHEMA ${schema}`);
        schemaCreated = true;
        url.searchParams.set("options", `-c search_path=${schema},public`);
        url.searchParams.set("application_name", schema);
        db = new pg.Pool({ connectionString: url.toString() });
        const migrations = new URL("../../prisma/migrations/", import.meta.url);
        for (const directory of (
          await readdir(migrations, { withFileTypes: true })
        )
          .filter((d) => d.isDirectory())
          .sort((a, b) => a.name.localeCompare(b.name))) {
          await db.query(
            await readFile(
              new URL(`${directory.name}/migration.sql`, migrations),
              "utf8",
            ),
          );
        }
        await db.query(
          await readFile(
            new URL("../../prisma/fixtures.sql", import.meta.url),
            "utf8",
          ),
        );
        expect(
          (await db.query("SELECT current_schema() schema")).rows[0].schema,
        ).toBe(schema);
        process.env.DATABASE_URL = url.toString();
        process.env.WHR_REPORTS_TEST_SCHEMA = schema;
        setReportsOrigin(workerOrigin);
        child = spawn(
          process.execPath,
          [
            require.resolve("next/dist/bin/next"),
            "start",
            "--hostname",
            "127.0.0.1",
            "--port",
            String(3100 + workerInfo.workerIndex),
          ],
          {
            env: {
              ...process.env,
              NODE_ENV: "production",
              TZ: "UTC",
              NEXT_TELEMETRY_DISABLED: "1",
              WHR_ENV: "local",
              EMAIL_PROVIDER: "noop",
              WHR_TRUSTED_IP_HEADER: "x-test-ip",
              DATABASE_URL: url.toString(),
              BETTER_AUTH_URL: workerOrigin,
              BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
              STORAGE_ENDPOINT: "http://127.0.0.1:9000",
              STORAGE_REGION: "us-east-1",
              STORAGE_BUCKET: "whr-e2e-cards",
              STORAGE_ACCESS_KEY_ID: "whr-local",
              STORAGE_SECRET_ACCESS_KEY: "local-development-only",
            },
            stdio: ["ignore", "ignore", "ignore"],
          },
        );
        let startupFailed = false;
        child.once("error", () => {
          startupFailed = true;
        });
        await expect
          .poll(
            async () => {
              if (
                startupFailed ||
                child!.exitCode !== null ||
                child!.signalCode !== null
              )
                return false;
              try {
                return (
                  (
                    await fetch(`${workerOrigin}/admin/sign-in`, {
                      signal: AbortSignal.timeout(1000),
                    })
                  ).status === 200
                );
              } catch {
                return false;
              }
            },
            {
              timeout: 30000,
              message:
                "The isolated reports production server must become ready",
            },
          )
          .toBe(true);
        await provide({ origin: workerOrigin, schema });
      } finally {
        // Terminate only the process this worker owns before dropping its schema.
        try {
          await stop(child);
        } finally {
          try {
            await db?.end();
          } finally {
            try {
              if (schemaCreated)
                await root.query(`DROP SCHEMA ${schema} CASCADE`);
            } finally {
              try {
                await root.end();
              } finally {
                if (originalUrl === undefined) delete process.env.DATABASE_URL;
                else process.env.DATABASE_URL = originalUrl;
                if (originalSchema === undefined)
                  delete process.env.WHR_REPORTS_TEST_SCHEMA;
                else process.env.WHR_REPORTS_TEST_SCHEMA = originalSchema;
                setReportsOrigin(originalOrigin);
              }
            }
          }
        }
      }
    },
    { scope: "worker", timeout: 90000 },
  ],
  baseURL: async ({ reportsStack }, provide) => {
    await provide(reportsStack.origin);
  },
});
export { expect };
