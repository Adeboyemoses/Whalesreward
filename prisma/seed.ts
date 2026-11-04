import { readFile } from "node:fs/promises";
import pg from "pg";

if (!process.env.DATABASE_URL)
  throw new Error("DATABASE_URL is required for seed");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query("BEGIN");
  await db.query(
    await readFile(new URL("./fixtures.sql", import.meta.url), "utf8"),
  );
  await db.query("COMMIT");
  console.info(
    "Fictional station, pump, staff, customer and card fixtures seeded.",
  );
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally {
  await db.end();
}
