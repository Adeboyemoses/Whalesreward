import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
import { afterEach, beforeEach, expect, it } from "vitest";
import { newId } from "../../src/server/lib/ids";
import { recordedReconciliationPolicy } from "../../src/server/modules/giveaway/policy";

const migrationName = "20261124030000_reconciliation_station_binding";
const migrations = new URL("../../prisma/migrations/", import.meta.url);
const migration = () =>
  readFile(new URL(`${migrationName}/migration.sql`, migrations), "utf8");
let root: pg.Pool, pool: pg.Pool, schema: string;
beforeEach(async () => {
  root = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  schema = `reconciliation_binding_${randomBytes(8).toString("hex")}`;
  await root.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set("options", `-c search_path=${schema},public`);
  pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
  for (const directory of (await readdir(migrations, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && d.name < migrationName)
    .sort((a, b) => a.name.localeCompare(b.name)))
    await pool.query(
      await readFile(
        new URL(`${directory.name}/migration.sql`, migrations),
        "utf8",
      ),
    );
}, 30000);
afterEach(async () => {
  await pool?.end();
  await root.query(`DROP SCHEMA ${schema} CASCADE`);
  await root.end();
});
async function station(id = newId(), code = `FICT-${id}`) {
  await pool.query(
    "INSERT INTO station(id,code,name,timezone,version) VALUES($1,$2,'Fictional station','Africa/Lagos',1) ON CONFLICT DO NOTHING",
    [id, code],
  );
  return id;
}
async function apply() {
  // Failed explicit migration transactions need rollback before test assertions.
  try {
    await pool.query(await migration());
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
}
async function domainCounts() {
  const tables = [
    "campaign",
    "settings_version",
    "auth_user",
    "held_release_person",
    "giveaway_manager_designation",
    "giveaway_phone_census",
    "giveaway_phone_check",
    "giveaway_reconciliation",
    "giveaway_snapshot",
    "audit_event",
  ];
  return Promise.all(
    tables.map(
      async (table) =>
        (await pool.query(`SELECT count(*)::text n FROM ${table}`)).rows[0].n,
    ),
  );
}
it("WHR-229 upgrade binds every existing station and new stations; replay preserves bindings and seeds nothing else", async () => {
  const one = await station(),
    two = await station();
  expect(
    (await pool.query("SELECT * FROM station_reconciliation_policy")).rowCount,
  ).toBe(0);
  const counts = await domainCounts();
  await apply();
  expect(await domainCounts()).toEqual(counts);
  for (const id of [one, two])
    expect(await recordedReconciliationPolicy(pool, id)).toBe(
      "reconciliation-v1",
    );
  const before = (
    await pool.query(
      "SELECT * FROM station_reconciliation_policy ORDER BY station_id",
    )
  ).rows;
  await apply();
  expect(
    (
      await pool.query(
        "SELECT * FROM station_reconciliation_policy ORDER BY station_id",
      )
    ).rows,
  ).toEqual(before);
  const fresh = await station();
  expect(await recordedReconciliationPolicy(pool, fresh)).toBe(
    "reconciliation-v1",
  );
  await station(fresh);
  await station(newId(), `FICT-${fresh}`);
  expect(
    (await pool.query("SELECT * FROM station_reconciliation_policy")).rowCount,
  ).toBe(3);
  expect(await domainCounts()).toEqual(counts);
});
it.each([
  "missing",
  "evaluator_identity",
  "semantics_digest",
  "partial_uploads",
  "approval_reference",
])(
  "WHR-229 %s definition refuses upgrade and fresh-station creation",
  async (field) => {
    const existing = await station();
    const db = await pool.connect();
    try {
      await db.query(
        "ALTER TABLE reconciliation_policy_definition DISABLE TRIGGER USER",
      );
      if (field === "missing")
        await db.query("DELETE FROM reconciliation_policy_definition");
      else {
        if (field === "partial_uploads")
          await db.query(
            "ALTER TABLE reconciliation_policy_definition DROP CONSTRAINT reconciliation_policy_definition_partial_uploads_check",
          );
        await db.query(
          `UPDATE reconciliation_policy_definition SET ${field}=$1`,
          [field === "semantics_digest" ? "a".repeat(64) : "unapproved"],
        );
      }
      await db.query(
        "ALTER TABLE reconciliation_policy_definition ENABLE TRIGGER USER",
      );
    } finally {
      db.release();
    }
    await expect(apply()).rejects.toMatchObject({ code: "23514" });
    expect(
      (await pool.query("SELECT * FROM station_reconciliation_policy"))
        .rowCount,
    ).toBe(0);
    expect((await pool.query("SELECT id FROM station")).rows).toEqual([
      { id: existing },
    ]);
    // Restore the exact migrated definition, install bootstrap, then corrupt it
    // again: the live trigger must enforce the same identity as the backfill.
    await pool.query(
      "ALTER TABLE reconciliation_policy_definition DISABLE TRIGGER USER",
    );
    await pool.query("DELETE FROM reconciliation_policy_definition");
    await pool.query(
      "INSERT INTO reconciliation_policy_definition(policy_version,evaluator_identity,semantics_digest,approval_reference,partial_uploads) VALUES('reconciliation-v1','reconciliation-v1','6c2fe33b4b9f079540fdc79618b2eb5a209c88147d589ee40df22fbf0623c21a','WHR-158 / WHR-162 / Earl 16 Nov 2026','exact_incomplete')",
    );
    await pool.query(
      "ALTER TABLE reconciliation_policy_definition ENABLE TRIGGER USER",
    );
    await apply();
    await pool.query(
      "ALTER TABLE reconciliation_policy_definition DISABLE TRIGGER USER",
    );
    if (field === "missing") {
      await pool.query(
        "ALTER TABLE station_reconciliation_policy DISABLE TRIGGER USER",
      );
      await pool.query("DELETE FROM station_reconciliation_policy");
      await pool.query(
        "ALTER TABLE station_reconciliation_policy ENABLE TRIGGER USER",
      );
      await pool.query("DELETE FROM reconciliation_policy_definition");
    } else
      await pool.query(
        `UPDATE reconciliation_policy_definition SET ${field}=$1`,
        [field === "semantics_digest" ? "a".repeat(64) : "unapproved"],
      );
    await pool.query(
      "ALTER TABLE reconciliation_policy_definition ENABLE TRIGGER USER",
    );
    const before = (await pool.query("SELECT * FROM station ORDER BY id")).rows;
    expect(await recordedReconciliationPolicy(pool, existing)).toBeNull();
    await expect(station()).rejects.toMatchObject({ code: "23514" });
    await expect(station(existing)).rejects.toMatchObject({ code: "23514" });
    expect(
      (await pool.query("SELECT * FROM station ORDER BY id")).rows,
    ).toEqual(before);
  },
);
it("WHR-229 incompatible immutable binding fails closed without overwriting history", async () => {
  const id = await station();
  await pool.query(
    "INSERT INTO reconciliation_policy_definition(policy_version,evaluator_identity,approval_reference,partial_uploads) VALUES('unapproved','unapproved','Fictional unapproved','exact_incomplete')",
  );
  await pool.query(
    "INSERT INTO station_reconciliation_policy(station_id,policy_version) VALUES($1,'unapproved')",
    [id],
  );
  const before = (
    await pool.query("SELECT * FROM station_reconciliation_policy")
  ).rows;
  await expect(apply()).rejects.toMatchObject({ code: "23514" });
  expect(
    (await pool.query("SELECT * FROM station_reconciliation_policy")).rows,
  ).toEqual(before);
});
