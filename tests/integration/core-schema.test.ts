import { readFileSync } from "node:fs";
import pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { newId } from "../../src/server/lib/ids";

const fixtures = readFileSync(
  new URL("../../prisma/fixtures.sql", import.meta.url),
  "utf8",
);
const id = (n: number) =>
  `019a5000-0000-7000-8000-${n.toString().padStart(12, "0")}`;
async function connect() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  return db;
}
async function rollbackCase(run: (db: pg.Client) => Promise<void>) {
  const db = await connect();
  try {
    await db.query("BEGIN");
    await run(db);
  } finally {
    await db.query("ROLLBACK");
    await db.end();
  }
}
function purchaseSql(
  purchaseId = newId(),
  operationId = newId(),
  overrides: Record<string, unknown> = {},
) {
  const values: Record<string, unknown> = {
    id: purchaseId,
    originating_attendant_id: id(6),
    operation_id: operationId,
    payload_digest: "fictional-payload",
    sale_code: `TEST-${purchaseId}`,
    capture_context_id: id(24),
    assignment_id: id(18),
    station_id: id(8),
    pump_id: id(14),
    product_id: id(9),
    seller_name: "Grace Okon",
    seller_username: "grace.okon",
    card_code: "A7K3M9Q",
    app_captured_at: "2026-11-04T10:00:00Z",
    server_received_at: "2026-11-04T10:00:01Z",
    price_version_id: id(20),
    basis: "amount",
    entered_amount_kobo: "100000",
    amount_kobo: "100000",
    quantity: "1.00",
    rate_kobo: "100000",
    currency: "NGN",
    unit: "litre",
    quantity_precision: 2,
    medium: "vehicle",
    expected_photo_digest: "a".repeat(64),
    expected_photo_bytes: "100",
    status: "received",
    version: 1,
    ...overrides,
  };
  return {
    text: `INSERT INTO purchase (${Object.keys(values).join(",")}) VALUES (${Object.keys(
      values,
    )
      .map((_, i) => `$${i + 1}`)
      .join(",")})`,
    values: Object.values(values),
  };
}

describe("schema integrity guards", () => {
  beforeAll(async () => {
    const db = await connect();
    try {
      await db.query("BEGIN");
      await db.query(fixtures);
      await db.query("COMMIT");
    } finally {
      await db.end();
    }
  });

  it("fictional fixtures can be seeded twice without changing history", async () => {
    await rollbackCase(async (db) => {
      await db.query(fixtures);
      await db.query(fixtures);
      const cards = await db.query("SELECT code,state FROM card WHERE id=$1", [
        id(29),
      ]);
      expect(cards.rows).toEqual([{ code: "A7K3M9Q", state: "linked" }]);
    });
  });

  it("I-18 batches cannot skip the generated initial state", async () => {
    await rollbackCase(async (db) => {
      await expect(
        db.query(
          "INSERT INTO card_batch(id,batch_code,status,version,created_by) VALUES($1,$2,'active',1,$3)",
          [newId(), `TEST-${newId()}`, id(5)],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });
  });
  it("I-09 capture context revocation cannot be undone", async () => {
    await rollbackCase(async (db) => {
      await db.query(
        "UPDATE capture_context SET revoked_at=now() WHERE id=$1",
        [id(24)],
      );
      await expect(
        db.query("UPDATE capture_context SET revoked_at=NULL WHERE id=$1", [
          id(24),
        ]),
      ).rejects.toMatchObject({ code: "23514" });
    });
  });
  it("I-22 concurrent original operations persist once", async () => {
    const first = await connect();
    const second = await connect();
    const operationId = newId();
    try {
      const results = await Promise.allSettled([
        first.query(purchaseSql(newId(), operationId)),
        second.query(purchaseSql(newId(), operationId)),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const rejected = results.find((result) => result.status === "rejected");
      expect(rejected?.status === "rejected" && rejected.reason).toMatchObject({
        code: "23505",
        constraint: "uq_purchase_operation",
      });
      const count = await first.query(
        "SELECT count(*)::int AS count FROM purchase WHERE originating_attendant_id=$1 AND operation_id=$2",
        [id(6), operationId],
      );
      expect(count.rows[0]?.count).toBe(1);
    } finally {
      await first.end();
      await second.end();
    }
  });

  for (const column of ["amount_kobo", "server_received_at", "pump_id"]) {
    it(`I-28 original ${column} cannot be rewritten`, async () => {
      await rollbackCase(async (db) => {
        const purchaseId = newId();
        await db.query(purchaseSql(purchaseId));
        const value =
          column === "amount_kobo"
            ? "100001"
            : column === "pump_id"
              ? id(13)
              : "2026-11-04T10:00:02Z";
        await expect(
          db.query(`UPDATE purchase SET ${column}=$1,version=2 WHERE id=$2`, [
            value,
            purchaseId,
          ]),
        ).rejects.toMatchObject({ code: "23514" });
      });
    });
  }

  it("I-29 rejects calculations that do not match exact captured values", async () => {
    await rollbackCase(async (db) => {
      await expect(
        db.query(purchaseSql(newId(), newId(), { quantity: "1.01" })),
      ).rejects.toMatchObject({ code: "23514" });
    });
  });
  it("I-29 rejects a captured configuration that differs from its price version", async () => {
    await rollbackCase(async (db) => {
      await expect(
        db.query(purchaseSql(newId(), newId(), { quantity_precision: 3 })),
      ).rejects.toMatchObject({ code: "23514" });
    });
  });
  it("I-05 assignment history cannot overlap", async () => {
    await rollbackCase(async (db) => {
      await expect(
        db.query(
          `INSERT INTO assignment (id,attendant_id,pump_id,assignment_version,effective_from,effective_until,changed_by,reason) VALUES ($1,$2,$3,2,'2026-11-04T10:00:00Z','2026-11-04T11:00:00Z',$4,'fictional overlap')`,
          [newId(), id(6), id(13), id(5)],
        ),
      ).rejects.toMatchObject({ code: "23P01" });
    });
  });
  it("I-26 credited state requires an accepted current revision", async () => {
    await rollbackCase(async (db) => {
      await db.query(purchaseSql(newId(), newId(), { status: "credited" }));
      await expect(
        db.query("SET CONSTRAINTS ALL IMMEDIATE"),
      ).rejects.toMatchObject({ code: "23514" });
    });
  });
  it("I-32 price versions cannot be changed", async () => {
    await rollbackCase(async (db) => {
      await expect(
        db.query(
          "UPDATE product_price_version SET rate_kobo=rate_kobo+1 WHERE id=$1",
          [id(20)],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });
  });
  for (const statement of [
    "UPDATE audit_event SET reason='rewritten' WHERE id=$1",
    "DELETE FROM audit_event WHERE id=$1",
  ]) {
    it(`I-41 audit is append-only (${statement.split(" ")[0]})`, async () => {
      await rollbackCase(async (db) => {
        const auditId = newId();
        await db.query(
          `INSERT INTO audit_event (id,actor_kind,action,target_type,target_id,before,after,reason,occurred_at) VALUES ($1,'system','test','test',$2,'{}','{}','fictional test',now())`,
          [auditId, newId()],
        );
        await expect(db.query(statement, [auditId])).rejects.toMatchObject({
          code: "23514",
        });
      });
    });
  }
});
