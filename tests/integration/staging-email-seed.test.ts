import { readFile, readdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { configureAdminSeedEmail } from "../../prisma/seed-auth.mjs";
const root = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const schema = `email_seed_${randomBytes(8).toString("hex")}`;
let db: pg.Client;
let fixtures: string;
const email = "staging-admin@example.com";
describe("staging admin email seed", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    await root.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.DATABASE_URL);
    url.searchParams.set("options", `-c search_path=${schema},public`);
    db = new pg.Client({ connectionString: url.toString() });
    await db.connect();
    const directory = new URL("../../prisma/migrations/", import.meta.url);
    for (const name of (await readdir(directory)).sort()) {
      if (name === "migration_lock.toml") continue;
      await db.query(
        await readFile(new URL(`${name}/migration.sql`, directory), "utf8"),
      );
    }
    fixtures = await readFile(
      new URL("../../prisma/fixtures.sql", import.meta.url),
      "utf8",
    );
  });
  afterAll(async () => {
    await db?.end();
    await root.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await root.end();
  });
  it("I-12 sets the staging inbox only on initial insert and never verifies it", async () => {
    await db.query("BEGIN");
    await configureAdminSeedEmail(db, {
      WHR_ENV: "staging",
      WHR_SEED_ADMIN_EMAIL: email,
    });
    await db.query(fixtures);
    await db.query("COMMIT");
    expect(
      (
        await db.query(
          "SELECT email_normalized,email_verified_at FROM admin WHERE admin_code='ADMIN001'",
        )
      ).rows[0],
    ).toEqual({ email_normalized: email, email_verified_at: null });
  });
  it("I-12 reruns preserve existing email, verification and version", async () => {
    await db.query(
      "UPDATE admin SET email_verified_at='2026-11-05T10:00:00Z',version=2 WHERE admin_code='ADMIN001'",
    );
    const before = (
      await db.query(
        "SELECT email_normalized,email_verified_at,version FROM admin WHERE admin_code='ADMIN001'",
      )
    ).rows[0];
    await db.query("BEGIN");
    await configureAdminSeedEmail(db, {
      WHR_ENV: "staging",
      WHR_SEED_ADMIN_EMAIL: "different@example.com",
    });
    await db.query(fixtures);
    await db.query("COMMIT");
    expect(
      (
        await db.query(
          "SELECT email_normalized,email_verified_at,version FROM admin WHERE admin_code='ADMIN001'",
        )
      ).rows[0],
    ).toEqual(before);
  });
  it("refuses non-staging or malformed email without echoing values", async () => {
    for (const env of [
      { WHR_ENV: "production", WHR_SEED_ADMIN_EMAIL: email },
      { WHR_SEED_ADMIN_EMAIL: email },
      { WHR_ENV: "staging", WHR_SEED_ADMIN_EMAIL: "invalid private inbox" },
    ])
      await expect(configureAdminSeedEmail(db, env)).rejects.toThrow(
        "Staging admin email configuration is invalid",
      );
  });
  it("rejects a duplicate inbox instead of silently creating an unusable admin", async () => {
    const collision = fixtures
      .replaceAll(
        "019a5000-0000-7000-8000-000000000002",
        "019a5000-0000-7000-8000-000000009002",
      )
      .replaceAll(
        "019a5000-0000-7000-8000-000000000005",
        "019a5000-0000-7000-8000-000000009005",
      )
      .replaceAll("ada.williams", "ada.seed.test")
      .replaceAll("ADMIN001", "ADMIN002");
    await db.query("BEGIN");
    try {
      await configureAdminSeedEmail(db, {
        WHR_ENV: "staging",
        WHR_SEED_ADMIN_EMAIL: email,
      });
      await expect(db.query(collision)).rejects.toMatchObject({
        code: "23505",
      });
    } finally {
      await db.query("ROLLBACK");
    }
    expect(
      (await db.query("SELECT count(*) FROM admin WHERE admin_code='ADMIN002'"))
        .rows[0].count,
    ).toBe("0");
  });
});
