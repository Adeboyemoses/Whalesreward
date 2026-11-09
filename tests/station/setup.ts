import pg from "pg";
import { readFile, readdir } from "node:fs/promises";

export default async function setup() {
  const target = new URL(process.env.DATABASE_URL!);
  const name = target.pathname.slice(1);
  if (!/^whr_app5_parity_[a-z0-9_]+$/.test(name))
    throw new Error("Use an isolated local station parity database");
  const rootURL = new URL(target);
  rootURL.pathname = "/whr_dev";
  const root = new pg.Client({ connectionString: rootURL.toString() });
  await root.connect();
  if (
    !(await root.query("SELECT 1 FROM pg_database WHERE datname=$1", [name]))
      .rowCount
  )
    await root.query(`CREATE DATABASE "${name}"`);
  await root.end();
  const db = new pg.Client({ connectionString: target.toString() });
  await db.connect();
  try {
    await db.query(
      "CREATE TABLE IF NOT EXISTS browser_migration(name TEXT PRIMARY KEY)",
    );
    for (const name of (
      await readdir(new URL("../../prisma/migrations/", import.meta.url))
    ).sort()) {
      if (
        !/^\d/.test(name) ||
        (
          await db.query("SELECT 1 FROM browser_migration WHERE name=$1", [
            name,
          ])
        ).rowCount
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
    // Fictional board rates in a fresh parity-only DB; never modify historical rows.
    const fixture = (
      await readFile(
        new URL("../../prisma/fixtures.sql", import.meta.url),
        "utf8",
      )
    )
      .split("\n")
      .map((line) => {
        if (!line.startsWith("INSERT INTO product_price_version")) return line;
        if (line.includes("000000000020'"))
          return line.replace("100000,'NGN',2", "100000,'NGN',3");
        if (line.includes("000000000021'"))
          return line.replace("100000,'NGN',2", "120000,'NGN',3");
        if (line.includes("000000000022'"))
          return line.replace("100000,'NGN',2", "90000,'NGN',3");
        return line;
      })
      .join("\n");
    await db.query(fixture);
    await db.query(
      "UPDATE pump SET name=CASE code WHEN 'PUMP01' THEN 'Pump 01' WHEN 'PUMP02' THEN 'Pump 02' WHEN 'PUMP03' THEN 'Pump 03' WHEN 'PUMP04' THEN 'Pump 04' WHEN 'PUMP05' THEN 'Pump 05' ELSE name END",
    );
  } finally {
    await db.end();
  }
}
