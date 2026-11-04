import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const domainTables = [
  "auth_user",
  "auth_credential",
  "attendant",
  "admin",
  "role",
  "permission",
  "role_permission",
  "auth_session",
  "verification_challenge",
  "recovery_grant",
  "recovery_grant_item",
  "station",
  "product",
  "pump",
  "assignment",
  "product_price_version",
  "capture_context",
  "customer",
  "card_batch",
  "card",
  "card_customer_link",
  "customer_identity_change",
  "purchase",
  "purchase_revision",
  "photo_asset",
  "purchase_hold",
  "duplicate_flag",
  "campaign",
  "settings_version",
  "giveaway_snapshot",
  "giveaway_snapshot_row",
  "giveaway_snapshot_source",
  "audit_event",
  "maintenance_run",
];

type Column = {
  table_name: string;
  column_name: string;
  data_type: string;
  numeric_precision: number | null;
  numeric_scale: number | null;
};

describe("database representation contract", () => {
  let client: pg.Client;
  let columns: Column[];

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required for integration tests");
    }
    client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    const result = await client.query<Column>(
      `SELECT table_name, column_name, data_type, numeric_precision, numeric_scale
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [domainTables],
    );
    columns = result.rows;
  });

  afterAll(async () => {
    await client?.end();
  });

  it("provides every entity required to preserve attribution and financial history", () => {
    expect(
      [...new Set(columns.map((column) => column.table_name))].sort(),
    ).toEqual([...domainTables].sort());
  });

  it("I-29 stores per-sale money as exact BIGINT kobo with a currency", () => {
    const money = columns.filter((column) =>
      column.column_name.endsWith("_kobo"),
    );
    expect(money.length).toBeGreaterThanOrEqual(6);
    for (const column of money) {
      const label = `${column.table_name}.${column.column_name}`;
      // Frozen aggregate totals deliberately exceed a single purchase's BIGINT range.
      if (column.table_name === "giveaway_snapshot_row") {
        expect(column.data_type, label).toBe("numeric");
        expect(column.numeric_precision, label).toBe(30);
        expect(column.numeric_scale, label).toBe(0);
      } else {
        expect(column.data_type, label).toBe("bigint");
      }
      expect(
        columns.some(
          (candidate) =>
            candidate.table_name === column.table_name &&
            candidate.column_name === "currency",
        ),
        `${label} currency`,
      ).toBe(true);
    }
  });

  it("I-29 and I-44 preserve exact quantities with explicit units and captured precision", () => {
    for (const table of ["purchase", "purchase_revision"]) {
      for (const name of ["quantity", "entered_quantity"]) {
        const column = columns.find(
          (candidate) =>
            candidate.table_name === table && candidate.column_name === name,
        );
        expect(column, `${table}.${name}`).toMatchObject({
          data_type: "numeric",
          numeric_precision: 20,
          numeric_scale: 6,
        });
      }
      expect(
        columns.find(
          (column) =>
            column.table_name === table && column.column_name === "unit",
        ),
        `${table}.unit`,
      ).toBeDefined();
      expect(
        columns.find(
          (column) =>
            column.table_name === table &&
            column.column_name === "quantity_precision",
        ),
        `${table}.quantity_precision`,
      ).toBeDefined();
    }
  });

  it("I-28 and I-37 retain instants independently of the database session timezone", async () => {
    const timestamps = columns.filter((column) =>
      /(_at|_from|_until|_deadline|_cutoff|_start)$/.test(column.column_name),
    );
    expect(timestamps.length).toBeGreaterThan(34);
    for (const column of timestamps) {
      expect(
        column.data_type,
        `${column.table_name}.${column.column_name}`,
      ).toBe("timestamp with time zone");
    }
    for (const zone of ["UTC", "America/New_York", "Africa/Lagos"]) {
      await client.query("SELECT set_config('TimeZone', $1, false)", [zone]);
      const result = await client.query<{ instant: string }>(
        "SELECT extract(epoch from '2026-11-04T23:00:00+01:00'::timestamptz)::text AS instant",
      );
      expect(result.rows[0]?.instant).toBe("1793829600.000000");
    }
  });

  it("financial and attribution foreign keys cannot cascade away history", async () => {
    const result = await client.query<{
      table_name: string;
      constraint_name: string;
      confdeltype: string;
      confupdtype: string;
    }>(
      `SELECT t.relname AS table_name, c.conname AS constraint_name,
              c.confdeltype, c.confupdtype
       FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = 'public' AND c.contype = 'f'
         AND t.relname = ANY($1::text[])`,
      [domainTables],
    );
    expect(result.rows.length).toBeGreaterThan(40);
    for (const constraint of result.rows) {
      const label = `${constraint.table_name}.${constraint.constraint_name}`;
      expect(["a", "r"], `${label} ON DELETE`).toContain(
        constraint.confdeltype,
      );
      expect(["a", "r"], `${label} ON UPDATE`).toContain(
        constraint.confupdtype,
      );
    }
  });

  it("I-15 prevents two customers from owning the same normalized phone", async () => {
    await client.query("BEGIN");
    try {
      await client.query(
        `INSERT INTO customer (id, customer_code, name, phone_normalized, category, version)
         VALUES ($1, $2, 'Amina Bello', '+2348000009991', 'car_owner', 1)`,
        [randomUUID(), `TEST-${randomUUID()}`],
      );
      await expect(
        client.query(
          `INSERT INTO customer (id, customer_code, name, phone_normalized, category, version)
         VALUES ($1, $2, 'Tunde Adebayo', '+2348000009991', 'bike_user', 1)`,
          [randomUUID(), `TEST-${randomUUID()}`],
        ),
      ).rejects.toMatchObject({ code: "23505" });
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("I-14 keeps a customer's category fixed when their profile changes", async () => {
    await client.query("BEGIN");
    try {
      const id = randomUUID();
      await client.query(
        `INSERT INTO customer (id, customer_code, name, phone_normalized, category, version)
         VALUES ($1, $2, 'Amina Bello', '+2348000009992', 'car_owner', 1)`,
        [id, `TEST-${randomUUID()}`],
      );
      await expect(
        client.query(
          "UPDATE customer SET category = 'bike_user', version = 2 WHERE id = $1",
          [id],
        ),
      ).rejects.toThrow();
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it.each([
    ["pms", "kilogram"],
    ["cooking_gas", "litre"],
  ])("I-30 rejects product %s with the wrong unit %s", async (code, unit) => {
    await client.query("BEGIN");
    try {
      await expect(
        client.query(
          "INSERT INTO product (id, code, unit) VALUES ($1, $2, $3)",
          [randomUUID(), code, unit],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await client.query("ROLLBACK");
    }
  });
});
