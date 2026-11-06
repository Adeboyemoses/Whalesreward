import pg from "pg";
import { readFile, readdir } from "node:fs/promises";
export default async function setup() {
  const root = new pg.Client({
    connectionString: "postgresql://whr:whr@127.0.0.1:5433/whr_dev",
  });
  await root.connect();
  if (
    !(
      await root.query(
        "SELECT 1 FROM pg_database WHERE datname='whr_admin_browser'",
      )
    ).rowCount
  )
    await root.query("CREATE DATABASE whr_admin_browser");
  await root.end();
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await db.query(
    "CREATE TABLE IF NOT EXISTS browser_migration(name TEXT PRIMARY KEY)",
  );
  for (const name of (
    await readdir(new URL("../../prisma/migrations/", import.meta.url))
  ).sort()) {
    if (
      !/^\d/.test(name) ||
      (await db.query("SELECT 1 FROM browser_migration WHERE name=$1", [name]))
        .rowCount
    )
      continue;
    await db.query(
      await readFile(
        new URL(
          `../../prisma/migrations/${name}/migration.sql`,
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.query("INSERT INTO browser_migration(name) VALUES($1)", [name]);
  }
  await db.query(
    await readFile(
      new URL("../../prisma/fixtures.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.end();
}
