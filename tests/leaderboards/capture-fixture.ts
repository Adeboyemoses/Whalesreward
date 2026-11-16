/** Manual fidelity fallback when this host cannot launch Playwright Chromium.
 * Bundle with esbuild into tests/leaderboards/.capture-fixture.mjs, then run.
 * Only creates a disposable local schema; never uses deployed data.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { createServer } from "node:http";
import { request } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import pg from "pg";
import { v7 } from "uuid";
import { fixture } from "../admin-access/admin-access.fixtures";
import { localTestDatabase } from "../reports/local-database";
import { leaderboardRecords } from "./helpers";
import { seedId } from "../station/helpers";

const require = createRequire(import.meta.url);
const url = localTestDatabase(process.env.DATABASE_URL);
const root = new pg.Pool({ connectionString: url.toString() });
const schema = `leaderboard_capture_${randomBytes(8).toString("hex")}`;
await root.query(`CREATE SCHEMA ${schema}`);
url.searchParams.set("options", `-c search_path=${schema},public`);
url.searchParams.set("application_name", schema);
process.env.DATABASE_URL = url.toString();
process.env.WHR_LEADERBOARD_TEST_SCHEMA = schema;
const db = new pg.Pool({ connectionString: url.toString() });
const migrations = new URL("../../prisma/migrations/", import.meta.url);
for (const directory of (await readdir(migrations, { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .sort((a, b) => a.name.localeCompare(b.name)))
  await db.query(
    await readFile(
      new URL(`${directory.name}/migration.sql`, migrations),
      "utf8",
    ),
  );
await db.query(
  await readFile(new URL("../../prisma/fixtures.sql", import.meta.url), "utf8"),
);
const identity = await fixture();
// Deliberately public, fictional, short-lived local capture credentials.
const username = "whr23.capture",
  password = "FictionalCaptureOnly2026!";
await identity.db.query(
  "UPDATE auth_user SET username=$2,username_normalized=$2,must_change_password=false WHERE id=$1",
  [identity.userId, username],
);
await identity.db.query(
  "UPDATE auth_credential SET password_hash=$2 WHERE user_id=$1",
  [identity.userId, await hashPassword(password)],
);
const origin = "http://127.0.0.1:3560";
const child = spawn(
  process.execPath,
  [
    require.resolve("next/dist/bin/next"),
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3560",
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
      BETTER_AUTH_URL: origin,
      BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    },
    stdio: ["ignore", "ignore", "inherit"],
  },
);
for (let n = 0; n < 100; n++) {
  try {
    if ((await fetch(`${origin}/admin/sign-in`)).status === 200) break;
  } catch {
    /* startup */
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
}
const client = await request.newContext({
  baseURL: origin,
  extraHTTPHeaders: { "x-test-ip": "2001:db8::23" },
});
const login = await client.post("/api/admin/sign-in", {
  headers: { Origin: origin, "Idempotency-Key": v7() },
  data: { username, password },
});
if (login.status() !== 200)
  throw new Error(`Fictional capture sign-in failed ${login.status()}`);
const f = await leaderboardRecords(
  { request: client, url: () => origin },
  identity,
);
const sale = await f.sale({ amount: "1370001" });
await f.sale({
  customerId: seedId(27),
  product: "cooking_gas",
  amount: "1370001",
});
await f.configure();
console.log(`Fictional capture ready: ${origin}/admin/leaderboards`);
console.log(
  `Local fixture username: ${username}; fixed fictional password: ${password}`,
);
console.log(
  "Commands: check (initial phone evidence), revision (accepted source + fresh evidence), stop (cleanup)",
);
// Explicit test-only loopback controls for the native visual checker. This is
// never imported by the app, and has no route to a deployed database.
const control = createServer(async (req, res) => {
  if (
    req.method !== "POST" ||
    !["/check", "/revision"].includes(req.url ?? "")
  ) {
    res.writeHead(404).end();
    return;
  }
  try {
    if (req.url === "/check") await f.phoneCheck();
    else {
      await f.changeAmount(sale.id, "1470001");
      await f.renameCustomer(seedId(26), "Fictional changed customer");
      await f.phoneCheck("revision");
    }
    res
      .writeHead(200, { "Content-Type": "text/plain" })
      .end("Fictional evidence ready; refresh and review through the UI.\n");
  } catch (error) {
    res
      .writeHead(500)
      .end(
        error instanceof Error ? error.message : "Fixture transition failed",
      );
  }
});
await new Promise<void>((resolve) =>
  control.listen(3561, "127.0.0.1", resolve),
);
const lines = createInterface({ input: process.stdin });
let cleaned = false;
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  control.close();
  child.kill("SIGTERM");
  await client.dispose();
  await f.close();
  await db.end();
  await root.query(`DROP SCHEMA ${schema} CASCADE`);
  await root.end();
}
for await (const line of lines) {
  try {
    if (line.trim() === "check") {
      await f.phoneCheck();
      console.log(
        "Initial phone evidence ready. Refresh readiness and prepare through the UI.",
      );
    }
    if (line.trim() === "revision") {
      await f.changeAmount(sale.id, "1470001");
      await f.renameCustomer(seedId(26), "Fictional changed customer");
      await f.phoneCheck("revision");
      console.log(
        "Accepted source revision and phone evidence ready. Prepare revision through the UI.",
      );
    }
    if (line.trim() === "stop") break;
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Fixture command failed",
    );
  }
}
lines.close();
await cleanup();
