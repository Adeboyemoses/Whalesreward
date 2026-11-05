import { readFile } from "node:fs/promises";
import pg from "pg";
import {
  seedAttendantCredentials,
  seedAdminCredentials,
  configureAdminSeedEmail,
} from "./seed-auth.mjs";

if (process.env.WHR_ENV === "production")
  throw new Error("Fictional fixtures are unavailable in production");
if (!process.env.DATABASE_URL)
  throw new Error("DATABASE_URL is required for seed");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query("BEGIN");
  await configureAdminSeedEmail(db);
  await db.query(
    await readFile(new URL("./fixtures.sql", import.meta.url), "utf8"),
  );
  await seedAttendantCredentials(db);
  await seedAdminCredentials(db);
  await db.query("COMMIT");
  console.info(
    "Fictional station, pump, staff, customer and card fixtures seeded.",
  );
} catch {
  await db.query("ROLLBACK");
  // Database constraint details may include the configured private test inbox.
  throw new Error("Fictional fixture seed failed");
} finally {
  await db.end();
}
